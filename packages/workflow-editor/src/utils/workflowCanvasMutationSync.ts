import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringTransformResult,
  WorkflowDefinitionPort,
  WorkflowRuntimePort
} from '@unilab/services'
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction
} from 'react'
import { useCallback, useRef } from 'react'

import {
  AuthoringOperationQueue,
  authoringProjection,
  authoringRemoteConflict,
  isAuthoringConflict
} from './persistentAuthoringSession'
import { errorMessage, authoritativePython } from './persistentAuthoringProjection'

interface CanvasMutationSyncDependencies<LocalState extends {
  mode: 'code' | 'canvas'
  aggregate: WorkflowAuthoringAggregate | null
  graph: WorkflowAuthoringGraph | null
  canvasDirty: boolean
  codeDirty: boolean
  editorValue: string
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}> {
  definitionPort: WorkflowDefinitionPort
  definitionPortRef: MutableRefObject<WorkflowDefinitionPort>
  editorReplaceContent: (value: string) => void
  generateCanvasPython: (
    graph: WorkflowAuthoringGraph,
    authority: WorkflowAuthoringAggregate
  ) => Promise<WorkflowAuthoringTransformResult>
  localState: MutableRefObject<LocalState>
  queue: AuthoringOperationQueue
  runtime: WorkflowRuntimePort
  sequenceRef: MutableRefObject<number>
  setAggregate: Dispatch<SetStateAction<WorkflowAuthoringAggregate | null>>
  setCanvasDirty: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setGraph: Dispatch<SetStateAction<WorkflowAuthoringGraph | null>>
  setLocalValidationDiagnostics: Dispatch<
    SetStateAction<WorkflowAuthoringTransformResult['diagnostics'] | null>
  >
  setMessage: Dispatch<SetStateAction<string>>
  setRemoteConflict: Dispatch<SetStateAction<
    ReturnType<typeof authoringRemoteConflict> | null
  >>
  tailRef: MutableRefObject<Promise<void>>
  workflowUuid: string
  workflowUuidRef: MutableRefObject<string>
}

type CanvasMutationSyncHookOptions<LocalState extends {
  mode: 'code' | 'canvas'
  aggregate: WorkflowAuthoringAggregate | null
  graph: WorkflowAuthoringGraph | null
  canvasDirty: boolean
  codeDirty: boolean
  editorValue: string
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}> = Omit<
  CanvasMutationSyncDependencies<LocalState>,
  'definitionPortRef' | 'sequenceRef' | 'tailRef' | 'workflowUuidRef'
>

/** 创建绑定当前工作流身份的画布变更同步回调。 */
export function useCanvasMutationSync<LocalState extends {
  mode: 'code' | 'canvas'
  aggregate: WorkflowAuthoringAggregate | null
  graph: WorkflowAuthoringGraph | null
  canvasDirty: boolean
  codeDirty: boolean
  editorValue: string
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}>(
  options: CanvasMutationSyncHookOptions<LocalState>
): (
  sourceGraph: WorkflowAuthoringGraph,
  reason: 'node_move' | 'connect' | 'create' | 'delete'
) => void {
  const sequenceRef = useRef(0)
  const tailRef = useRef<Promise<void>>(Promise.resolve())
  const workflowUuidRef = useRef(options.workflowUuid)
  const definitionPortRef = useRef(options.definitionPort)
  workflowUuidRef.current = options.workflowUuid
  definitionPortRef.current = options.definitionPort

  return useCallback((sourceGraph, reason) => {
    enqueueCanvasMutationSync(sourceGraph, reason, {
      ...options,
      definitionPortRef,
      sequenceRef,
      tailRef,
      workflowUuidRef
    })
  }, [options])
}

/**
 * 串行执行一次画布结构同步，并只让最后一次变更收束本地投影。
 *
 * OS 工作区按 generate → validate → Draft PUT 保存，Backend 直接保存完整图。
 * 该函数不应用候选，调用方只需在节点移动或连线成功后传入最新图。
 */
export function enqueueCanvasMutationSync<LocalState extends {
  mode: 'code' | 'canvas'
  aggregate: WorkflowAuthoringAggregate | null
  graph: WorkflowAuthoringGraph | null
  canvasDirty: boolean
  codeDirty: boolean
  editorValue: string
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}>(
  sourceGraph: WorkflowAuthoringGraph,
  reason: 'node_move' | 'connect' | 'create' | 'delete',
  dependencies: CanvasMutationSyncDependencies<LocalState>
): void {
  const {
    definitionPort,
    definitionPortRef,
    editorReplaceContent,
    generateCanvasPython,
    localState,
    queue,
    runtime,
    sequenceRef,
    setAggregate,
    setCanvasDirty,
    setError,
    setGraph,
    setLocalValidationDiagnostics,
    setMessage,
    setRemoteConflict,
    tailRef,
    workflowUuid,
    workflowUuidRef
  } = dependencies
  const sequence = ++sequenceRef.current
  localState.current = {
    ...localState.current,
    graph: sourceGraph,
    canvasDirty: true
  }
  const operation = tailRef.current.then(async () => {
    if (
      workflowUuidRef.current !== workflowUuid ||
      definitionPortRef.current !== definitionPort
    ) return
    const authority = localState.current.aggregate
    if (!authority) throw new Error('工作流编辑数据尚未就绪')

    let syncedGraph = sourceGraph
    let saved: WorkflowAuthoringAggregate
    if (definitionPort.capabilities.directGraphSaving) {
      saved = await definitionPort.saveGraph(sourceGraph)
      // Backend 图保存会推进 workflow.revision；下一次变更必须携带新修订。
      syncedGraph = authoringProjection(saved).graph
    } else {
      const generated = await generateCanvasPython(sourceGraph, authority)
      if (!generated.normalized_python_source || !generated.graph) {
        throw new Error('OS 未返回完整的画布与 Python 数据')
      }
      // 保留 OS 校验过的 pose 和边，避免保存响应的 applied projection 覆盖画布。
      syncedGraph = generated.graph
      saved = await queue.run(
        () => runtime.saveWorkflowAuthoringDraft(
          workflowUuid,
          {
            python_source: generated.normalized_python_source as string,
            expected_draft_hash: authority.draft?.draft_hash ?? null,
            expected_workflow_revision: authority.workflow_revision
          }
        )
      )
    }

    if (
      workflowUuidRef.current !== workflowUuid ||
      definitionPortRef.current !== definitionPort
    ) return
    setAggregate(saved)
    localState.current = {
      ...localState.current,
      aggregate: saved
    }
    // 连续操作时旧响应只更新 CAS 基线，不回滚最新缓冲或选择态。
    if (
      sequence !== sequenceRef.current ||
      workflowUuidRef.current !== workflowUuid ||
      definitionPortRef.current !== definitionPort
    ) return
    setGraph(syncedGraph)
    setCanvasDirty(false)
    const python = authoritativePython(saved)
    editorReplaceContent(python)
    setLocalValidationDiagnostics(saved.draft?.diagnostics ?? [])
    localState.current = {
      ...localState.current,
      aggregate: saved,
      graph: syncedGraph,
      canvasDirty: false,
      codeDirty: false,
      editorValue: python
    }
    setError(null)
    setMessage(
      reason === 'connect'
        ? '连线已同步到 OS；可继续编辑或运行工作流'
        : reason === 'create'
          ? '新建节点已同步到 OS'
          : reason === 'delete'
            ? '删除操作已同步到 OS'
            : '节点位置已同步到 OS'
    )
  }).catch(async (syncError: unknown) => {
    if (
      sequence !== sequenceRef.current ||
      workflowUuidRef.current !== workflowUuid ||
      definitionPortRef.current !== definitionPort
    ) return
    if (isAuthoringConflict(syncError)) {
      try {
        const remote = await queue.run(() => definitionPort.read())
        setRemoteConflict(authoringRemoteConflict(remote, localState.current))
        setMessage('画布自动同步检测到外部修改，请比较后明确处理')
      } catch (refreshError) {
        setError(errorMessage(refreshError))
      }
      return
    }
    setError(errorMessage(syncError))
    setMessage('画布变更未能同步到 OS；本地修改仍保留')
  })
  tailRef.current = operation.then(
    () => undefined,
    () => undefined
  )
}
