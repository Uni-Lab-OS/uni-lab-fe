import { useCodeMirror } from '@unilab/code-editor'
import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringAggregate,
  WorkflowAuthoringApplyResponse,
  WorkflowAuthoringGraph,
  WorkflowAuthoringTransformResult
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
import { rehydrateTypedActionGraph } from '../utils/workflowActionCatalog'
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
  authoringRemoteConflict,
  authoringSaveFailureAction,
  authoringStateMessage,
  catalogConflictDecision,
  draftSaveMessage,
  isAuthoringConflict,
  isAuthoringSnapshotDirty,
  isSameAuthoringVersion,
  isTemplateCatalogConflict
} from '../utils/persistentAuthoringSession'
import {
  authoritativePython,
  errorMessage,
  rebaseGraphIdentity,
  workflowGraphJsonProjection,
  workflowIoMetadata
} from '../utils/persistentAuthoringProjection'
import type {
  FullSourceDiff,
  PersistentWorkflowAuthoringOptions,
  RemoteConflict,
  WorkflowCodeProjection
} from './persistentWorkflowAuthoringTypes'
import { usePersistentWorkflowCanvasNodeEditor } from './usePersistentWorkflowCanvasNodeEditor'
import { usePersistentWorkflowCatalogs } from './usePersistentWorkflowCatalogs'
import { usePersistentWorkflowStartFlow } from './usePersistentWorkflowStartFlow'
import { usePersistentWorkflowTaskPanel } from './usePersistentWorkflowTaskPanel'
import { useWorkflowIdeSourceProjection } from './useWorkflowIdeSourceProjection'
import { useWorkflowPanelRuntimeProjection } from './useWorkflowPanelRuntimeProjection'

export type { PersistentWorkflowAuthoringOptions } from './persistentWorkflowAuthoringTypes'

/**
 * 建立由当前定义权威聚合驱动的工作流（Workflow）编写会话。
 *
 * @param options 运行时端口、工作流标识及跨面板协作回调。
 * @returns 工作流编写视图、工具栏和运行控制共用的受控模型。
 */
export function usePersistentWorkflowAuthoring({
  runtime,
  definitionPort,
  definitionEditingStatus,
  workflowUuid,
  traceRuntime,
  resourceSlotOptionsPort,
  executionStatus,
  onUnsavedChangesChange,
  onWorkflowRuntimeProjectionChange,
  onSelectedWorkflowStepChange,
  onChooseWorkflow,
  ideBridge,
  hideEmbeddedCodeEditor = false
}: PersistentWorkflowAuthoringOptions) {
  const [mode, setMode] = useState<WorkflowEditMode>(
    () => definitionPort.capabilities.sourceEditing ? 'code' : 'canvas'
  )
  const [codeProjection, setCodeProjection] =
    useState<WorkflowCodeProjection>('python')
  const [aggregate, setAggregate] =
    useState<WorkflowAuthoringAggregate | null>(null)
  const policy = workflowAuthoringSurfacePolicy(mode)
  const canvasMutationEnabled = policy.canvasMutationEnabled &&
    definitionEditingStatus?.available !== false
  const editor = useCodeMirror(
    '',
    'python',
    '',
    !definitionPort.capabilities.sourceEditing ||
      policy.pythonEditorReadOnly || aggregate === null
  )
  const jsonProjectionEditor = useCodeMirror('', 'json', '', true)
  const [graph, setGraph] = useState<WorkflowAuthoringGraph | null>(null)
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
  // 外部 IDE 已占用同窗宽度时，默认把节点库收起；用户仍可显式展开。
  // Kernel Web 保持原有默认展开行为。
  const [nodePaletteOpen, setNodePaletteOpen] = useState(
    () => !hideEmbeddedCodeEditor
  )
  const [message, setMessage] = useState(
    definitionPort.capabilities.authority === 'backend'
      ? '正在读取 Backend 工作流图…'
      : '正在读取 OS 工作流编辑状态…'
  )
  const [error, setError] = useState<string | null>(null)
  const {
    actionCatalog,
    actionCatalogError,
    effectiveMaterialSourceCatalog,
    materialSourceAuthorityBlocked,
    materialSourceCatalog,
    materialSourceCatalogError,
    materialSourceCatalogLoading,
    refreshMaterialSourceCatalog,
    refreshWorkflowCatalogsAfterConflict
  } = usePersistentWorkflowCatalogs({ runtime, graph })
  // Resource-template source navigation uses the same exact package identity
  // as Workflow navigation. Re-entering that source deterministically selects
  // the first MaterialSource/ResourceSlot consumer in the current graph.
  useEffect(() => {
    const sourceUri = ideBridge?.activeSourceUri
    if (!sourceUri || !graph || !effectiveMaterialSourceCatalog) return
    const templateUuids = new Set(
      effectiveMaterialSourceCatalog.resourceTemplates
        .filter(template => template.sourceUri === sourceUri)
        .map(template => template.uuid)
    )
    if (templateUuids.size === 0) return
    const matches = graph.nodes.filter(node => {
      if (node.type !== 'material_source' || !node.param ||
        typeof node.param !== 'object' || Array.isArray(node.param)) return false
      return templateUuids.has(String(
        (node.param as Record<string, unknown>)['resource_template_uuid'] ?? ''
      ))
    }).sort((left, right) => String(left.uuid).localeCompare(String(right.uuid)))
    const match = matches[0]
    const matchUuid = match ? String(match.uuid) : null
    if (matchUuid && matchUuid !== selectedNodeUuid) setSelectedNodeUuid(matchUuid)
  }, [
    effectiveMaterialSourceCatalog,
    graph,
    ideBridge?.activeSourceUri,
    selectedNodeUuid
  ])
  // 首次 OS 聚合返回前保持忙碌，避免新建工作流首帧误触编辑命令。
  const [busy, setBusy] = useState(true)
  const [pendingMode, setPendingMode] = useState<WorkflowEditMode | null>(null)
  const [fullSourceDiff, setFullSourceDiff] =
    useState<FullSourceDiff | null>(null)
  const [pendingPythonImport, setPendingPythonImport] =
    useState<string | null>(null)
  const [remoteConflict, setRemoteConflict] =
    useState<RemoteConflict | null>(null)
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
    if (
      !graph ||
      !canvasMutationEnabled ||
      busy
    ) return
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
  }, [
    busy,
    canvasMutationEnabled,
    graph,
  ])
  const materialTraces = useMemo(
    () => projectMaterialTraces(structure.nodes, structure.links),
    [structure.links, structure.nodes]
  )
  const dirty = mode === 'code'
    ? editor.isDirty
    : canvasDirty || selectedNodeNameDirty
  const taskPanel = usePersistentWorkflowTaskPanel({
    runtime,
    definitionPort,
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

  const sourceProjection = useWorkflowIdeSourceProjection({
    aggregate,
    workflowUuid,
    sourceMap: taskPanel.codeSourceMap,
    ideBridge
  })

  useEffect(() => {
    onUnsavedChangesChange?.(dirty)
  }, [dirty, onUnsavedChangesChange])

  useEffect(
    () => () => onUnsavedChangesChange?.(false),
    [onUnsavedChangesChange]
  )

  /**
   * 安装权威工作流编写聚合，并为首次画布展示建立本地美化布局。
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
    setError(null)
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
    setBusy(true)
    setError(null)
    void queue.run(
      () => definitionPort.read()
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
  }, [definitionPort, installAggregate, queue])

  useEffect(
    /**
     * 维持工作流创作（Authoring）失效订阅，并在重连后补读 REST 权威状态。
     *
     * @returns 卸载时释放 SSE 与阻止在途结果安装的清理函数。
     */
    function synchronizeAuthoringAuthority(): () => void {
      let active = true
      let refreshInFlight = false
      let refreshPending = false
      let lastRefreshError: string | null = null

      /** 合并并串行执行一次 REST 权威状态刷新。 */
      const refreshFromAuthority = async (): Promise<void> => {
        if (refreshInFlight) {
          refreshPending = true
          return
        }
        refreshInFlight = true
        try {
          do {
            refreshPending = false
            const next = await queue.run(() => definitionPort.read())
            if (!active) return
            if (lastRefreshError !== null) {
              const recoveredError = lastRefreshError
              lastRefreshError = null
              setError((current) =>
                current === recoveredError ? null : current
              )
            }
            const current = localState.current
            if (isSameAuthoringVersion(next, current.aggregate)) {
              remotePending.current = false
              continue
            }
            if (isAuthoringSnapshotDirty(current)) {
              remotePending.current = true
              setRemoteConflict(authoringRemoteConflict(next, current))
              setMessage('检测到外部修改；本地内容已保留，请比较后明确处理')
              return
            }
            remotePending.current = false
            installAggregate(next, '已同步外部修改')
          } while (active && refreshPending)
        } catch (refreshError) {
          if (active) {
            lastRefreshError = errorMessage(refreshError)
            setError(lastRefreshError)
          }
        } finally {
          refreshInFlight = false
        }
      }

      /** 把匹配当前工作流的 SSE 失效通知转换为一次 REST 权威刷新。 */
      const handleAuthoringInvalidation = (
        event: { revision: number | null }
      ): void => {
        const current = localState.current
        if (
          event.revision !== null &&
          event.revision === current.aggregate?.workflow_revision
        ) return
        remotePending.current = true
        void refreshFromAuthority()
      }

      const subscription = definitionPort.subscribe(
        handleAuthoringInvalidation,
        {
          onOpen: ({ reconnected }) => {
            setError((current) =>
              current?.startsWith('工作流创作实时同步中断：')
                ? null
                : current
            )
            if (reconnected) {
              remotePending.current = true
              void refreshFromAuthority()
            }
          },
          onError: (streamError) => {
            setError(
              `${definitionPort.capabilities.label} 工作流实时同步中断：` +
              streamError.message
            )
          }
        }
      )
      return () => {
        active = false
        subscription.dispose()
      }
    },
    [definitionPort, installAggregate, queue]
  )

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
      () => definitionPort.read()
    )
    const current = localState.current
    if (!isAuthoringSnapshotDirty(current)) {
      remotePending.current = false
      installAggregate(remote, '已同步远端工作流编辑状态')
      return
    }
    remotePending.current = true
    setRemoteConflict(authoringRemoteConflict(remote, current))
    setMessage('远端状态已补读；本地内容保持不变，请比较后明确处理')
  }, [definitionPort, installAggregate, queue])

  const generateCanvasPython = useCallback(async (
    sourceGraph: WorkflowAuthoringGraph,
    authority: WorkflowAuthoringAggregate = aggregate as WorkflowAuthoringAggregate
  ): Promise<WorkflowAuthoringTransformResult> => {
    if (!definitionPort.capabilities.sourceEditing) {
      throw new Error(
        definitionPort.capabilities.sourceEditingDisabledReason ??
        '当前数据源不支持工作区源码编辑'
      )
    }
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
    definitionPort,
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
    if (nextMode === 'code' && !definitionPort.capabilities.sourceEditing) {
      throw new Error(
        definitionPort.capabilities.sourceEditingDisabledReason ??
        '当前数据源不支持代码模式'
      )
    }
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
  }, [aggregate, definitionPort, editor.replaceContent, generateCanvasPython])

  /**
   * 请求切换工作流单编辑权模式。
   *
   * @param nextMode 用户请求进入的代码或画布模式。
   * @returns 无返回值；OS 聚合未就绪或正在处理时保持当前模式。
   */
  const requestMode = (nextMode: WorkflowEditMode): void => {
    if (busy || !aggregate) return
    if (nextMode === 'code' && !definitionPort.capabilities.sourceEditing) {
      setError(
        definitionPort.capabilities.sourceEditingDisabledReason ??
        '当前数据源不支持代码模式'
      )
      return
    }
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
      if (definitionPort.capabilities.directGraphSaving) {
        const saved = await definitionPort.saveGraph(sourceGraph)
        remotePending.current = false
        installAggregate(
          saved,
          `${definitionPort.capabilities.label} 工作流图已保存，` +
          `当前修订 ${saved.workflow_revision}`
        )
        return
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

  /**
   * 接受完整工作流源码（Workflow Source）差异并执行一次保存或应用。
   *
   * @returns 无返回值；异步失败由统一运行包装器转为用户可见错误。
   */
  const acceptFullSourceDiff = (): void => {
    if (!fullSourceDiff || busy) return
    if (workflowStart.acceptWorkflowStartReview()) return
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
        const failureAction = authoringSaveFailureAction(saveError)
        if (failureAction === 'close_diff_and_report') {
          setFullSourceDiff(null)
          throw saveError
        }
        if (failureAction === 'report') throw saveError
        setFullSourceDiff(null)
        remotePending.current = true
        await readRemoteConflict()
      }
    })
  }

  /**
   * 关闭完整源码差异；若它属于运行入口，同时取消尚未应用的运行意图。
   *
   * @returns 无返回值；已经保存或应用的操作系统（OS）权威事实不会撤销。
   */
  const cancelFullSourceDiff = (): void => {
    workflowStart.cancelWorkflowStartReview()
    setFullSourceDiff(null)
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
   * 只使用操作系统（OS）签发的候选哈希应用工作流创作候选。
   *
   * @param candidateHash 当前候选的稳定内容身份。
   * @returns 应用结果与最新工作流创作权威聚合。
   */
  const applyCandidateByHash = async (
    candidateHash: string
  ): Promise<WorkflowAuthoringApplyResponse> => {
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
      return applied
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
        () => definitionPort.read()
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
      await applyCandidateByHash(candidateHash)
    })
  }

  const projectionKind = aggregate
    ? authoringProjection(aggregate).kind
    : null
  const diagnostics = aggregate?.draft?.diagnostics ?? []
  const canvasNodeEditor = usePersistentWorkflowCanvasNodeEditor({
    actionCatalog,
    canvasMutationEnabled,
    codeSourceMap: taskPanel.codeSourceMap,
    diagnostics,
    effectiveMaterialSourceCatalog,
    graph,
    materialSourceAuthorityBlocked,
    materialSourceCatalog,
    revealLine: editor.revealLine,
    selectedNodeNameDirty,
    selectedNodeUuid,
    setActionParametersOpen,
    setCanvasDirty,
    setError,
    setGraph,
    setMessage,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    ideBridge,
    sourceProjection
  })
  const selectedActionHasMaterialPort = Boolean(
    canvasNodeEditor.selectedActionEditor?.fields.some(
      (field) => field.editorControl === 'material_port'
    )
  )
  useEffect(() => {
    if (!actionParametersOpen || !selectedActionHasMaterialPort) return
    void taskPanel.refreshResourceSlotOptions()
  }, [
    actionParametersOpen,
    selectedActionHasMaterialPort,
    selectedNodeUuid,
    taskPanel.refreshResourceSlotOptions
  ])

  const executionBlockedReason = executionStatus?.available === false
    ? executionStatus.reason || 'OS 未就绪；请先在环境管理中启动 OS'
    : null
  const workflowStart = usePersistentWorkflowStartFlow({
    context: {
      aggregate,
      dirty,
      blockedReason: executionBlockedReason ?? (
        materialSourceAuthorityBlocked
          ? '物料来源目录或引用已失效，请先刷新'
          : null
      ),
      editMode: mode
    },
    hasRemoteInvalidation: () => remotePending.current,
    commands: {
      /**
       * 保存当前可写工作流源码（Workflow Source），或为画布生成完整差异。
       *
       * @returns 已保存权威聚合，或等待用户确认的完整源码差异。
       */
      saveDraft: async () => {
        if (!aggregate) throw new Error('工作流编辑数据尚未就绪')
        if (mode === 'code') {
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
            remotePending.current = false
            installAggregate(saved, draftSaveMessage(saved))
            return { kind: 'saved' as const, aggregate: saved, editMode: mode }
          } catch (saveError) {
            if (!isAuthoringConflict(saveError)) throw saveError
            remotePending.current = true
            await readRemoteConflict()
            throw saveError
          }
        }
        if (!graph) throw new Error('当前画布数据尚未就绪')
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
        if (definitionPort.capabilities.directGraphSaving) {
          const saved = await definitionPort.saveGraph(sourceGraph)
          remotePending.current = false
          installAggregate(
            saved,
            `${definitionPort.capabilities.label} 工作流图已保存，` +
            `当前修订 ${saved.workflow_revision}`
          )
          return { kind: 'saved' as const, aggregate: saved, editMode: mode }
        }
        const generated = await generateCanvasPython(sourceGraph)
        const generatedPython = generated.normalized_python_source
        if (!generatedPython) throw new Error('OS 未返回完整规范化 Python')
        return {
          kind: 'review' as const,
          review: {
            before: authoritativePython(aggregate),
            after: generatedPython,
            expectedDraftHash: aggregate.draft?.draft_hash ?? null,
            expectedWorkflowRevision: aggregate.workflow_revision,
            reason: 'canvas_save' as const,
            resumeMode: 'canvas' as const
          }
        }
      },

      /**
       * 使用用户接受的完整源码与双 CAS 坐标保存工作流源码（Workflow Source）。
       *
       * @param command 状态机冻结的源码、修订和恢复模式。
       * @returns 保存后的权威聚合与恢复编辑模式。
       */
      saveReviewedSource: async (command) => {
        try {
          const saved = await queue.run(
            () => runtime.saveWorkflowAuthoringDraft(
              workflowUuid,
              {
                python_source: command.pythonSource,
                expected_draft_hash: command.expectedDraftHash,
                expected_workflow_revision: command.expectedWorkflowRevision
              }
            )
          )
          remotePending.current = false
          setFullSourceDiff(null)
          installAggregate(saved, draftSaveMessage(saved))
          if (command.reason === 'source_normalization') {
            setPendingPythonImport(null)
          }
          setMode(command.resumeMode)
          return { aggregate: saved, editMode: command.resumeMode }
        } catch (saveError) {
          if (!isAuthoringConflict(saveError)) throw saveError
          remotePending.current = true
          const refreshed = await queue.run(
            () => definitionPort.read()
          )
          setFullSourceDiff({
            before: authoritativePython(refreshed),
            after: command.pythonSource,
            expectedDraftHash: refreshed.draft?.draft_hash ?? null,
            expectedWorkflowRevision: refreshed.workflow_revision,
            reason: 'conflict_retry',
            resumeMode: command.resumeMode,
            applyAfterSave: false
          })
          setMessage(
            '运行前检测到外部修改；本地完整源码已保留，请比较后明确处理'
          )
          throw saveError
        }
      },
      applyCandidate: applyCandidateByHash,
      readApplied: () => queue.run(() => definitionPort.read()),
      openTaskInput: taskPanel.openTaskInputFormForAuthority,
      resolveRemoteConflict: () => {
        void run(readRemoteConflict)
      }
    },
    setFullSourceDiff,
    setMessage,
    setError
  })

  const appliedIo = aggregate
    ? workflowIoMetadata(aggregate.applied_graph)
    : null
  const candidateIo = graph ? workflowIoMetadata(graph) : null

  return {
    acceptFullSourceDiff, actionCatalog, actionCatalogError, actionParametersOpen,
    adoptRemoteConflict, aggregate, appliedIo,
    applyCandidate, beautifyCanvasLayout,
    busy, cancelFullSourceDiff, candidateIo, canvasMutationEnabled,
    canvasSaveHint: definitionPort.capabilities.directGraphSaving
      ? '画布缓冲已修改；保存后将以修订 CAS 写入 Backend'
      : '画布缓冲已修改；保存前将生成完整 Python 差异',
    codeProjection,
    diagnostics,
    authorityLabel: definitionPort.capabilities.label,
    debugLaunchAvailable: definitionPort.capabilities.debugLaunch,
    definitionEditingAvailable: definitionEditingStatus?.available !== false,
    definitionEditingDisabledReason: definitionEditingStatus?.reason ?? null,
    executionBlockedReason,
    dirty, discardAndSwitch, editor, effectiveMaterialSourceCatalog, error,
    fileUpload, fullSourceDiff, graph, jsonProjectionEditor,
    materialSourceAuthorityBlocked, materialSourceCatalogError,
    materialSourceCatalogLoading, materialTraces, message, mode,
    nodePaletteOpen, onChooseWorkflow, pendingMode, policy, projectionKind,
    refreshMaterialSourceCatalog, remoteConflict, requestMode,
    retryLocalAfterConflict, runtime, saveDraft,
    selectedNodeName, selectedNodeUuid,
    setActionParametersOpen, setCanvasDirty, setCodeProjection, setError,
    setFullSourceDiff, setGraph, setMessage, setNodePaletteOpen,
    setPendingMode, setRemoteConflict, setSelectedNodeName,
    setSelectedNodeNameDirty, setSelectedNodeUuid, setWorkflowIoOpen, structure,
    ideBridgeConnected: Boolean(ideBridge?.onSourceProjectionChange),
    revealPackageSource: (sourceUri: string) => {
      ideBridge?.onRevealPackageSource?.({ sourceUri })
    },
    sourceProjection, traceRuntime, workflowIoOpen, workflowUuid,
    sourceEditingAvailable: definitionPort.capabilities.sourceEditing,
    sourceEditingDisabledReason:
      definitionPort.capabilities.sourceEditingDisabledReason,
    ...canvasNodeEditor,
    ...taskPanel,
    ...workflowStart
  }
}
