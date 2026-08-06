import { useCodeMirror } from '@unilab/code-editor'
import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringTransformResult,
  WorkflowMaterialSourceCatalogSnapshot
} from '@unilab/services'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { useWorkflowFileUpload } from '../hooks/useWorkflowFileUpload'
import {
  workflowAuthoringModeSwitchDecision,
  workflowAuthoringSurfacePolicy,
  workflowCandidateMaterializationDecision,
  workflowCanvasDraftSaveDecision,
  type WorkflowEditMode
} from '../utils/workflowCanvasPolicy'
import {
  beautifyPersistentAuthoringGraph,
  parseWorkflowAuthoringGraphImport,
  projectPersistentAuthoringGraph,
  updatePersistentAuthoringNodeName
} from '../utils/persistentAuthoringGraph'
import {
  bindTypedActionWorkflowInput,
  createPublishedWorkflowNode,
  createTypedActionNode,
  connectTypedActionEdge,
  projectTypedActionEditor,
  rehydrateTypedActionGraph,
  updateTypedActionLiteral,
  type TypedActionFieldProjection
} from '../utils/workflowActionCatalog'
import {
  connectMaterialSourceToTypedActionEdge,
  createMaterialSourceNode,
  projectMaterialSourceEditor,
  updateMaterialSourceSelector,
  type MaterialSourceEditorProjection,
  type MaterialSourceSelectorUpdate
} from '../utils/workflowMaterialSource'
import {
  projectMaterialTraces
} from '../utils/workflowMaterialTrace'
import {
  workflowDagLayoutStrategyLabel,
  workflowMaterialSwimlaneDirectionLabel,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from '../utils/workflowDagLayoutStrategy'
import {
  AuthoringOperationQueue,
  applyMaterializedWorkflowCandidate,
  authoringProjection,
  authoringStateMessage,
  catalogConflictDecision,
  draftSaveMessage,
  isAuthoringConflict,
  isCurrentAuthoringInvalidation,
  isSameAuthoringVersion,
  isTemplateCatalogConflict
} from '../utils/persistentAuthoringSession'
import {
  authoritativePython,
  errorMessage,
  isRecordValue,
  parseTypedFieldValue,
  rebaseGraphIdentity,
  shortTemplateLabel,
  workflowGraphJsonProjection,
  workflowIoMetadata
} from '../utils/persistentAuthoringProjection'
import type {
  FullSourceDiff,
  PersistentWorkflowAuthoringOptions,
  RemoteConflict,
  WorkflowCodeProjection
} from './persistentWorkflowAuthoringTypes'
import { usePersistentWorkflowTaskPanel } from './usePersistentWorkflowTaskPanel'
import { useWorkflowPanelRuntimeProjection } from './useWorkflowPanelRuntimeProjection'
import { useWorkflowCanvasDeletion } from './useWorkflowCanvasDeletion'

export type { PersistentWorkflowAuthoringOptions } from './persistentWorkflowAuthoringTypes'

export function usePersistentWorkflowAuthoring({
  runtime,
  workflowUuid,
  traceRuntime,
  resourceSlotOptionsPort,
  onUnsavedChangesChange,
  onWorkflowRuntimeProjectionChange,
  onSelectedWorkflowStepChange,
  onChooseWorkflow
}: PersistentWorkflowAuthoringOptions) {
  const [mode, setMode] = useState<WorkflowEditMode>('code')
  const [codeProjection, setCodeProjection] =
    useState<WorkflowCodeProjection>('python')
  const [aggregate, setAggregate] =
    useState<WorkflowAuthoringAggregate | null>(null)
  const policy = workflowAuthoringSurfacePolicy(mode)
  const editor = useCodeMirror(
    '',
    'python',
    '',
    policy.pythonEditorReadOnly || aggregate === null
  )
  const jsonProjectionEditor = useCodeMirror('', 'json', '', true)
  const [graph, setGraph] = useState<WorkflowAuthoringGraph | null>(null)
  const [actionCatalog, setActionCatalog] =
    useState<WorkflowActionCatalogSnapshot | null>(null)
  const [materialSourceCatalog, setMaterialSourceCatalog] =
    useState<WorkflowMaterialSourceCatalogSnapshot | null>(null)
  const [materialSourceCatalogLoading, setMaterialSourceCatalogLoading] =
    useState(true)
  const [materialSourceCatalogError, setMaterialSourceCatalogError] =
    useState<string | null>(null)
  const [canvasDirty, setCanvasDirty] = useState(false)
  const [selectedNodeUuid, setSelectedNodeUuid] = useState<string | null>(null)

  useEffect(() => {
    onSelectedWorkflowStepChange?.(selectedNodeUuid)
    return () => onSelectedWorkflowStepChange?.(null)
  }, [onSelectedWorkflowStepChange, selectedNodeUuid])
  const [selectedNodeName, setSelectedNodeName] = useState('')
  const [selectedNodeNameDirty, setSelectedNodeNameDirty] = useState(false)
  const [actionParametersOpen, setActionParametersOpen] = useState(false)
  const [workflowIoOpen, setWorkflowIoOpen] = useState(false)
  const [nodePaletteOpen, setNodePaletteOpen] = useState(true)
  const [message, setMessage] = useState('正在读取 OS 工作流编辑状态…')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingMode, setPendingMode] = useState<WorkflowEditMode | null>(null)
  const [fullSourceDiff, setFullSourceDiff] =
    useState<FullSourceDiff | null>(null)
  const [pendingPythonImport, setPendingPythonImport] =
    useState<string | null>(null)
  const [remoteConflict, setRemoteConflict] =
    useState<RemoteConflict | null>(null)
  const deleteCanvasElements = useWorkflowCanvasDeletion({
    graph,
    enabled: policy.canvasMutationEnabled,
    onGraphChange: setGraph,
    onDirty: () => setCanvasDirty(true),
    onSelectionClear: () => {
      setSelectedNodeUuid(null)
      setSelectedNodeName('')
      setSelectedNodeNameDirty(false)
      setActionParametersOpen(false)
    },
    onError: setError,
    onMessage: setMessage
  })
  const operationQueue = useRef<AuthoringOperationQueue | null>(null)
  if (operationQueue.current === null) {
    operationQueue.current = new AuthoringOperationQueue()
  }
  const queue = operationQueue.current
  const remotePending = useRef(false)
  const localState = useRef({
    mode,
    codeDirty: editor.isDirty,
    canvasDirty: canvasDirty || selectedNodeNameDirty,
    editorValue: editor.value,
    aggregate,
    graph,
    selectedNodeUuid,
    selectedNodeName,
    selectedNodeNameDirty
  })
  localState.current = {
    mode,
    codeDirty: editor.isDirty,
    canvasDirty: canvasDirty || selectedNodeNameDirty,
    editorValue: editor.value,
    aggregate,
    graph,
    selectedNodeUuid,
    selectedNodeName,
    selectedNodeNameDirty
  }

  const fileUpload = useWorkflowFileUpload({
    onLoaded: ({ content, fileName }) => {
      const current = localState.current
      if (!current.aggregate) {
        setError('工作流编辑数据尚未就绪，无法导入文件')
        return
      }
      if (current.codeDirty || current.canvasDirty) {
        setError('请先保存或放弃当前未保存修改，再导入文件')
        return
      }
      const lowerFileName = fileName.toLowerCase()
      if (lowerFileName.endsWith('.json')) {
        setPendingPythonImport(null)
        void run(async () => {
          const importedGraph = parseWorkflowAuthoringGraphImport(
            content,
            workflowUuid
          )
          const generated = await generateCanvasPython(importedGraph)
          if (!generated.graph || !generated.normalized_python_source) {
            throw new Error('OS 未返回完整的画布与 Python 数据')
          }
          setMode('canvas')
          const beautifiedGraph = beautifyPersistentAuthoringGraph(
            generated.graph
          )
          setGraph(beautifiedGraph)
          editor.replaceContent(generated.normalized_python_source)
          setCanvasDirty(true)
          setSelectedNodeUuid(null)
          setSelectedNodeName('')
          setSelectedNodeNameDirty(false)
          setError(null)
          setMessage(
            `${fileName} 已导入到画布；保存前将检查完整 Python 差异`
          )
          localState.current = {
            ...current,
            mode: 'canvas',
            codeDirty: false,
            canvasDirty: true,
            editorValue: generated.normalized_python_source,
            graph: beautifiedGraph,
            selectedNodeUuid: null,
            selectedNodeName: '',
            selectedNodeNameDirty: false
          }
        })
        return
      }
      if (!lowerFileName.endsWith('.py')) {
        setError('当前入口只接受 .py 或 .json 工作流文件')
        return
      }
      const nextGraph = authoringProjection(current.aggregate).graph
      setMode('code')
      setGraph(nextGraph)
      editor.updateContent(content)
      setCanvasDirty(false)
      setSelectedNodeUuid(null)
      setSelectedNodeName('')
      setSelectedNodeNameDirty(false)
      setPendingPythonImport(fileName)
      setError(null)
      setMessage(`${fileName} 已导入为未保存的 Python 草稿`)
      localState.current = {
        ...current,
        mode: 'code',
        codeDirty: true,
        canvasDirty: false,
        editorValue: content,
        graph: nextGraph,
        selectedNodeUuid: null,
        selectedNodeName: '',
        selectedNodeNameDirty: false
      }
    },
    onError: (uploadError) => setError(uploadError)
  })

  const structure = useMemo(
    () => graph
      ? projectPersistentAuthoringGraph(graph, materialSourceCatalog)
      : { nodes: [], links: [], steps: [], error: null },
    [graph, materialSourceCatalog]
  )
  useEffect(() => {
    jsonProjectionEditor.replaceContent(
      graph ? workflowGraphJsonProjection(graph) : '{}'
    )
  }, [graph, jsonProjectionEditor.replaceContent])

  /**
   * 按选定策略重排当前候选图，并把坐标结果留在画布草稿中。
   *
   * @param strategy 用户选择的工作流（Workflow）画布布局策略。
   * @param swimlaneDirection 物料泳道策略当前选中的流向。
   * @returns 无返回值；没有可编辑候选图时保持现状。
   */
  const beautifyCanvasLayout = useCallback((
    strategy: WorkflowDagLayoutStrategy,
    swimlaneDirection: WorkflowMaterialSwimlaneDirection
  ): void => {
    if (!graph || !policy.canvasMutationEnabled || busy) return
    const nextGraph = beautifyPersistentAuthoringGraph(
      graph,
      strategy,
      swimlaneDirection
    )
    setGraph(nextGraph)
    setCanvasDirty(true)
    setSelectedNodeNameDirty(false)
    setError(null)
    setMessage(
      `已应用${workflowDagLayoutStrategyLabel(strategy)}${
        strategy === 'material-swimlanes'
          ? `（${workflowMaterialSwimlaneDirectionLabel(
              swimlaneDirection
            )}）`
          : ''
      }布局；` +
      '保存草稿后将写入工作流'
    )
  }, [busy, graph, policy.canvasMutationEnabled])
  const materialTraces = useMemo(
    () => projectMaterialTraces(structure.nodes, structure.links),
    [structure.links, structure.nodes]
  )
  const effectiveMaterialSourceCatalog = useMemo(() => {
    if (!materialSourceCatalog) return null
    const templateLabels = new Map(
      materialSourceCatalog.resourceTemplates.map((template) => [
        template.uuid,
        template.displayName
      ])
    )
    for (const node of graph?.nodes ?? []) {
      if (node.type !== 'material_source' || !isRecordValue(node.param)) continue
      const templateUuid = node.param.resource_template_uuid
      if (typeof templateUuid === 'string' && templateUuid) {
        templateLabels.set(
          templateUuid,
          templateLabels.get(templateUuid) ?? shortTemplateLabel(templateUuid)
        )
      }
    }
    for (const template of [
      ...(actionCatalog?.actionTemplates ?? []),
      ...(actionCatalog?.workflowTemplates ?? [])
    ]) {
      for (const handle of template.handles) {
        for (const templateUuid of handle.allowedResourceTemplateUuids ?? []) {
          templateLabels.set(
            templateUuid,
            templateLabels.get(templateUuid) ?? shortTemplateLabel(templateUuid)
          )
        }
      }
    }
    return {
      ...materialSourceCatalog,
      resourceTemplates: [...templateLabels.entries()]
        .map(([uuid, displayName]) => ({ uuid, displayName }))
        .sort((left, right) => left.uuid.localeCompare(right.uuid))
    }
  }, [actionCatalog, graph, materialSourceCatalog])
  const materialSourceAuthorityBlocked = useMemo(() => {
    const sourceNodes = graph?.nodes.filter(
      (node) => node.type === 'material_source'
    ) ?? []
    if (sourceNodes.length === 0) return false
    if (
      materialSourceCatalogLoading ||
      materialSourceCatalogError ||
      !effectiveMaterialSourceCatalog ||
      !graph
    ) return true
    return sourceNodes.some((node) => {
      if (typeof node.uuid !== 'string' || !node.uuid) return true
      try {
        return projectMaterialSourceEditor(
          effectiveMaterialSourceCatalog,
          graph,
          node.uuid
        ).staleReferences.length > 0
      } catch {
        return true
      }
    })
  }, [
    effectiveMaterialSourceCatalog,
    graph,
    materialSourceCatalogError,
    materialSourceCatalogLoading
  ])
  const dirty = mode === 'code'
    ? editor.isDirty
    : canvasDirty || selectedNodeNameDirty
  const taskPanel = usePersistentWorkflowTaskPanel({
    runtime,
    workflowUuid,
    aggregate,
    structure,
    editorValue: editor.value,
    setCodeMarkers: editor.setLineMarkers,
    queue,
    resourceSlotOptionsPort,
    setMessage,
    setError
  })
  useWorkflowPanelRuntimeProjection({
    aggregate,
    runtimeSnapshot: taskPanel.taskRuntime.snapshot,
    onProjectionChange: onWorkflowRuntimeProjectionChange
  })

  useEffect(() => {
    onUnsavedChangesChange?.(dirty)
  }, [dirty, onUnsavedChangesChange])

  useEffect(
    () => () => onUnsavedChangesChange?.(false),
    [onUnsavedChangesChange]
  )

  /**
   * 安装 OS 权威工作流编写聚合，并为首次画布展示建立本地美化布局。
   *
   * @param next OS 返回的工作流编写聚合。
   * @param nextMessage 安装完成后展示给用户的状态文案。
   * @returns 无返回值；自动布局不会单独制造未保存修改。
   */
  const installAggregate = useCallback((
    next: WorkflowAuthoringAggregate,
    nextMessage: string
  ): void => {
    const projection = authoringProjection(next)
    const beautifiedGraph = beautifyPersistentAuthoringGraph(projection.graph)
    const python = authoritativePython(next)
    setAggregate(next)
    setGraph(beautifiedGraph)
    editor.replaceContent(python)
    setCanvasDirty(false)
    setSelectedNodeUuid(null)
    setSelectedNodeName('')
    setSelectedNodeNameDirty(false)
    setRemoteConflict(null)
    setMessage(nextMessage)
    localState.current = {
      ...localState.current,
      codeDirty: false,
      canvasDirty: false,
      editorValue: python,
      aggregate: next,
      graph: beautifiedGraph,
      selectedNodeUuid: null,
      selectedNodeName: '',
      selectedNodeNameDirty: false
    }
  }, [editor.replaceContent])

  useEffect(() => {
    let active = true
    setActionCatalog(null)
    void runtime.getWorkflowActionCatalog()
      .then((catalog) => {
        if (active) setActionCatalog(catalog)
      })
      .catch((catalogError) => {
        if (active) {
          setActionCatalog(null)
          setError(errorMessage(catalogError))
        }
      })
    return () => {
      active = false
    }
  }, [runtime])

  const refreshMaterialSourceCatalog = useCallback(async (): Promise<void> => {
    setMaterialSourceCatalogLoading(true)
    setMaterialSourceCatalogError(null)
    try {
      setMaterialSourceCatalog(
        await runtime.getWorkflowMaterialSourceCatalog()
      )
    } catch (catalogError) {
      setMaterialSourceCatalog(null)
      setMaterialSourceCatalogError(errorMessage(catalogError))
    } finally {
      setMaterialSourceCatalogLoading(false)
    }
  }, [runtime])

  const refreshWorkflowCatalogsAfterConflict = useCallback(async (): Promise<{
    action: WorkflowActionCatalogSnapshot
    materialSource: WorkflowMaterialSourceCatalogSnapshot
  }> => {
    setActionCatalog(null)
    setMaterialSourceCatalog(null)
    setMaterialSourceCatalogLoading(true)
    setMaterialSourceCatalogError(null)
    try {
      const [action, materialSource] = await Promise.all([
        runtime.getWorkflowActionCatalog(),
        runtime.getWorkflowMaterialSourceCatalog()
      ])
      setActionCatalog(action)
      setMaterialSourceCatalog(materialSource)
      return { action, materialSource }
    } catch (catalogError) {
      const message = errorMessage(catalogError)
      setMaterialSourceCatalogError(message)
      throw catalogError
    } finally {
      setMaterialSourceCatalogLoading(false)
    }
  }, [runtime])

  useEffect(() => {
    void refreshMaterialSourceCatalog()
  }, [refreshMaterialSourceCatalog])

  useEffect(() => {
    let active = true
    setBusy(true)
    setError(null)
    void queue.run(
      () => runtime.getWorkflowAuthoring(workflowUuid)
    )
      .then((next) => {
        if (!active) return
        remotePending.current = false
        installAggregate(next, authoringStateMessage(next))
      })
      .catch((loadError) => {
        if (!active) return
        setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [installAggregate, queue, runtime, workflowUuid])

  useEffect(() => {
    let active = true
    let refreshInFlight = false
    let refreshPending = false

    const refreshFromAuthority = async (): Promise<void> => {
      if (refreshInFlight) {
        refreshPending = true
        return
      }
      refreshInFlight = true
      try {
        do {
          refreshPending = false
          const next = await queue.run(
            () => runtime.getWorkflowAuthoring(workflowUuid)
          )
          if (!active) return
          const current = localState.current
          if (isSameAuthoringVersion(next, current.aggregate)) {
            remotePending.current = false
            continue
          }
          const dirtyAtInstall = current.mode === 'code'
            ? current.codeDirty
            : current.canvasDirty
          if (dirtyAtInstall) {
            remotePending.current = true
            setRemoteConflict({
              remote: next,
              localMode: current.mode,
              localPython: current.editorValue,
              localGraph: current.graph,
              selectedNodeUuid: current.selectedNodeUuid,
              selectedNodeName: current.selectedNodeName,
              selectedNodeNameDirty: current.selectedNodeNameDirty
            })
            setMessage('检测到外部修改；本地内容已保留，请比较后明确处理')
            return
          }
          remotePending.current = false
          installAggregate(next, '已同步外部修改')
        } while (active && refreshPending)
      } catch (refreshError) {
        if (active) setError(errorMessage(refreshError))
      } finally {
        refreshInFlight = false
      }
    }

    const subscription = runtime.subscribeWorkflowAuthoring(
      workflowUuid,
      (event) => {
        const current = localState.current
        if (isCurrentAuthoringInvalidation(event, current.aggregate)) return
        remotePending.current = true
        void refreshFromAuthority()
      },
      {
        onOpen: () => {
          setError((current) =>
            current?.startsWith('工作流编辑实时同步中断：')
              ? null
              : current
          )
        },
        onError: (streamError) => {
          setError(`Authoring 实时同步中断：${streamError.message}`)
        }
      }
    )
    return () => {
      active = false
      subscription.dispose()
    }
  }, [installAggregate, queue, runtime, workflowUuid])

  const run = useCallback(async (
    operation: () => Promise<void>
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (operationError) {
      setError(errorMessage(operationError))
    } finally {
      setBusy(false)
    }
  }, [])

  const readRemoteConflict = useCallback(async (): Promise<void> => {
    const remote = await queue.run(
      () => runtime.getWorkflowAuthoring(workflowUuid)
    )
    const current = localState.current
    const currentDirty = current.mode === 'code'
      ? current.codeDirty
      : current.canvasDirty
    if (!currentDirty) {
      remotePending.current = false
      installAggregate(remote, '已同步远端工作流编辑状态')
      return
    }
    remotePending.current = true
    setRemoteConflict({
      remote,
      localMode: current.mode,
      localPython: current.editorValue,
      localGraph: current.graph,
      selectedNodeUuid: current.selectedNodeUuid,
      selectedNodeName: current.selectedNodeName,
      selectedNodeNameDirty: current.selectedNodeNameDirty
    })
    setMessage('远端状态已补读；本地内容保持不变，请比较后明确处理')
  }, [installAggregate, queue, runtime, workflowUuid])

  const generateCanvasPython = useCallback(async (
    sourceGraph: WorkflowAuthoringGraph,
    authority: WorkflowAuthoringAggregate = aggregate as WorkflowAuthoringAggregate
  ): Promise<WorkflowAuthoringTransformResult> => {
    if (!authority) throw new Error('工作流编辑数据尚未就绪')
    const sourceUri = authority.draft?.source_uri
    if (!sourceUri) throw new Error('当前工作流尚未注册软件包中的 Python 草稿')
    const request = (graphValue: WorkflowAuthoringGraph) => queue.run(
      () => runtime.generateWorkflowAuthoringPython({
        workflow_uuid: workflowUuid,
        revision: authority.workflow_revision,
        source_uri: sourceUri,
        graph: graphValue
      })
    )
    let graphValue = sourceGraph
    let generated: WorkflowAuthoringTransformResult | null = null
    let catalogFailure: unknown = null
    try {
      generated = await request(graphValue)
    } catch (generateError) {
      if (!isTemplateCatalogConflict(generateError)) throw generateError
      catalogFailure = generateError
    }
    const diagnosticCatalogMismatch = generated?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'template_catalog_mismatch' ||
        diagnostic.code === 'template_catalog_conflict'
    ) ?? false
    if (catalogFailure || diagnosticCatalogMismatch) {
      const refreshedCatalog = (
        await refreshWorkflowCatalogsAfterConflict()
      ).action
      const decision = catalogConflictDecision({
        dirty: localState.current.canvasDirty,
        localPython: localState.current.editorValue,
        localGraph: sourceGraph,
        observedFingerprint:
          authority.candidate?.template_catalog_fingerprint ??
          authority.applied_source?.template_catalog_fingerprint ??
          actionCatalog?.fingerprint ?? '',
        currentFingerprint: refreshedCatalog.fingerprint ?? ''
      })
      if (!decision) {
        if (catalogFailure) throw catalogFailure
        throw new Error('操作目录已变化，但未返回新的版本标识')
      }
      graphValue = rehydrateTypedActionGraph(
        refreshedCatalog,
        decision.retainLocalGraph
      )
      setGraph(graphValue)
      setCanvasDirty(true)
      localState.current = {
        ...localState.current,
        graph: graphValue,
        canvasDirty: true
      }
      setMessage('操作目录已更新；本地画布已按稳定 UUID 恢复')
      generated = await request(graphValue)
    }
    if (!generated) throw new Error('OS 未返回工作流转换结果')
    let blocking = generated.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error'
    )
    if (blocking.length > 0 || !generated.normalized_python_source) {
      throw new Error(
        blocking.map((item) => `${item.code}: ${item.message}`).join('\n') ||
        'OS 未返回完整规范化 Python'
      )
    }
    if (!generated.graph) throw new Error('OS 未返回完整画布数据')
    const validated = await queue.run(
      () => runtime.validateWorkflowAuthoring({
        workflow_uuid: workflowUuid,
        revision: authority.workflow_revision,
        source_uri: sourceUri,
        graph: generated.graph as WorkflowAuthoringGraph,
        python_source: generated.normalized_python_source as string
      })
    )
    blocking = validated.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error'
    )
    if (
      blocking.length > 0 ||
      !validated.graph ||
      !validated.normalized_python_source
    ) {
      throw new Error(
        blocking.map((item) => `${item.code}: ${item.message}`).join('\n') ||
        'OS 未通过编辑中入参与出参校验'
      )
    }
    return validated
  }, [
    actionCatalog?.fingerprint,
    aggregate,
    queue,
    refreshWorkflowCatalogsAfterConflict,
    runtime,
    workflowUuid
  ])

  /**
   * 切换工作流单编辑权模式，并在进入画布模式时自动应用一次美化布局。
   *
   * @param nextMode 目标编辑模式。
   * @returns 模式与 OS 投影同步完成后的 Promise。
   */
  const enterMode = useCallback(async (
    nextMode: WorkflowEditMode
  ): Promise<void> => {
    if (!aggregate) throw new Error('工作流编辑数据尚未就绪')
    setPendingPythonImport(null)
    if (nextMode === 'canvas') {
      const sourceGraph = authoringProjection(aggregate).graph
      const generated = await generateCanvasPython(sourceGraph)
      setGraph(beautifyPersistentAuthoringGraph(
        generated.graph || sourceGraph
      ))
      editor.replaceContent(generated.normalized_python_source as string)
      setCanvasDirty(false)
      setSelectedNodeUuid(null)
      setSelectedNodeName('')
      setSelectedNodeNameDirty(false)
      setMode('canvas')
      setMessage('画布模式：Python 是 OS 生成的只读投影')
      return
    }
    setGraph(authoringProjection(aggregate).graph)
    editor.replaceContent(authoritativePython(aggregate))
    setCanvasDirty(false)
    setSelectedNodeUuid(null)
    setSelectedNodeName('')
    setSelectedNodeNameDirty(false)
    setMode('code')
    setMessage(authoringStateMessage(aggregate))
  }, [aggregate, editor.replaceContent, generateCanvasPython])

  const requestMode = (nextMode: WorkflowEditMode): void => {
    const decision = workflowAuthoringModeSwitchDecision({
      currentMode: mode,
      requestedMode: nextMode,
      activeSurfaceDirty: dirty
    })
    if (decision === 'stay') return
    if (decision === 'confirm_dirty') {
      setPendingMode(nextMode)
      return
    }
    void run(() => enterMode(nextMode))
  }

  const discardAndSwitch = (): void => {
    if (!pendingMode || !aggregate) return
    const nextMode = pendingMode
    setPendingMode(null)
    editor.replaceContent(authoritativePython(aggregate))
    setGraph(authoringProjection(aggregate).graph)
    setCanvasDirty(false)
    setSelectedNodeUuid(null)
    setSelectedNodeName('')
    setSelectedNodeNameDirty(false)
    setPendingPythonImport(null)
    void run(() => enterMode(nextMode))
  }

  /**
   * 保存当前可写工作流源码，并在 OS 规范化结果变化时要求用户确认完整差异。
   * 该操作只持久化工作流源码（Workflow Source），不会应用工作流创作候选。
   *
   * @returns 不返回值；异步保存结果通过工作流编辑器状态呈现。
   */
  const saveDraft = (): void => {
    if (!aggregate) return
    if (remotePending.current) {
      void run(readRemoteConflict)
      return
    }
    if (mode === 'code') {
      void run(async () => {
        try {
          const saved = await queue.run(
            () => runtime.saveWorkflowAuthoringDraft(
              workflowUuid,
              {
                python_source: editor.value,
                expected_draft_hash: aggregate.draft?.draft_hash ?? null,
                expected_workflow_revision: aggregate.workflow_revision
              }
            )
          )
          installAggregate(saved, draftSaveMessage(saved))
          const materialization = saved.candidate && saved.draft
            ? workflowCandidateMaterializationDecision({
                draftPython: saved.draft.python_source,
                normalizedPython: saved.candidate.normalized_python_source
              })
            : null
          if (materialization?.kind === 'review_normalized_source') {
            setFullSourceDiff({
              before: materialization.before,
              after: materialization.after,
              expectedDraftHash: saved.draft?.draft_hash ?? null,
              expectedWorkflowRevision: saved.workflow_revision,
              reason: 'source_normalization',
              resumeMode: 'code',
              applyAfterSave: false
            })
            setMessage(
              pendingPythonImport
                ? `${pendingPythonImport} 已保存；请接受 OS 规范化 Python 后再应用`
                : '草稿已保存；请接受 OS 规范化 Python 后再应用'
            )
          } else {
            setPendingPythonImport(null)
          }
        } catch (saveError) {
          if (!isAuthoringConflict(saveError)) throw saveError
          remotePending.current = true
          await readRemoteConflict()
        }
      })
      return
    }
    if (!graph) return
    void run(async () => {
      const sourceGraph = selectedNodeNameDirty && selectedNodeUuid
        ? updatePersistentAuthoringNodeName(
            graph,
            selectedNodeUuid,
            selectedNodeName
          )
        : graph
      if (sourceGraph !== graph) {
        setGraph(sourceGraph)
        setCanvasDirty(true)
        setSelectedNodeNameDirty(false)
      }
      const generated = await generateCanvasPython(sourceGraph)
      const decision = workflowCanvasDraftSaveDecision({
        baselinePython: authoritativePython(aggregate),
        generatedPython: generated.normalized_python_source as string,
        fullDiffAccepted: false
      })
      if (decision.kind === 'review_full_diff') {
        setFullSourceDiff({
          before: decision.before,
          after: decision.after,
          expectedDraftHash: aggregate.draft?.draft_hash ?? null,
          expectedWorkflowRevision: aggregate.workflow_revision,
          reason: 'canvas_save',
          resumeMode: 'canvas',
          applyAfterSave: false
        })
      }
    })
  }

  const acceptFullSourceDiff = (): void => {
    if (!fullSourceDiff || busy) return
    const diff = fullSourceDiff
    const decision = workflowCanvasDraftSaveDecision({
      baselinePython: diff.before,
      generatedPython: diff.after,
      fullDiffAccepted: true
    })
    if (decision.kind !== 'write_complete_draft') return
    void run(async () => {
      try {
        const saveNormalizedDraft = () => queue.run(
          () => runtime.saveWorkflowAuthoringDraft(
            workflowUuid,
            {
              python_source: decision.python_source,
              expected_draft_hash: diff.expectedDraftHash,
              expected_workflow_revision: diff.expectedWorkflowRevision
            }
          )
        )
        if (diff.applyAfterSave) {
          const { applied } = await applyMaterializedWorkflowCandidate({
            save: saveNormalizedDraft,
            apply: (candidateHash) => queue.run(
              () => runtime.applyWorkflowAuthoring(
                workflowUuid,
                { candidate_hash: candidateHash }
              )
            )
          })
          remotePending.current = false
          setFullSourceDiff(null)
          setPendingPythonImport(null)
          setMode(diff.resumeMode)
          installAggregate(
            applied.authoring,
            applied.apply_result.kind === 'graph'
              ? `工作流已应用，当前版本为 ${applied.apply_result.workflow_revision}`
              : '源码已应用，工作流图未发生变化'
          )
          return
        }
        const saved = await saveNormalizedDraft()
        remotePending.current = false
        setFullSourceDiff(null)
        installAggregate(saved, draftSaveMessage(saved))
        if (diff.reason === 'source_normalization') {
          setPendingPythonImport(null)
        }
        setMode(diff.resumeMode)
      } catch (saveError) {
        if (!isAuthoringConflict(saveError)) throw saveError
        setFullSourceDiff(null)
        remotePending.current = true
        await readRemoteConflict()
      }
    })
  }

  const retryLocalAfterConflict = (): void => {
    if (!remoteConflict) return
    const conflict = remoteConflict
    void run(async () => {
      let localPython = conflict.localPython
      if (conflict.localMode === 'canvas') {
        if (!conflict.localGraph) throw new Error('本地画布缓冲不存在')
        let localGraph = conflict.localGraph
        if (
          conflict.selectedNodeNameDirty &&
          conflict.selectedNodeUuid
        ) {
          localGraph = updatePersistentAuthoringNodeName(
            localGraph,
            conflict.selectedNodeUuid,
            conflict.selectedNodeName
          )
        }
        localGraph = rebaseGraphIdentity(localGraph, conflict.remote)
        const generated = await generateCanvasPython(
          localGraph,
          conflict.remote
        )
        localPython = generated.normalized_python_source as string
      }
      setFullSourceDiff({
        before: authoritativePython(conflict.remote),
        after: localPython,
        expectedDraftHash: conflict.remote.draft?.draft_hash ?? null,
        expectedWorkflowRevision: conflict.remote.workflow_revision,
        reason: 'conflict_retry',
        resumeMode: conflict.localMode,
        applyAfterSave: false
      })
      setRemoteConflict(null)
    })
  }

  const adoptRemoteConflict = (): void => {
    if (!remoteConflict) return
    const remote = remoteConflict.remote
    remotePending.current = false
    setPendingPythonImport(null)
    setMode(remoteConflict.localMode)
    installAggregate(remote, '已采用远端工作流编辑状态，本地修改已放弃')
  }

  /**
   * 应用服务器签发的工作流创作候选；若规范化源码尚未物化，则先打开完整差异确认。
   * 只有工作流源码与候选规范化源码完全一致时，才向 OS 提交候选哈希。
   *
   * @returns 不返回值；异步应用结果通过工作流编辑器状态呈现。
   */
  const applyCandidate = (): void => {
    const candidate = aggregate?.candidate
    if (!candidate) {
      setError('当前没有可应用的服务器候选版本')
      return
    }
    const draft = aggregate?.draft
    if (!draft) {
      setError('当前候选缺少可确认的工作流源码，请刷新后重试')
      return
    }
    const materialization = workflowCandidateMaterializationDecision({
      draftPython: draft.python_source,
      normalizedPython: candidate.normalized_python_source
    })
    if (materialization.kind === 'review_normalized_source') {
      setFullSourceDiff({
        before: materialization.before,
        after: materialization.after,
        expectedDraftHash: draft.draft_hash,
        expectedWorkflowRevision: aggregate.workflow_revision,
        reason: 'source_normalization',
        resumeMode: mode,
        applyAfterSave: true
      })
      setMessage('请确认 OS 规范化 Python；接受后将自动应用工作流')
      return
    }
    // 候选哈希是 OS 签发的单次应用身份，只能在源码物化门禁通过后提交。
    const candidateHash = candidate.candidate_hash
    void run(async () => {
      try {
        const applied = await queue.run(
          () => runtime.applyWorkflowAuthoring(
            workflowUuid,
            { candidate_hash: candidateHash }
          )
        )
        installAggregate(
          applied.authoring,
          applied.apply_result.kind === 'graph'
            ? `工作流已应用，当前版本为 ${applied.apply_result.workflow_revision}`
            : '源码已应用，工作流图未发生变化'
        )
      } catch (applyError) {
        if (!isAuthoringConflict(applyError)) throw applyError
        let catalogRecovery: {
          catalog: WorkflowActionCatalogSnapshot
          localGraph: WorkflowAuthoringGraph
        } | null = null
        if (isTemplateCatalogConflict(applyError)) {
          const refreshedCatalog = (
            await refreshWorkflowCatalogsAfterConflict()
          ).action
          const currentGraph = localState.current.graph
          if (currentGraph) {
            catalogRecovery = {
              catalog: refreshedCatalog,
              localGraph: currentGraph
            }
          }
        }
        remotePending.current = true
        const refreshed = await queue.run(
          () => runtime.getWorkflowAuthoring(workflowUuid)
        )
        remotePending.current = false
        installAggregate(refreshed, '预览已变化，已刷新最新工作流编辑状态')
        if (catalogRecovery) {
          const rehydrated = rehydrateTypedActionGraph(
            catalogRecovery.catalog,
            catalogRecovery.localGraph
          )
          setGraph(rehydrated)
          setCanvasDirty(true)
          localState.current = {
            ...localState.current,
            graph: rehydrated,
            canvasDirty: true
          }
          setMessage(
            '操作目录与工作流编辑数据已刷新；本地画布已按稳定 UUID 恢复'
          )
        }
        throw applyError
      }
    })
  }

  const selectCanvasNode = (nodeUuid: string): void => {
    if (selectedNodeNameDirty && nodeUuid !== selectedNodeUuid) {
      setError('请先保存当前节点名称修改，再选择其他节点')
      return
    }
    const node = graph?.nodes.find((item) => item.uuid === nodeUuid)
    if (!node) return
    setSelectedNodeUuid(nodeUuid)
    setSelectedNodeName(String(node.name || ''))
    setSelectedNodeNameDirty(false)
    setActionParametersOpen(node.type !== 'material_source')
    const sourceLine = taskPanel.codeSourceMap.find(
      (entry) => entry.workflow_node_uuid === nodeUuid
    )?.start_line
    if (sourceLine) editor.revealLine(sourceLine)
  }

  const projectionKind = aggregate
    ? authoringProjection(aggregate).kind
    : null
  const diagnostics = aggregate?.draft?.diagnostics ?? []
  const selectedGraphNode = graph?.nodes.find(
    (node) => node.uuid === selectedNodeUuid
  )
  const selectedIsMaterialSource = selectedGraphNode?.type === 'material_source'
  const selectedActionProjection = useMemo(() => {
    if (
      !actionCatalog ||
      !graph ||
      !selectedNodeUuid ||
      selectedIsMaterialSource
    ) {
      return { editor: null, error: null }
    }
    try {
      return {
        editor: projectTypedActionEditor(
          actionCatalog,
          graph,
          selectedNodeUuid,
          diagnostics
        ),
        error: null
      }
    } catch (projectionError) {
      return { editor: null, error: errorMessage(projectionError) }
    }
  }, [
    actionCatalog,
    diagnostics,
    graph,
    selectedIsMaterialSource,
    selectedNodeUuid
  ])
  const selectedActionEditor = selectedActionProjection.editor
  const selectedActionTemplate = actionCatalog?.actionTemplates.find(
    (template) => template.uuid === selectedActionEditor?.templateUuid
  ) ?? null
  const selectedNodeIsInternal = graph?.nodes.some((node) =>
    node.uuid === selectedNodeUuid &&
    node.parent_uuid !== undefined &&
    node.parent_uuid !== null
  ) ?? false
  const selectedMaterialSourceProjection = useMemo(() => {
    if (
      !effectiveMaterialSourceCatalog ||
      !graph ||
      !selectedNodeUuid ||
      !selectedIsMaterialSource
    ) return { editor: null, error: null }
    try {
      return {
        editor: projectMaterialSourceEditor(
          effectiveMaterialSourceCatalog,
          graph,
          selectedNodeUuid
        ),
        error: null
      }
    } catch (projectionError) {
      return { editor: null, error: errorMessage(projectionError) }
    }
  }, [
    graph,
    effectiveMaterialSourceCatalog,
    selectedIsMaterialSource,
    selectedNodeUuid
  ])
  const selectedMaterialSourceEditor = selectedMaterialSourceProjection.editor

  const addTypedActionNode = (templateUuid: string): void => {
    if (!actionCatalog || !graph) return
    const template = actionCatalog.actionTemplates.find(
      (item) => item.uuid === templateUuid
    )
    if (!template) return
    const stem = template.name.replace(/[^A-Za-z0-9_]/g, '_') || 'action'
    let name = stem
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `${stem}_${suffix}`
      suffix += 1
    }
    try {
      const next = createTypedActionNode(actionCatalog, graph, {
        nodeUuid: globalThis.crypto.randomUUID(),
        templateUuid,
        name
      })
      setGraph(next)
      setCanvasDirty(true)
      setMessage('已从真实操作模板创建节点；保存前将生成完整 Python')
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  const addPublishedWorkflowNode = (templateUuid: string): void => {
    if (!actionCatalog || !graph) return
    const template = actionCatalog.workflowTemplates.find(
      (item) => item.uuid === templateUuid
    )
    if (!template) return
    const stem = template.source.symbol.replace(/[^A-Za-z0-9_]/g, '_') ||
      'workflow'
    let name = stem
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `${stem}_${suffix}`
      suffix += 1
    }
    try {
      const next = createPublishedWorkflowNode(actionCatalog, graph, {
        nodeUuid: globalThis.crypto.randomUUID(),
        templateUuid,
        name
      })
      setGraph(next)
      setCanvasDirty(true)
      setMessage(
        '已插入已发布工作流边界；内部展开与映射由 OS 生成'
      )
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  const addMaterialSourceNode = (): void => {
    if (
      !effectiveMaterialSourceCatalog ||
      !graph ||
      materialSourceAuthorityBlocked
    ) return
    let name = 'material_source'
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `material_source_${suffix}`
      suffix += 1
    }
    try {
      const nodeUuid = globalThis.crypto.randomUUID()
      const next = createMaterialSourceNode(effectiveMaterialSourceCatalog, graph, {
        nodeUuid,
        name
      })
      setGraph(next)
      setCanvasDirty(true)
      setSelectedNodeUuid(nodeUuid)
      setSelectedNodeName(name)
      setSelectedNodeNameDirty(false)
      setMessage('已添加物料来源；请在属性面板中完成受控选择')
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  const updateMaterialSource = (
    editorProjection: MaterialSourceEditorProjection,
    patch: Partial<MaterialSourceSelectorUpdate>
  ): void => {
    if (
      !effectiveMaterialSourceCatalog ||
      !graph ||
      !selectedNodeUuid ||
      materialSourceAuthorityBlocked
    ) return
    const changingTemplate = patch.resourceTemplateUuid !== undefined &&
      patch.resourceTemplateUuid !== editorProjection.resourceTemplateUuid
    const changingMount = patch.mountUuid !== undefined &&
      patch.mountUuid !== editorProjection.mountUuid
    const next: MaterialSourceSelectorUpdate = {
      mode: patch.mode ?? editorProjection.mode,
      resourceTemplateUuid: patch.resourceTemplateUuid ??
        editorProjection.resourceTemplateUuid,
      mountUuid: patch.mountUuid ?? editorProjection.mountUuid,
      fixedMaterialUuid: patch.fixedMaterialUuid !== undefined
        ? patch.fixedMaterialUuid
        : changingTemplate
          ? null
          : editorProjection.fixedMaterialUuid,
      siteScope: patch.siteScope ?? (
        changingTemplate || changingMount ? 'all' : editorProjection.siteScope
      ),
      fixedSiteUuid: patch.fixedSiteUuid !== undefined
        ? patch.fixedSiteUuid
        : changingTemplate || changingMount
          ? null
          : editorProjection.fixedSiteUuid,
      candidateSiteUuids: patch.candidateSiteUuids ?? (
        changingTemplate || changingMount
          ? []
          : editorProjection.candidateSiteUuids
      ),
      flowRole: patch.flowRole ?? editorProjection.flowRole
    }
    try {
      const updated = updateMaterialSourceSelector(
        effectiveMaterialSourceCatalog,
        graph,
        selectedNodeUuid,
        next
      )
      setGraph(updated)
      setCanvasDirty(true)
      setError(null)
      setMessage('物料来源选择已更新；保存前将生成完整 Python')
    } catch (updateError) {
      setError(errorMessage(updateError))
    }
  }
  const updateTypedField = (handleUuid: string, value: unknown): void => {
    if (!actionCatalog || !graph || !selectedNodeUuid) return
    try {
      const next = updateTypedActionLiteral(
        actionCatalog,
        graph,
        selectedNodeUuid,
        handleUuid,
        value
      )
      setGraph(next)
      setCanvasDirty(true)
      setMessage('操作参数已更新；保存前将生成完整 Python')
    } catch (updateError) {
      setError(errorMessage(updateError))
    }
  }

  const updateTypedFieldFromRaw = (
    field: TypedActionFieldProjection,
    raw: string
  ): void => {
    try {
      updateTypedField(field.handleUuid, parseTypedFieldValue(field, raw))
    } catch (parseError) {
      setError(errorMessage(parseError))
    }
  }

  const bindTypedFieldToWorkflowInput = (
    handleUuid: string,
    parameter: string
  ): void => {
    if (!actionCatalog || !graph || !selectedNodeUuid) return
    try {
      const next = bindTypedActionWorkflowInput(
        actionCatalog,
        graph,
        selectedNodeUuid,
        handleUuid,
        parameter
      )
      setGraph(next)
      setCanvasDirty(true)
      setMessage('操作参数已绑定工作流入参；保存前将生成完整 Python')
    } catch (bindingError) {
      setError(errorMessage(bindingError))
    }
  }

  const connectTypedHandles = (connection: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }): void => {
    if (!actionCatalog || !graph) return
    try {
      const sourceNode = graph.nodes.find(
        (node) => node.uuid === connection.sourceNodeUuid
      )
      let next: WorkflowAuthoringGraph
      if (sourceNode?.type === 'material_source') {
        if (!materialSourceCatalog) {
          throw new Error('物料来源目录尚未就绪')
        }
        next = connectMaterialSourceToTypedActionEdge(
          actionCatalog,
          materialSourceCatalog,
          graph,
          connection
        )
      } else {
        next = connectTypedActionEdge(actionCatalog, graph, connection)
      }
      setGraph(next)
      setCanvasDirty(true)
      setMessage('已使用真实端口创建连线；保存前将生成完整 Python')
    } catch (connectError) {
      setError(errorMessage(connectError))
    }
  }

  const appliedIo = aggregate
    ? workflowIoMetadata(aggregate.applied_graph)
    : null
  const candidateIo = graph ? workflowIoMetadata(graph) : null

  return {
    acceptFullSourceDiff, actionCatalog, actionParametersOpen,
    addMaterialSourceNode, addPublishedWorkflowNode, addTypedActionNode,
    adoptRemoteConflict, aggregate, appliedIo,
    applyCandidate, beautifyCanvasLayout, bindTypedFieldToWorkflowInput,
    busy, candidateIo, codeProjection, connectTypedHandles,
    deleteCanvasElements, diagnostics,
    dirty, discardAndSwitch, editor, effectiveMaterialSourceCatalog, error,
    fileUpload, fullSourceDiff, graph, jsonProjectionEditor,
    materialSourceAuthorityBlocked, materialSourceCatalogError,
    materialSourceCatalogLoading, materialTraces, message, mode,
    nodePaletteOpen, onChooseWorkflow, pendingMode, policy, projectionKind,
    refreshMaterialSourceCatalog, remoteConflict, requestMode,
    retryLocalAfterConflict, runtime, saveDraft, selectCanvasNode,
    selectedActionEditor,
    selectedActionProjection, selectedActionTemplate, selectedIsMaterialSource,
    selectedMaterialSourceEditor, selectedMaterialSourceProjection,
    selectedNodeIsInternal, selectedNodeName, selectedNodeUuid,
    setActionParametersOpen, setCanvasDirty, setCodeProjection, setError,
    setFullSourceDiff, setGraph, setMessage, setNodePaletteOpen,
    setPendingMode, setRemoteConflict, setSelectedNodeName,
    setSelectedNodeNameDirty, setSelectedNodeUuid, setWorkflowIoOpen, structure,
    traceRuntime, updateMaterialSource, updateTypedField,
    updateTypedFieldFromRaw, workflowIoOpen, workflowUuid,
    ...taskPanel
  }
}
