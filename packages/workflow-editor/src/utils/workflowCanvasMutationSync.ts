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

/** 判断同步失败是否只是动作必填参数尚未配置（可继续本地编辑）。 */
export function isMissingRequiredActionParameterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /动作缺少必填参数/.test(message) ||
    /缺少必填输入/.test(message) ||
    message.includes('required_action_parameter_missing') ||
    // A newly-created RepeatUntil is intentionally empty until the user
    // adds its body and configures carry/exit values. Keep that draft local
    // instead of surfacing the backend's strict publish-contract error.
    /RepeatUntil 冻结合同无效/.test(message)
}

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
    const incompleteDraft = saved.state === 'draft_invalid' ||
      (saved.draft?.diagnostics ?? []).some(
        (diagnostic) => diagnostic.severity === 'error'
      )
    setMessage(
      incompleteDraft
        ? reason === 'create'
          ? '节点已保存为草稿。请继续配置必填物料或参数后再运行。'
          : '草稿已保存。还有必填项未配齐，配好后才能运行。'
        : reason === 'connect'
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
    // 新建/连线后常见：必填物料口尚未绑定。节点应留在本地供配置，不能当成编辑崩溃。
    if (isMissingRequiredActionParameterError(syncError)) {
      const raw = syncError instanceof Error
        ? syncError.message
        : String(syncError)
      const incompleteRepeatUntil = /RepeatUntil 冻结合同无效/.test(raw)
      const matched = /^([a-z0-9_]+)\s*:\s*(.+)$/i.exec(raw.trim())
      setLocalValidationDiagnostics(incompleteRepeatUntil ? [] : [{
        severity: 'error',
        code: matched?.[1] ?? 'candidate_invalid',
        message: matched?.[2]?.trim() || raw
      }])
      setCanvasDirty(true)
      setError(null)
      setMessage(incompleteRepeatUntil
        ? '循环节点已添加，请点击“添加节点”选择循环动作并配置循环条件。'
        : '节点已加到画布。草稿暂未写入，请配好必填项后重试保存。')
      return
    }
    setError(errorMessage(syncError))
    setMessage('这次改动还没同步上去，本地内容仍保留，请检查提示后重试。')
  })
  tailRef.current = operation.then(
    () => undefined,
    () => undefined
  )
}
