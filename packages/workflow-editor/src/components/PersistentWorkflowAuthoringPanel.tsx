/*
 * THESIS: MaterialSource should read as an OS-owned material declaration flowing into compact Actions, not as another executable card.
 * OWN-WORLD: Extend the established “精密仪器台 / Precision Instrument Bench” with LINQ-inspired palette, trace, and Properties relationships.
 * STORY: Choose a source, configure its closed selector, review the generated Python diff, Apply, then let OS Task admission bind real Inventory.
 * FIRST VIEWPORT: Canvas mode reveals MaterialSource palette → graph trace → Properties inspector before secondary authoring detail.
 * FORM: Cool neutral instrument surfaces, restrained control blue, deterministic purple/indigo identity accents, and textual state evidence.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */
import { useCodeMirror, CodeEditor } from '@unilab/code-editor'
import { SlideOverDrawer } from '@unilab/design-system'
import type {
  WorkflowActionCatalogSnapshot,
  WorkflowNodeJob,
  WorkflowAuthoringDiagnostic,
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringSourceMapEntry,
  WorkflowAuthoringTransformResult,
  WorkflowIoMetadata,
  WorkflowMaterialSourceCatalogSnapshot,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskCommandType,
  WorkflowTaskRunMode
} from '@unilab/services'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { WorkflowTracePort } from '../traceRuntime'
import {
  createWorkflowExecutionScope
} from '../utils/canonicalWorkflow'
import { useWorkflowFileUpload } from '../hooks/useWorkflowFileUpload'
import {
  workflowAuthoringModeSwitchDecision,
  workflowAuthoringSurfacePolicy,
  workflowCanvasDraftSaveDecision,
  type WorkflowEditMode
} from '../utils/workflowCanvasPolicy'
import {
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
  materialTraceAccent,
  projectMaterialTraces
} from '../utils/workflowMaterialTrace'
import {
  projectWorkflowTaskEvents,
  projectWorkflowTaskJob
} from '../utils/workflowTaskOutputProjection'
import {
  AuthoringOperationQueue,
  authoringProjection,
  authoringStateMessage,
  catalogConflictDecision,
  diagnosticRange,
  draftSaveMessage,
  isAuthoringConflict,
  isCurrentAuthoringInvalidation,
  isSameAuthoringVersion,
  isTemplateCatalogConflict
} from '../utils/persistentAuthoringSession'
import { projectWorkflowCodeMarkers } from '../utils/workflowCodeMarkers'
import {
  workflowTaskControlStatusLabel,
  workflowTaskControls,
  workflowTaskStatusLabel,
  workflowTaskVisualStatus
} from '../utils/workflowTaskPresentation'
import { useWorkflowTaskRuntime } from '../hooks/useWorkflowTaskRuntime'
import type {
  WorkflowTaskRuntimeSnapshot
} from '../runtime/WorkflowTaskController'
import WorkflowDag from './WorkflowDag'
import { workflowNodeStateLabel } from './WorkflowNodeCard'
import {
  WorkflowDebugger
} from './WorkflowDebugger'
import {
  WorkflowOutput,
  type WorkflowOutputTab
} from './WorkflowOutput'
import { WorkflowIoSummary } from './WorkflowIoSummary'
import { WorkflowIoEditor } from './WorkflowIoEditor'
import { WorkflowTaskInputForm } from './WorkflowTaskInputForm'
import { WorkflowActionParameterDrawer } from './WorkflowActionParameterDrawer'
import { useWorkflowSessionStore } from './WorkflowSessionProvider'
import { WorkflowTraceViewer } from './WorkflowTraceViewer'
import {
  createWorkflowTaskInputForm,
  containsResourceSlotInput,
  setWorkflowTaskInputField,
  submitWorkflowTaskInput,
  type WorkflowTaskInputFieldState,
  type WorkflowTaskInputFormState
} from '../utils/workflowTaskInputForm'
import {
  loadWorkflowResourceSlotOptions,
  type WorkflowResourceSlotOptionsPort,
  type WorkflowResourceSlotOptionsState
} from '../utils/workflowResourceSlotOptions'
import { workflowTaskInputProblem } from '../utils/workflowTaskInputProblem'
import styles from './workflow.module.scss'

interface PersistentWorkflowAuthoringPanelProps {
  runtime: WorkflowRuntimePort
  workflowUuid: string
  traceRuntime?: WorkflowTracePort
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  onChooseWorkflow?: () => void
}

interface FullSourceDiff {
  before: string
  after: string
  expectedDraftHash: string | null
  expectedWorkflowRevision: number
  reason: 'canvas_save' | 'conflict_retry' | 'source_normalization'
  resumeMode: WorkflowEditMode
}

interface RemoteConflict {
  remote: WorkflowAuthoringAggregate
  localMode: WorkflowEditMode
  localPython: string
  localGraph: WorkflowAuthoringGraph | null
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}

interface PersistentWorkflowDebugSession {
  startNodeId: string | null
  breakpoints: string[]
}

export function PersistentWorkflowAuthoringPanel({
  runtime,
  workflowUuid,
  traceRuntime,
  resourceSlotOptionsPort,
  onUnsavedChangesChange,
  onChooseWorkflow
}: PersistentWorkflowAuthoringPanelProps): React.JSX.Element {
  const sessionStore = useWorkflowSessionStore()
  const debugSessionKey = `unilab.workflow.debug.${workflowUuid}.v1`
  const [initialDebugSession] = useState<PersistentWorkflowDebugSession | null>(
    () => sessionStore?.read<PersistentWorkflowDebugSession>(
      debugSessionKey
    ) ?? null
  )
  const [mode, setMode] = useState<WorkflowEditMode>('code')
  const [aggregate, setAggregate] =
    useState<WorkflowAuthoringAggregate | null>(null)
  const policy = workflowAuthoringSurfacePolicy(mode)
  const editor = useCodeMirror(
    '',
    'python',
    '',
    policy.pythonEditorReadOnly || aggregate === null
  )
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
  const [taskRunMode, setTaskRunMode] =
    useState<Exclude<WorkflowTaskRunMode, 'single_node'>>('normal')
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [taskInputAuthority, setTaskInputAuthority] =
    useState<WorkflowAuthoringAggregate | null>(null)
  const [taskInputForm, setTaskInputForm] =
    useState<WorkflowTaskInputFormState | null>(null)
  const [taskInputProblem, setTaskInputProblem] = useState<string | null>(null)
  const [resourceSlotOptions, setResourceSlotOptions] =
    useState<WorkflowResourceSlotOptionsState | undefined>(undefined)
  const [traceViewerOpen, setTraceViewerOpen] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(true)
  const [outputTab, setOutputTab] = useState<WorkflowOutputTab>('nodes')
  const [selectedJobNodeUuid, setSelectedJobNodeUuid] =
    useState<string | null>(null)
  const [debugStartNodeId, setDebugStartNodeId] = useState<string | null>(
    initialDebugSession?.startNodeId ?? null
  )
  const [debugBreakpoints, setDebugBreakpoints] = useState<Set<string>>(
    () => new Set(initialDebugSession?.breakpoints ?? [])
  )
  const taskRuntime = useWorkflowTaskRuntime(runtime, workflowUuid)
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
          setGraph(generated.graph)
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
            graph: generated.graph,
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
      ? projectPersistentAuthoringGraph(graph)
      : { nodes: [], links: [], steps: [], error: null },
    [graph]
  )
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
  const debugExecutionScope = useMemo(
    () => createWorkflowExecutionScope(
      structure.nodes,
      structure.links,
      debugStartNodeId
    ),
    [debugStartNodeId, structure.links, structure.nodes]
  )
  const dirty = mode === 'code'
    ? editor.isDirty
    : canvasDirty || selectedNodeNameDirty
  const task = taskRuntime.snapshot.task
  const taskJobs = taskRuntime.snapshot.jobs
  const taskOutputNodes = useMemo(
    () => taskJobs.map(projectWorkflowTaskJob),
    [taskJobs]
  )
  const failedTaskJobCount = useMemo(
    () => taskOutputNodes.filter((node) => node.state === 'failed').length,
    [taskOutputNodes]
  )
  const selectedTaskNode = taskOutputNodes.find(
    (node) => node.sourceNodeId === selectedJobNodeUuid
  )
  const completedTaskJobCount = taskJobs.filter(
    (job) => TERMINAL_JOB_STATUSES.has(job.status)
  ).length
  const taskControls = useMemo(
    () => workflowTaskControls(task, runtimeBusy),
    [runtimeBusy, task]
  )
  const taskNodeNames = useMemo(
    () => Object.fromEntries(structure.nodes.map((node) => [
      node.id,
      node.name || node.id
    ])),
    [structure.nodes]
  )
  const taskRuntimeEvents = useMemo(
    () => projectWorkflowTaskEvents(
      taskRuntime.snapshot.events,
      taskRuntime.snapshot.feedback,
      taskJobs
    ),
    [
      taskJobs,
      taskRuntime.snapshot.events,
      taskRuntime.snapshot.feedback
    ]
  )
  const taskNodeStates = useMemo(
    () => Object.fromEntries(taskJobs.map((job) => [
      job.workflow_node_uuid,
      workflowTaskDagState(
        job.status,
        structure.nodes.find((node) => node.id === job.workflow_node_uuid)
          ?.type === 'material_source',
        task?.status
      )
    ])),
    [structure.nodes, task?.status, taskJobs]
  )
  const codeSourceMap = useMemo(
    () => workflowSourceMap(aggregate, editor.value),
    [aggregate, editor.value]
  )
  const codeMarkers = useMemo(
    () => projectWorkflowCodeMarkers({
      nodeIds: structure.nodes.map((node) => node.id),
      resolveLine: (nodeId) => codeSourceMap.find(
        (entry) => entry.workflow_node_uuid === nodeId
      )?.start_line ?? null,
      startNodeId: debugExecutionScope.startNodeId,
      beforeStartNodeIds: debugExecutionScope.beforeStartNodeIds,
      breakpoints: debugBreakpoints,
      pausedBeforeNodeId: null,
      nodeStates: taskNodeStates
    }),
    [
      codeSourceMap,
      debugBreakpoints,
      debugExecutionScope.beforeStartNodeIds,
      debugExecutionScope.startNodeId,
      structure.nodes,
      taskNodeStates
    ]
  )

  useEffect(() => {
    if (structure.nodes.length === 0) return
    const validNodeIds = new Set(structure.nodes.map((node) => node.id))
    setDebugStartNodeId((current) =>
      current && !validNodeIds.has(current) ? null : current
    )
    setDebugBreakpoints((current) => {
      const next = new Set(
        [...current].filter((nodeId) => validNodeIds.has(nodeId))
      )
      return next.size === current.size ? current : next
    })
  }, [structure.nodes])

  useEffect(() => {
    sessionStore?.write<PersistentWorkflowDebugSession>(debugSessionKey, {
      startNodeId: debugExecutionScope.startNodeId,
      breakpoints: [...debugBreakpoints]
    })
  }, [
    debugBreakpoints,
    debugExecutionScope.startNodeId,
    debugSessionKey,
    sessionStore
  ])

  useEffect(() => {
    editor.setLineMarkers(codeMarkers)
  }, [codeMarkers, editor.setLineMarkers])

  useEffect(() => {
    if (
      selectedJobNodeUuid &&
      taskOutputNodes.some(
        (node) => node.sourceNodeId === selectedJobNodeUuid
      )
    ) return
    setSelectedJobNodeUuid(taskOutputNodes[0]?.sourceNodeId ?? null)
  }, [selectedJobNodeUuid, taskOutputNodes])

  useEffect(() => {
    if (failedTaskJobCount === 0) return
    setOutputExpanded(true)
    setOutputTab('errors')
  }, [failedTaskJobCount])

  useEffect(() => {
    onUnsavedChangesChange?.(dirty)
  }, [dirty, onUnsavedChangesChange])

  useEffect(
    () => () => onUnsavedChangesChange?.(false),
    [onUnsavedChangesChange]
  )

  const installAggregate = useCallback((
    next: WorkflowAuthoringAggregate,
    nextMessage: string
  ): void => {
    const projection = authoringProjection(next)
    const python = authoritativePython(next)
    setAggregate(next)
    setGraph(projection.graph)
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
      graph: projection.graph,
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

  const runRuntime = useCallback((
    operation: () => Promise<void>
  ): void => {
    setRuntimeBusy(true)
    void operation()
      .catch(() => undefined)
      .finally(() => setRuntimeBusy(false))
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
        currentFingerprint: refreshedCatalog.fingerprint
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

  const enterMode = useCallback(async (
    nextMode: WorkflowEditMode
  ): Promise<void> => {
    if (!aggregate) throw new Error('工作流编辑数据尚未就绪')
    setPendingPythonImport(null)
    if (nextMode === 'canvas') {
      const sourceGraph = authoringProjection(aggregate).graph
      const generated = await generateCanvasPython(sourceGraph)
      setGraph(generated.graph || sourceGraph)
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
          const normalized = saved.candidate?.normalized_python_source
          const draftSource = saved.draft?.python_source
          if (
            pendingPythonImport &&
            normalized &&
            draftSource &&
            normalized !== draftSource
          ) {
            setFullSourceDiff({
              before: draftSource,
              after: normalized,
              expectedDraftHash: saved.draft?.draft_hash ?? null,
              expectedWorkflowRevision: saved.workflow_revision,
              reason: 'source_normalization',
              resumeMode: 'code'
            })
            setMessage(
              `${pendingPythonImport} 已保存；请接受 OS 规范化 Python 后再应用`
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
          resumeMode: 'canvas'
        })
      }
    })
  }

  const acceptFullSourceDiff = (): void => {
    if (!fullSourceDiff) return
    const diff = fullSourceDiff
    const decision = workflowCanvasDraftSaveDecision({
      baselinePython: diff.before,
      generatedPython: diff.after,
      fullDiffAccepted: true
    })
    if (decision.kind !== 'write_complete_draft') return
    void run(async () => {
      try {
        const saved = await queue.run(
          () => runtime.saveWorkflowAuthoringDraft(
            workflowUuid,
            {
              python_source: decision.python_source,
              expected_draft_hash: diff.expectedDraftHash,
              expected_workflow_revision: diff.expectedWorkflowRevision
            }
          )
        )
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
        resumeMode: conflict.localMode
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

  const applyCandidate = (): void => {
    const candidateHash = aggregate?.candidate?.candidate_hash
    if (!candidateHash) {
      setError('当前没有可应用的服务器候选版本')
      return
    }
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
    setActionParametersOpen(Boolean(
      actionCatalog?.actionTemplates.some(
        (template) => template.uuid === node.workflow_node_template_uuid
      )
    ))
    const sourceLine = codeSourceMap.find(
      (entry) => entry.workflow_node_uuid === nodeUuid
    )?.start_line
    if (sourceLine) editor.revealLine(sourceLine)
  }

  const toggleDebugStartNode = (nodeUuid: string): void => {
    const removing = debugExecutionScope.startNodeId === nodeUuid
    setDebugStartNodeId(removing ? null : nodeUuid)
    setMessage(
      removing
        ? '已取消调试器起始点'
        : '已设置调试器起始点；普通任务不携带此配置'
    )
  }

  const toggleDebugBreakpoint = (nodeUuid: string): void => {
    const removing = debugBreakpoints.has(nodeUuid)
    setDebugBreakpoints((current) => {
      const next = new Set(current)
      if (next.has(nodeUuid)) next.delete(nodeUuid)
      else next.add(nodeUuid)
      return next
    })
    setMessage(
      removing
        ? '已取消调试器断点'
        : '已设置调试器断点；普通任务不携带此配置'
    )
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

  const openTaskInputForm = (): void => {
    setTaskInputProblem(null)
    runRuntime(async () => {
      try {
        const latest = await queue.run(
          () => runtime.getWorkflowAuthoring(workflowUuid)
        )
        const nextForm = createWorkflowTaskInputForm(latest)
        setTaskInputAuthority(latest)
        setTaskInputForm(nextForm)
        setResourceSlotOptions(undefined)
        if (nextForm.fields.some(({ descriptor }) =>
          containsResourceSlotInput(descriptor.schema)
        )) {
          setResourceSlotOptions(
            await loadWorkflowResourceSlotOptions(resourceSlotOptionsPort)
          )
        }
        setMessage(
          `本次运行使用已应用版本 ${latest.workflow_revision}；` +
          '未填写且没有默认值的字段将保持省略'
        )
      } catch (openError) {
        setError(errorMessage(openError))
        throw openError
      }
    })
  }

  const updateTaskInput = (
    name: string,
    state: WorkflowTaskInputFieldState
  ): void => {
    if (!taskInputForm) return
    const next = setWorkflowTaskInputField(taskInputForm, name, state)
    setTaskInputForm(next)
    setTaskInputProblem(null)
  }

  const submitTaskInput = (): void => {
    if (!taskInputAuthority || !taskInputForm) return
    const submittedForm = taskInputForm
    runRuntime(async () => {
      try {
        const result = await submitWorkflowTaskInput({
          form: submittedForm,
          readApplied: () => queue.run(
            () => runtime.getWorkflowAuthoring(workflowUuid)
          ),
          createTask: (input) => taskRuntime.create(taskRunMode, input)
        })
        if (result.kind === 'reproject_before_create') {
          setTaskInputAuthority(result.authority)
          setTaskInputForm(result.form)
          setTaskInputProblem(result.message)
          return
        }
        if (result.kind === 'reproject_after_create') {
          setTaskInputAuthority(result.authority)
          setTaskInputForm(result.form)
          setTaskInputProblem(result.message)
          setMessage(result.message)
          return
        }
        setTaskInputAuthority(null)
        setTaskInputForm(null)
        setTaskInputProblem(null)
        setMessage(result.message)
      } catch (submitError) {
        setTaskInputProblem(
          workflowTaskInputProblem(submitError, submittedForm)
        )
        throw submitError
      }
    })
  }
  const appliedIo = aggregate
    ? workflowIoMetadata(aggregate.applied_graph)
    : null
  const candidateIo = graph ? workflowIoMetadata(graph) : null

  return (
    <div
      className={[
        styles.workflow,
        'workflow-runtime persistent-authoring',
        'relative flex h-full w-full flex-col',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
    >
      <header className="workflow__toolbar persistent-authoring__toolbar">
        <div className="workflow__context">
          <div className="workflow__title-row">
            <span className="workflow__toolbar-label">工作流编写</span>
            <span className="workflow__format">OS 工作流编辑</span>
          </div>
          <span
            className="workflow-runtime__message"
            role="status"
            aria-live="polite"
          >
            {message}
          </span>
        </div>

        <div
          className="workflow__mode-switch"
          role="group"
          aria-label="工作流单编辑权模式"
        >
          <button
            type="button"
            className={mode === 'code' ? 'is-active' : ''}
            aria-pressed={mode === 'code'}
            disabled={busy}
            onClick={() => requestMode('code')}
          >
            代码模式
          </button>
          <button
            type="button"
            className={mode === 'canvas' ? 'is-active' : ''}
            aria-pressed={mode === 'canvas'}
            disabled={busy}
            onClick={() => requestMode('canvas')}
          >
            画布模式
          </button>
        </div>

        <div className="workflow__toolbar-actions">
          <input
            ref={fileUpload.inputRef}
            className="workflow__file-input"
            type="file"
            accept=".py,text/x-python"
            aria-label="选择工作流文件"
            onChange={fileUpload.handleFileChange}
          />
          <div
            className="persistent-authoring__toolbar-group"
            role="group"
            aria-label="工作流导航与导入"
          >
            {onChooseWorkflow && (
              <button
                type="button"
                className="workflow__upload"
                disabled={busy || dirty}
                title={dirty ? '请先保存当前可写表示' : undefined}
                onClick={onChooseWorkflow}
              >
                工作流列表
              </button>
            )}
            <button
              type="button"
              className="workflow__upload"
              disabled={busy || dirty || !aggregate}
              title={dirty ? '请先保存当前可写表示' : undefined}
              onClick={() => fileUpload.openFilePicker('python')}
            >
              导入 Python
            </button>
            <button
              type="button"
              className="workflow__upload"
              disabled={busy || dirty || !aggregate}
              title={dirty ? '请先保存当前可写表示' : undefined}
              onClick={() => fileUpload.openFilePicker('json')}
            >
              导入 JSON
            </button>
          </div>
          <div
            className="persistent-authoring__toolbar-group"
            role="group"
            aria-label="工作流保存与应用"
          >
            <button
              type="button"
              className="workflow__upload"
              disabled={busy || !aggregate}
              onClick={saveDraft}
            >
              保存草稿
            </button>
            <button
              type="button"
              className="workflow__upload persistent-authoring__apply"
              disabled={
                busy ||
                dirty ||
                !aggregate?.candidate ||
                materialSourceAuthorityBlocked
              }
              title={
                dirty
                  ? '请先保存当前可写表示'
                  : materialSourceAuthorityBlocked
                    ? '物料来源目录或引用已失效，请先刷新'
                    : undefined
              }
              onClick={applyCandidate}
            >
              应用工作流
            </button>
          </div>
          <div
            className="persistent-authoring__toolbar-group persistent-authoring__toolbar-run"
            role="group"
            aria-label="工作流任务运行"
          >
            <div
              className="workflow__mode-switch workflow__run-mode"
              role="group"
              aria-label="任务运行模式"
            >
            <button
              type="button"
              className={taskRunMode === 'normal' ? 'is-active' : ''}
              aria-pressed={taskRunMode === 'normal'}
              disabled={runtimeBusy}
              onClick={() => setTaskRunMode('normal')}
            >
              正常运行
            </button>
            <button
              type="button"
              className={taskRunMode === 'step' ? 'is-active' : ''}
              aria-pressed={taskRunMode === 'step'}
              disabled={runtimeBusy}
              onClick={() => setTaskRunMode('step')}
            >
              单步模式
            </button>
            </div>
            <button
              type="button"
              className="workflow-runtime__primary"
              disabled={
                busy ||
                runtimeBusy ||
                dirty ||
                !aggregate
              }
              title={
                dirty
                  ? '请先保存当前可写表示'
                  : aggregate
                    ? `将使用已应用版本 ${aggregate.workflow_revision}`
                    : '已应用工作流尚未就绪'
              }
              onClick={openTaskInputForm}
            >
              {runtimeBusy ? '处理中…' : '开始运行'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="workflow-runtime__problem" role="alert">
          <strong>工作流编辑操作失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      {taskRuntime.snapshot.error && (
        <div className="workflow-runtime__problem" role="alert">
          <strong>运行状态读取失败</strong>
          <span>
            {taskRuntime.snapshot.projectionStale
              ? `上一次一致状态已保留：${taskRuntime.snapshot.error}`
              : taskRuntime.snapshot.feedbackStale
                ? `已确认的反馈事件已保留：${taskRuntime.snapshot.error}`
                : taskRuntime.snapshot.error}
          </span>
          <button
            type="button"
            disabled={runtimeBusy}
            onClick={() => runRuntime(() => taskRuntime.refresh())}
          >
            重试状态读取
          </button>
          <button type="button" onClick={taskRuntime.clearError}>关闭</button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <section
          className="persistent-authoring__diagnostics"
          aria-label="Python 草稿诊断"
        >
          <strong>草稿诊断</strong>
          <ul>
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}:${index}`}>
                <code>{diagnostic.code}</code>
                <span>{diagnostic.message}</span>
                {diagnosticRange(diagnostic) && (
                  <span>位置 {diagnosticRange(diagnostic)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <main className={[
        'persistent-authoring__workbench',
        mode === 'canvas' ? 'is-canvas-mode' : ''
      ].filter(Boolean).join(' ')}>
        <section
          className="persistent-authoring__pane persistent-authoring__code"
          aria-label="Python 编写面"
        >
          <CodeEditor
            title={`${workflowUuid}.py`}
            editor={editor}
            language="Python"
          />
          <p className="persistent-authoring__authority-note">
            {mode === 'canvas'
              ? 'Python 是 OS 生成的只读投影'
              : 'Python 草稿可编辑；保存时校验草稿哈希与工作流版本'}
          </p>
        </section>

        <section
          className="persistent-authoring__pane persistent-authoring__canvas"
          aria-label="工作流画布"
        >
          <header className="persistent-authoring__stage-header">
            <div>
              <strong>完整控制流 DAG</strong>
              <span>
                {structure.nodes.length} 个节点 · {structure.links.length} 条边
              </span>
            </div>
            <div className="persistent-authoring__stage-context">
              <p>
                {projectionKind === 'candidate'
                  ? mode === 'code'
                    ? '当前画布是服务器候选版本的只读预览'
                    : '画布编辑区基于候选版本；保存时由 OS 生成完整 Python'
                  : mode === 'code'
                    ? '当前显示已应用版本；暂无待应用修改'
                    : '画布编辑区基于已应用版本；暂无待应用修改'}
              </p>
              <div className="persistent-authoring__stage-tools">
                {mode === 'canvas' && (
                  <button
                    type="button"
                    className="persistent-authoring__panel-toggle"
                    aria-controls="persistent-authoring-node-palette"
                    aria-pressed={nodePaletteOpen}
                    onClick={() => setNodePaletteOpen((open) => !open)}
                  >
                    {nodePaletteOpen ? '隐藏节点库' : '显示节点库'}
                  </button>
                )}
                <button
                  type="button"
                  className="persistent-authoring__io-trigger"
                  disabled={!graph}
                  title={mode === 'code'
                    ? '当前为只读预览；切换到画布模式后可配置'
                    : '配置整个工作流的输入、输出与节点参数连接'}
                  onClick={() => setWorkflowIoOpen(true)}
                >
                  <span>输入与输出</span>
                  <strong>
                    输入 {candidateIo?.input_contract.parameters.length ?? 0}
                    {' · '}输出 {candidateIo?.output_contract.outputs.length ?? 0}
                  </strong>
                </button>
              </div>
            </div>
          </header>
          <div className={[
            'persistent-authoring__canvas-body',
            mode === 'code' ? 'is-code-mode' : '',
            mode === 'canvas' && !nodePaletteOpen
              ? 'is-palette-closed'
              : '',
            mode === 'canvas' && selectedNodeUuid
              ? 'has-inspector'
              : ''
          ].filter(Boolean).join(' ')}>
            {graph ? (
              <>
                {mode === 'canvas' && nodePaletteOpen && (
                  <aside
                    id="persistent-authoring-node-palette"
                    className="persistent-authoring__palette"
                    aria-label="工作流节点面板"
                  >
                  <header>
                    <strong>节点</strong>
                    <span>添加到画布编辑区</span>
                  </header>
                  <section>
                    <h3>物料</h3>
                    <button
                      type="button"
                      className="persistent-authoring__palette-source"
                      disabled={
                        busy ||
                        !policy.canvasMutationEnabled ||
                        !effectiveMaterialSourceCatalog ||
                        materialSourceAuthorityBlocked
                      }
                      onClick={addMaterialSourceNode}
                    >
                      <span aria-hidden="true">▱</span>
                      <span>
                        <strong>物料来源</strong>
                        <small>OS 准入声明</small>
                      </span>
                    </button>
                    {materialSourceCatalogLoading && (
                      <p role="status">正在读取物料与库位目录…</p>
                    )}
                    {materialSourceCatalogError && (
                      <div className="persistent-authoring__palette-problem">
                        <p>{materialSourceCatalogError}</p>
                        <button
                          type="button"
                          onClick={() => void refreshMaterialSourceCatalog()}
                        >
                          重新读取
                        </button>
                      </div>
                    )}
                  </section>
                  <section>
                    <h3>操作</h3>
                    <div className="persistent-authoring__palette-actions">
                      {actionCatalog?.actionTemplates.map((template) => (
                        <button
                          type="button"
                          key={template.uuid}
                          disabled={
                            busy ||
                            !policy.canvasMutationEnabled ||
                            !graph
                          }
                          onClick={() => addTypedActionNode(template.uuid)}
                        >
                          <span aria-hidden="true">⌁</span>
                          <span>
                            <strong>{template.displayName}</strong>
                            <small>{template.name}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                  {Boolean(actionCatalog?.workflowTemplates.length) && (
                    <section>
                      <h3>子工作流</h3>
                      <div className="persistent-authoring__palette-actions">
                        {actionCatalog?.workflowTemplates.map((template) => (
                          <button
                            type="button"
                            key={template.uuid}
                            disabled={
                              busy ||
                              !policy.canvasMutationEnabled ||
                              !graph
                            }
                            onClick={() => addPublishedWorkflowNode(template.uuid)}
                          >
                            <span aria-hidden="true">▣</span>
                            <span>
                              <strong>{template.displayName}</strong>
                              <small>{template.source.symbol}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  </aside>
                )}
                <div className="persistent-authoring__graph-stage">
                  <WorkflowDag
                    nodes={structure.nodes}
                    links={structure.links}
                    onNodeSelect={selectCanvasNode}
                    onSetStart={toggleDebugStartNode}
                    onToggleBreakpoint={toggleDebugBreakpoint}
                    nodeStates={taskNodeStates}
                    breakpoints={debugBreakpoints}
                    startNodeId={debugExecutionScope.startNodeId}
                    beforeStartNodeIds={
                      debugExecutionScope.beforeStartNodeIds
                    }
                    canBeautify={false}
                    canvasMutationEnabled={policy.canvasMutationEnabled}
                    onConnectHandles={connectTypedHandles}
                  />
                </div>
                {mode === 'canvas' && selectedNodeUuid && (
                  <aside
                    className="persistent-authoring__node-editor"
                    aria-label="画布节点编辑器"
                  >
                    <header className="persistent-authoring__inspector-heading">
                      <span>
                        <span>属性</span>
                        <strong>
                          {selectedIsMaterialSource ? '物料来源' : '节点属性'}
                        </strong>
                      </span>
                      <button
                        type="button"
                        aria-label="关闭属性面板"
                        title="关闭属性面板"
                        onClick={() => {
                          const nodeUuid = selectedNodeUuid
                          setSelectedNodeUuid(null)
                          setSelectedNodeName('')
                          setSelectedNodeNameDirty(false)
                          setActionParametersOpen(false)
                          requestAnimationFrame(() => {
                            document.querySelector<HTMLElement>(
                              `.react-flow__node[data-id="${nodeUuid}"]`
                            )?.focus({ preventScroll: true })
                          })
                        }}
                      >
                        ×
                      </button>
                    </header>
                    <label>
                      节点名称
                      <input
                        value={selectedNodeName}
                        disabled={
                          busy || !policy.canvasMutationEnabled ||
                          selectedNodeIsInternal
                        }
                        aria-describedby="persistent-node-name-help"
                        onChange={(event) => {
                          setSelectedNodeName(event.target.value)
                          setSelectedNodeNameDirty(true)
                          setMessage(
                            '画布缓冲已修改；保存前将生成完整 Python 差异'
                          )
                        }}
                      />
                    </label>
                      {selectedMaterialSourceEditor && (
                        <MaterialSourceInspector
                          editor={selectedMaterialSourceEditor}
                          accent={
                            materialTraces.materialSourceAccents.get(
                              selectedMaterialSourceEditor.nodeUuid
                            )
                          }
                          editable={
                            !busy && policy.canvasMutationEnabled &&
                            !materialSourceCatalogLoading &&
                            !materialSourceAuthorityBlocked
                          }
                          status={taskNodeStates[selectedNodeUuid] || 'pending'}
                          diagnostics={diagnostics.filter((diagnostic) =>
                            diagnostic.node_id === selectedNodeUuid
                          )}
                          onChange={(patch) => updateMaterialSource(
                            selectedMaterialSourceEditor,
                            patch
                          )}
                        />
                      )}
                      {selectedMaterialSourceProjection.error && (
                        <p role="alert">
                          物料来源选择读取失败：
                          {selectedMaterialSourceProjection.error}
                        </p>
                      )}
                      {selectedActionEditor && (
                        <section
                          className="persistent-authoring__action-summary"
                          aria-label="操作参数摘要"
                        >
                          <div>
                            <strong>操作参数</strong>
                            <span>
                              输入 {selectedActionEditor.fields.length}
                              {' · '}输出 {selectedActionTemplate?.handles.filter(
                                (handle) => handle.ioType === 'source'
                              ).length ?? 0}
                            </span>
                          </div>
                          <p>
                            点击下方按钮编辑输入，并查看输出端口与连接关系。
                          </p>
                          <button
                            type="button"
                            className="workflow-runtime__primary"
                            onClick={() => setActionParametersOpen(true)}
                          >
                            配置节点参数
                          </button>
                        </section>
                      )}
                      {selectedActionProjection.error && (
                        <p role="alert">
                          操作模板或端口读取失败：
                          {selectedActionProjection.error}
                        </p>
                      )}
                    <p id="persistent-node-name-help">
                      名称修改属于画布缓冲，接受完整 Python 差异后才会持久化。
                    </p>
                  </aside>
                )}
              </>
            ) : (
              <p className="persistent-authoring__empty">
                正在读取 OS 工作流编辑数据…
              </p>
            )}
          </div>
        </section>
      </main>

      <section
        className="persistent-authoring__runtime"
        aria-label="工作流任务运行控制"
      >
        <WorkflowDebugger
          debugStatus={workflowTaskVisualStatus(task)}
          runStatus={task?.status || 'draft'}
          heading="工作流运行"
          subtitle="OS 任务控制"
          statusText={workflowTaskControlStatusLabel(task)}
          runStatusText={workflowTaskStatusLabel(task?.status)}
          runStatusPrefix="任务"
          metadata={workflowTaskMetadata(
            task,
            taskRuntime.snapshot.lastCommand,
            taskRuntime.snapshot
          )}
          actionGroupLabel="任务执行控制"
          dangerGroupLabel="任务取消控制"
          commandDataAttribute="runtime"
          controls={taskControls}
          traceAvailable={Boolean(traceRuntime)}
          onTraceOpen={() => setTraceViewerOpen(true)}
          onCommand={(command) => runRuntime(
            () => taskRuntime.command(command)
          )}
        />

        <WorkflowOutput
          expanded={outputExpanded}
          activeTab={outputTab}
          completedNodeCount={completedTaskJobCount}
          expectedNodeCount={taskJobs.length}
          nodes={taskOutputNodes}
          nodeNames={taskNodeNames}
          events={taskRuntimeEvents}
          error={taskRuntime.snapshot.error}
          selectedNode={selectedTaskNode}
          selectedNodeId={selectedJobNodeUuid}
          pausedBeforeNodeId={null}
          title="运行输出"
          countLabel="个节点任务已结束"
          nodesTabLabel="节点任务状态"
          onExpandedChange={setOutputExpanded}
          onTabChange={setOutputTab}
          onNodeSelect={setSelectedJobNodeUuid}
          onClearError={taskRuntime.clearError}
        />
      </section>

      {traceRuntime && (
        <WorkflowTraceViewer
          open={traceViewerOpen}
          currentRunId={task?.uuid ?? null}
          runtime={traceRuntime}
          onClose={() => setTraceViewerOpen(false)}
        />
      )}

      <WorkflowActionParameterDrawer
        open={Boolean(actionParametersOpen && selectedActionEditor)}
        nodeName={selectedNodeName}
        templateName={selectedActionTemplate?.displayName ?? ''}
        editor={selectedActionEditor}
        outputHandles={selectedActionTemplate?.handles.filter(
          (handle) => handle.ioType === 'source'
        ) ?? []}
        graph={graph}
        editable={!busy && policy.canvasMutationEnabled}
        onClose={() => setActionParametersOpen(false)}
        onProviderChange={(field, provider) => {
          if (provider.startsWith('workflow:')) {
            bindTypedFieldToWorkflowInput(
              field.handleUuid,
              provider.slice('workflow:'.length)
            )
          } else if (provider === 'literal' || provider === 'missing') {
            updateTypedField(field.handleUuid, undefined)
          }
        }}
        onLiteralBlur={updateTypedFieldFromRaw}
        onClear={(handleUuid) => updateTypedField(handleUuid, undefined)}
        onNull={(handleUuid) => updateTypedField(handleUuid, null)}
      />

      <SlideOverDrawer
        open={workflowIoOpen}
        size="medium"
        ariaLabel="工作流输入与输出配置"
        title={(
          <span className="persistent-authoring__drawer-title">
            <span>工作流设置</span>
            <strong>设置工作流输入与输出</strong>
          </span>
        )}
        onClose={() => setWorkflowIoOpen(false)}
        footer={(
          <div className="persistent-authoring__drawer-footer">
            <span>
              {mode === 'canvas'
                ? '修改暂存在画布编辑区，保存草稿后生效。'
                : '代码模式下仅预览；切换到画布模式后可配置。'}
            </span>
            <button type="button" onClick={() => setWorkflowIoOpen(false)}>
              完成
            </button>
          </div>
        )}
      >
        <div className="persistent-authoring__io-drawer">
          <header>
            <strong>整个工作流的输入与输出</strong>
            <p>
              输入可提供给任意节点；输出可连接节点结果，也可直接返回输入值。
            </p>
          </header>
          {appliedIo && (
            <details className="persistent-authoring__applied-io">
              <summary>
                已应用版本 {aggregate?.workflow_revision}
                <span>
                  输入 {appliedIo.input_contract.parameters.length}
                  {' · '}输出 {appliedIo.output_contract.outputs.length}
                </span>
              </summary>
              <WorkflowIoSummary io={appliedIo} />
            </details>
          )}
          {graph ? (
            <WorkflowIoEditor
              graph={graph}
              editable={!busy && policy.canvasMutationEnabled}
              onGraphChange={(nextGraph) => {
                setGraph(nextGraph)
                setCanvasDirty(true)
                setError(null)
                setMessage(
                  '工作流输入与输出已修改；保存前将由 OS 生成规范 Python'
                )
              }}
            />
          ) : (
            <p className="persistent-authoring__parameter-empty">
              正在读取 OS 工作流编辑数据…
            </p>
          )}
        </div>
      </SlideOverDrawer>

      <SlideOverDrawer
        open={Boolean(taskInputAuthority && taskInputForm)}
        size="medium"
        ariaLabel="本次工作流运行参数"
        title={(
          <span className="persistent-authoring__drawer-title">
            <span>本次运行</span>
            <strong>确认运行参数</strong>
          </span>
        )}
        onClose={() => {
          if (runtimeBusy) return
          setTaskInputAuthority(null)
          setTaskInputForm(null)
          setTaskInputProblem(null)
          setResourceSlotOptions(undefined)
        }}
      >
        {taskInputAuthority && taskInputForm && (
          <div className="persistent-authoring__task-input-drawer">
            {workflowIoMetadata(taskInputAuthority.applied_graph) && (
              <details className="persistent-authoring__task-io-summary">
                <summary>
                  查看工作流输入与输出
                  <span>
                    输入 {workflowIoMetadata(taskInputAuthority.applied_graph)!
                      .input_contract.parameters.length}
                    {' · '}输出 {workflowIoMetadata(
                      taskInputAuthority.applied_graph
                    )!.output_contract.outputs.length}
                  </span>
                </summary>
                <WorkflowIoSummary
                  io={workflowIoMetadata(taskInputAuthority.applied_graph)!}
                />
              </details>
            )}
            <WorkflowTaskInputForm
              aggregate={taskInputAuthority}
              form={taskInputForm}
              busy={runtimeBusy}
              problem={taskInputProblem}
              resourceSlotOptions={resourceSlotOptions}
              onChange={updateTaskInput}
              onProblem={setTaskInputProblem}
              onSubmit={submitTaskInput}
              onCancel={() => {
                setTaskInputAuthority(null)
                setTaskInputForm(null)
                setTaskInputProblem(null)
                setResourceSlotOptions(undefined)
              }}
            />
          </div>
        )}
      </SlideOverDrawer>

      {pendingMode && (
        <div className="workflow-save-prompt">
          <section
            className="workflow-save-prompt__dialog"
            role="dialog"
            aria-modal="true"
            aria-label="未保存修改，确认切换模式"
          >
            <header className="workflow-save-prompt__header">
              <h2>未保存修改，确认切换模式</h2>
            </header>
            <div className="workflow-save-prompt__body">
              <p>当前可写表示仍有未保存修改。取消可继续编辑；放弃后才切换。</p>
            </div>
            <footer className="workflow-save-prompt__actions">
              <button
                type="button"
                className="workflow-save-prompt__cancel"
                onClick={() => setPendingMode(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="workflow-save-prompt__revision"
                onClick={discardAndSwitch}
              >
                放弃修改并切换
              </button>
            </footer>
          </section>
        </div>
      )}

      {remoteConflict && (
        <div className="workflow-save-prompt">
          <section
            className="workflow-save-prompt__dialog persistent-authoring__diff"
            role="dialog"
            aria-modal="true"
            aria-label="远端修改冲突"
          >
            <header className="workflow-save-prompt__header">
              <span className="workflow-save-prompt__eyebrow">双 CAS 冲突</span>
              <h2>远端状态已变化</h2>
            </header>
            <div className="workflow-save-prompt__body">
              <p>
                本地修改仍保留。可以继续编辑、采用远端状态，或先查看完整源码差异，
                再使用刚补读的新 token 明确重试。
              </p>
            </div>
            <footer className="workflow-save-prompt__actions">
              <button
                type="button"
                className="workflow-save-prompt__cancel"
                onClick={() => {
                  setRemoteConflict(null)
                  setMessage('本地修改继续保留；保存时仍需先解决远端冲突')
                }}
              >
                继续编辑本地内容
              </button>
              <button
                type="button"
                className="workflow-save-prompt__revision"
                onClick={adoptRemoteConflict}
              >
                采用远端并放弃本地
              </button>
              <button
                type="button"
                className="workflow-save-prompt__file"
                onClick={retryLocalAfterConflict}
              >
                查看差异并用本地重试
              </button>
            </footer>
          </section>
        </div>
      )}

      {fullSourceDiff && (
        <div className="workflow-save-prompt">
          <section
            className="workflow-save-prompt__dialog persistent-authoring__diff"
            role="dialog"
            aria-modal="true"
            aria-label="完整 Python 差异"
          >
            <header className="workflow-save-prompt__header">
              <span className="workflow-save-prompt__eyebrow">
                {fullSourceDiff.reason === 'conflict_retry'
                  ? '冲突重试检查'
                  : fullSourceDiff.reason === 'source_normalization'
                    ? '导入源码规范化检查'
                    : '画布保存检查'}
              </span>
              <h2>完整 Python 差异</h2>
            </header>
            <div className="persistent-authoring__diff-grid">
              <section>
                <h3>当前 Python</h3>
                <pre>{fullSourceDiff.before}</pre>
              </section>
              <section>
                <h3>生成的完整 Python</h3>
                <pre>{fullSourceDiff.after}</pre>
              </section>
            </div>
            <footer className="workflow-save-prompt__actions">
              <button
                type="button"
                className="workflow-save-prompt__cancel"
                onClick={() => setFullSourceDiff(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="workflow-save-prompt__file"
                onClick={acceptFullSourceDiff}
              >
                接受完整差异并保存
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

export interface MaterialSourceInspectorProps {
  editor: MaterialSourceEditorProjection
  accent?: string
  editable: boolean
  status: string
  diagnostics: readonly WorkflowAuthoringDiagnostic[]
  onChange: (patch: Partial<MaterialSourceSelectorUpdate>) => void
}

export function MaterialSourceInspector({
  editor,
  accent,
  editable,
  status,
  diagnostics,
  onChange
}: MaterialSourceInspectorProps): React.JSX.Element {
  const resolvedAccent = accent ?? materialTraceAccent(editor.nodeUuid)
  const [siteQuery, setSiteQuery] = useState('')
  const visibleSites = useMemo(
    () => filterMaterialSourceSites(editor.sites, siteQuery),
    [editor.sites, siteQuery]
  )
  useEffect(() => setSiteQuery(''), [editor.nodeUuid])
  return (
    <section
      className="persistent-authoring__material-source-inspector"
      aria-label="物料来源属性"
      data-material-source-node-uuid={editor.nodeUuid}
      style={{ '--wf-material-accent': resolvedAccent } as React.CSSProperties}
    >
      <div className="persistent-authoring__material-identity">
        <span className="persistent-authoring__material-hex" aria-hidden="true">
          ▱
        </span>
        <span>
          <strong>{editor.name}</strong>
          <small>
            {materialFlowRoleLabel(editor.flowRole)} · {' '}
            {editor.nodeUuid.replace(/-/g, '').slice(-6)}
          </small>
        </span>
        <span className="persistent-authoring__material-status">
          {workflowNodeStateLabel('material_source', status)}
        </span>
      </div>

      <fieldset>
        <legend>物料</legend>
        <label>
          物料角色
          <select
            aria-label="物料角色"
            value={editor.flowRole}
            disabled={!editable}
            onChange={(event) => onChange({
              flowRole: event.target.value as MaterialSourceSelectorUpdate['flowRole']
            })}
          >
            <option value="primary_sample">主样品</option>
            <option value="aliquot_sample">分装样品</option>
            <option value="reagent">试剂</option>
            <option value="consumable">耗材</option>
          </select>
        </label>
        <label>
          资源模板
          <select
            aria-label="资源模板"
            value={editor.resourceTemplateUuid}
            disabled={!editable}
            onChange={(event) => onChange({
              resourceTemplateUuid: event.target.value
            })}
          >
            {editor.resourceTemplates.map((template) => (
              <option
                key={template.uuid}
                value={template.uuid}
                title={template.uuid}
              >
                {template.displayName}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>来源</legend>
        <div
          className="persistent-authoring__segmented"
          role="group"
          aria-label="取得方式"
        >
          <button
            type="button"
            className={editor.mode === 'existing' ? 'is-active' : ''}
            aria-pressed={editor.mode === 'existing'}
            disabled={!editable}
            onClick={() => onChange({ mode: 'existing' })}
          >
            已有物料
          </button>
          <button
            type="button"
            className={editor.mode === 'create_new' ? 'is-active' : ''}
            aria-pressed={editor.mode === 'create_new'}
            disabled={!editable}
            onClick={() => onChange({ mode: 'create_new' })}
          >
            新建物料
          </button>
        </div>
        <label>
          挂载点
          <select
            aria-label="挂载点"
            value={editor.mountUuid}
            disabled={!editable}
            onChange={(event) => onChange({ mountUuid: event.target.value })}
          >
            {editor.mounts.map((mount) => (
              <option key={mount.uuid} value={mount.uuid}>
                {mount.name}
              </option>
            ))}
          </select>
        </label>
        {editor.mode === 'existing' && (
          <label>
            固定物料
            <select
              aria-label="固定物料"
              value={editor.fixedMaterialUuid ?? ''}
              disabled={!editable}
              onChange={(event) => onChange({
                fixedMaterialUuid: event.target.value || null
              })}
            >
              <option value="">运行时自动选择</option>
              {editor.fixedMaterials.map((material) => (
                <option key={material.uuid} value={material.uuid}>
                  {material.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>库位范围</legend>
        <label>
          库位范围
          <select
            aria-label="库位范围"
            value={editor.siteScope}
            disabled={!editable}
            onChange={(event) => {
              const scope = event.target.value as MaterialSourceSelectorUpdate['siteScope']
              const firstSite = editor.sites[0]?.uuid ?? null
              onChange({
                siteScope: scope,
                fixedSiteUuid: scope === 'fixed' ? firstSite : null,
                candidateSiteUuids: scope === 'candidates' && firstSite
                  ? [firstSite]
                  : []
              })
            }}
          >
            <option value="all">全部兼容的直接库位</option>
            <option value="fixed" disabled={editor.sites.length === 0}>
              固定库位
            </option>
            <option value="candidates" disabled={editor.sites.length === 0}>
              候选库位集
            </option>
          </select>
        </label>
        {editor.siteScope === 'fixed' && (
          <label>
            固定库位
            <select
              aria-label="固定库位"
              value={editor.fixedSiteUuid ?? ''}
              disabled={!editable}
              onChange={(event) => onChange({
                fixedSiteUuid: event.target.value
              })}
            >
              {editor.sites.map((site) => (
                <option key={site.uuid} value={site.uuid}>
                  {site.name} · #{site.sortOrder}
                </option>
              ))}
            </select>
          </label>
        )}
        {editor.siteScope === 'candidates' && (
          <div className="persistent-authoring__candidate-site-selector">
            <label>
              搜索候选库位
              <input
                type="search"
                aria-label="搜索候选库位"
                value={siteQuery}
                placeholder="名称、顺序或 UUID"
                onChange={(event) => setSiteQuery(event.target.value)}
              />
            </label>
            <p role="status">
              已选择 {editor.candidateSiteUuids.length} / {editor.sites.length}
              {siteQuery && ` · 显示 ${visibleSites.length}`}
            </p>
            <div
              className="persistent-authoring__candidate-sites"
              role="group"
              aria-label="候选库位"
            >
              {visibleSites.map((site) => {
                const checked = editor.candidateSiteUuids.includes(site.uuid)
                return (
                  <label key={site.uuid}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!editable || (
                        checked && editor.candidateSiteUuids.length === 1
                      )}
                      onChange={(event) => onChange({
                        candidateSiteUuids: event.target.checked
                          ? [...editor.candidateSiteUuids, site.uuid]
                          : editor.candidateSiteUuids.filter((uuid) =>
                              uuid !== site.uuid
                            )
                      })}
                    />
                    <span>
                      {site.name}
                      <small>
                        库位 #{site.sortOrder} · {' '}
                        {site.occupiedMaterialUuid ? '已占用' : '空闲'}
                      </small>
                    </span>
                  </label>
                )
              })}
              {visibleSites.length === 0 && (
                <p role="status">没有匹配的候选库位</p>
              )}
            </div>
          </div>
        )}
        {editor.sites.length === 0 && (
          <p role="status">当前挂载点没有兼容的直接库位；OS 预览将给出诊断。</p>
        )}
      </fieldset>

      {editor.staleReferences.length > 0 && (
        <div className="persistent-authoring__selector-warning" role="alert">
          <strong>引用已失效</strong>
          {editor.staleReferences.map((reference) => (
            <span key={reference}>{reference}</span>
          ))}
        </div>
      )}
      {diagnostics.length > 0 && (
        <ul className="persistent-authoring__selector-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}:${index}`}>
              <code>{diagnostic.code}</code>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="persistent-authoring__selector-authority">
        仅保存稳定 UUID；库位按业务顺序展示，候选集按 UUID 规范保存。
      </p>
    </section>
  )
}

export function filterMaterialSourceSites(
  sites: MaterialSourceEditorProjection['sites'],
  query: string
): MaterialSourceEditorProjection['sites'] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return sites
  return sites.filter((site) => (
    `${site.name} #${site.sortOrder} ${site.uuid}`
      .toLocaleLowerCase()
      .includes(normalized)
  ))
}

function materialFlowRoleLabel(flowRole: string): string {
  return {
    primary_sample: '主样品',
    aliquot_sample: '分装样品',
    reagent: '试剂',
    consumable: '耗材'
  }[flowRole] || flowRole
}

function shortTemplateLabel(uuid: string): string {
  return `Template · ${uuid.replace(/-/g, '').slice(-6)}`
}

function workflowIoMetadata(
  graph: WorkflowAuthoringGraph
): WorkflowIoMetadata | null {
  const unilab = graph.workflow.meta_data?.unilab
  if (
    !unilab?.input_contract ||
    !unilab.output_contract ||
    !unilab.output_bindings
  ) return null
  return {
    input_contract: unilab.input_contract,
    output_contract: unilab.output_contract,
    output_bindings: unilab.output_bindings
  }
}

function authoritativePython(
  aggregate: WorkflowAuthoringAggregate
): string {
  return aggregate.draft?.python_source ||
    aggregate.applied_source?.python_source ||
    ''
}

function workflowSourceMap(
  aggregate: WorkflowAuthoringAggregate | null,
  source: string
): WorkflowAuthoringSourceMapEntry[] {
  if (!aggregate) return []
  if (
    aggregate.candidate &&
    (
      aggregate.candidate.normalized_python_source === source ||
      (
        aggregate.draft?.python_source === source &&
        aggregate.candidate.draft_hash === aggregate.draft.draft_hash
      )
    )
  ) {
    return aggregate.candidate.source_map
  }
  if (aggregate.applied_source?.python_source === source) {
    return aggregate.applied_source.source_map
  }
  return []
}

function rebaseGraphIdentity(
  local: WorkflowAuthoringGraph,
  remote: WorkflowAuthoringAggregate
): WorkflowAuthoringGraph {
  const remoteGraph = authoringProjection(remote).graph
  return {
    ...local,
    workflow: {
      ...local.workflow,
      ...remoteGraph.workflow
    }
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function parseTypedFieldValue(
  field: TypedActionFieldProjection,
  raw: string
): unknown {
  if (field.enumValues) return raw === '' ? undefined : JSON.parse(raw)
  const base = typedNonNullSchema(field.valueSchema)
  if (base.$slot === 'ResourceSlot') {
    if (raw.trim() === '') return undefined
    try {
      const value: unknown = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not an object')
      }
      return value
    } catch {
      throw new Error(`${field.displayName}必须是明确 Material reference JSON`)
    }
  }
  if (base.type === 'string') return raw
  if (base.type === 'number' || base.type === 'integer') {
    if (raw.trim() === '') return undefined
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      throw new Error(`${field.displayName}必须是有限数字`)
    }
    if (base.type === 'integer' && !Number.isInteger(value)) {
      throw new Error(`${field.displayName}必须是整数`)
    }
    return value
  }
  if (base.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') {
      throw new Error(`${field.displayName}必须是 true 或 false`)
    }
    return raw === 'true'
  }
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${field.displayName}必须是合法 JSON`)
  }
}

function typedNonNullSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (!Array.isArray(schema.anyOf)) return schema
  const value = schema.anyOf.find((item) =>
    item && typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type !== 'null'
  )
  return value as Record<string, unknown> || {}
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const TERMINAL_JOB_STATUSES = new Set([
  'succeeded',
  'failed',
  'skipped',
  'canceled',
  'timeout'
])

function workflowTaskDagState(
  status: WorkflowNodeJob['status'],
  materialSource: boolean,
  taskStatus: WorkflowTask['status'] | undefined
): string {
  if (materialSource) {
    if (status === 'succeeded') return 'success'
    if (
      status === 'failed' ||
      status === 'intervention_required' ||
      status === 'timeout' ||
      status === 'execution_unknown'
    ) return 'failed'
    if (status === 'canceled' || status === 'cancel_requested') {
      return 'cancelled'
    }
    if (status === 'skipped') return 'skipped'
    if (taskStatus === 'admission_blocked') return 'material_waiting'
    return 'pending'
  }
  const states: Record<WorkflowNodeJob['status'], string> = {
    pending: 'pending',
    dispatched: 'ready',
    running: 'running',
    intervention_required: 'failed',
    cancel_requested: 'running',
    execution_unknown: 'reconciling',
    succeeded: 'success',
    failed: 'failed',
    skipped: 'skipped',
    canceled: 'cancelled',
    timeout: 'failed'
  }
  return states[status]
}

function workflowTaskMetadata(
  task: WorkflowTask | null,
  command: WorkflowTaskCommand | null,
  snapshot: Pick<
    WorkflowTaskRuntimeSnapshot,
    'realtimeStatus' | 'projectionStale' | 'feedbackStale'
  >
): ReadonlyArray<{ label: string; value: string; title?: string }> {
  return [
    {
      label: '任务',
      value: task ? task.uuid.slice(-8) : '尚未创建',
      title: task?.uuid
    },
    {
      label: '模式',
      value: task?.run_mode === 'step' ? '单步' : '正常'
    },
    {
      label: '命令',
      value: command
        ? `${workflowTaskCommandLabel(command.type)} · OS 已接受`
        : '无'
    },
    {
      label: '实时同步',
      value: {
        connecting: '正在连接',
        live: '已连接',
        reconnecting: '正在重连'
      }[snapshot.realtimeStatus]
    },
    {
      label: '状态投影',
      value: snapshot.projectionStale
        ? '保留的上一版本'
        : snapshot.feedbackStale
          ? '反馈事件待补读'
          : '已确认'
    }
  ]
}

function workflowTaskCommandLabel(type: WorkflowTaskCommandType): string {
  return {
    pause: '暂停',
    resume: '继续',
    step: '单步',
    cancel: '取消'
  }[type]
}
