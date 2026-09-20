import { CodeEditor } from '@unilab/code-editor'
import type { WorkflowDefinitionKind } from '@unilab/services'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { diagnosticRange } from '../utils/persistentAuthoringSession'
import { formatAuthoringDiagnostic } from '../utils/workflowAuthoringUserCopy'
import {
  canRetryWorkflowRuntimeRead,
  workflowRuntimeProblemHeading
} from '../utils/workflowRuntimeProblem'
import WorkflowDag, { type WorkflowDagHandle } from './WorkflowDag'
import { ExperimentOperationStructure } from './ExperimentOperationStructure'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowCanvasStageHeader } from './WorkflowCanvasStageHeader'
import { WorkflowCanvasDebugMode } from './WorkflowCanvasDebugMode'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { WorkflowOperationCanvasToolbar } from './WorkflowOperationCanvasToolbar'
import { PersistentWorkflowOverlays } from './PersistentWorkflowOverlays'
import { PersistentWorkflowRuntimePanel } from './PersistentWorkflowRuntimePanel'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'
import { WorkflowAuthoringLibrary } from './WorkflowAuthoringLibrary'
import { WorkflowNodeInspector } from './WorkflowNodeInspector'
import { WorkflowDebugToolbar } from './WorkflowDebugToolbar'
import { CreateWorkflowDialog } from './WorkflowCatalogDialogs'
import {
  readWorkflowNodePaletteDragPayload,
  type WorkflowCanvasBreadcrumb,
  type WorkflowCanvasNavigationState,
  type WorkflowCanvasPoint,
  type WorkflowNodePaletteDragPayload,
  workflowPaletteDropPosition,
  workflowPaletteDropInside,
  workflowNodePalettePointerPayload
} from '../utils/workflowCanvasCommands'
import { ManualConfirmationCreateDialog } from './ManualConfirmationCreateDialog'
import styles from './workflow.module.scss'

export const COMPACT_WORKFLOW_CANVAS_WIDTH = 1024
const WORKFLOW_PALETTE_PREVIEW_WIDTH = 180
const WORKFLOW_PALETTE_PREVIEW_HEIGHT = 84

function authoringDiagnosticDismissKey(diagnostic: {
  code: string
  message: string
  path?: string | null
}): string {
  return `${diagnostic.code}:${diagnostic.path ?? ''}:${diagnostic.message}`
}

export function PersistentWorkflowAuthoringView({
  model,
  workflowName,
  definitionKind = 'workflow',
  onSelectWorkflow,
  onOpenChildWorkflow,
  workflowBreadcrumbs = [],
  onNavigateBreadcrumb,
  restoreCanvasState = null,
  visibleMaterialRoles,
  onVisibleMaterialRolesChange,
  hideEmbeddedCodeEditor = false,
  hideAuthoringToolbar = false,
  hideCanvasSidebars = false,
  hideRuntimeControls = false,
  onResetEnvironment,
  environmentResetBusy = false,
  debugLayout = false
}: {
  model: PersistentWorkflowAuthoringModel
  workflowName?: string
  definitionKind?: WorkflowDefinitionKind
  onSelectWorkflow?: (workflowUuid: string, workflowName: string) => void
  onOpenChildWorkflow?: (
    workflowUuid: string,
    workflowName: string,
    parentState: WorkflowCanvasNavigationState
  ) => void
  workflowBreadcrumbs?: readonly WorkflowCanvasBreadcrumb[]
  onNavigateBreadcrumb?: (index: number) => void
  restoreCanvasState?: WorkflowCanvasNavigationState | null
  visibleMaterialRoles?: readonly string[] | null
  onVisibleMaterialRolesChange?: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
  hideEmbeddedCodeEditor?: boolean
  hideAuthoringToolbar?: boolean
  hideCanvasSidebars?: boolean
  hideRuntimeControls?: boolean
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
  debugLayout?: boolean
}): React.JSX.Element {
  const {
    actionCatalog,
    actionCatalogError,
    addMaterialSourceNode,
    addPublishedWorkflowNode,
    addTypedActionNode,
    authorityLabel,
    beautifyCanvasLayout,
    busy,
    candidateIo,
    canvasMutationEnabled,
    codeViewingAvailable,
    codeProjection,
    connectTypedHandles,
    connectConditionBranchHandle,
    deleteCanvasElements,
    debugBreakpoints,
    debugExecutionScope,
    diagnostics,
    dirty,
    editor,
    effectiveMaterialSourceCatalog,
    error,
    executionBlockedReason,
    graph,
    ideBridgeConnected,
    jsonProjectionEditor,
    materialSourceAuthorityBlocked,
    materialSourceCatalogError,
    materialSourceCatalogLoading,
    mode,
    moveCanvasNode,
    moveCanvasNodes,
    moveCanvasNodeToLoop,
    nodePaletteOpen,
    pausedBeforeNodeId,
    policy,
    refreshMaterialSourceCatalog,
    runRuntime,
    runtime,
    runtimeBusy,
    selectCanvasNode,
    selectedNodeUuid,
    setCodeProjection,
    setError,
    setGraph,
    setNodePaletteOpen,
    setSelectedJobNodeUuid,
    setSelectedNodeUuid,
    setWorkflowIoOpen,
    sourceSelectedNodeUuid,
    sourceEditingAvailable,
    sourceEditingDisabledReason,
    sourceProjection,
    structure,
    taskNodeStates,
    taskRuntime,
    toggleDebugBreakpoint,
    toggleDebugStartNode,
    toggleNodeDisabled,
    workflowUuid,
  } = model
  const [canvasRevealRequest, setCanvasRevealRequest] = useState<{
    nodeId: string
    nonce: number
  } | null>(null)
  const authoringViewRef = useRef<HTMLDivElement | null>(null)
  const canvasBodyRef = useRef<HTMLDivElement | null>(null)
  const graphStageRef = useRef<HTMLDivElement | null>(null)
  const workflowDagRef = useRef<WorkflowDagHandle | null>(null)
  const palettePointerDragRef = useRef<{
    payload: WorkflowNodePaletteDragPayload
    name: string
    detail: string
    startX: number
    startY: number
    lastX: number
    lastY: number
  } | null>(null)
  const suppressPaletteClickRef = useRef(false)
  const paletteDragPayloadRef = useRef<WorkflowNodePaletteDragPayload | null>(null)
  const [paletteDragPreview, setPaletteDragPreview] = useState<{
    name: string
    detail: string
    clientX: number
    clientY: number
  } | null>(null)
  const restoredNavigationRef = useRef<string | null>(null)
  const [compactCanvas, setCompactCanvas] = useState(false)
  const [graphStageReady, setGraphStageReady] = useState(false)
  const [operationStructureOpen, setOperationStructureOpen] = useState(true)
  const [inspectorWidth, setInspectorWidth] = useState(320)
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false)
  const [dismissedDiagnosticKeys, setDismissedDiagnosticKeys] = useState<
    ReadonlySet<string>
  >(new Set())
  // 画布编辑允许保存不完整草稿；结构校验在运行/发布门禁中展示，
  // 不要在用户仅保存布局或中间节点时阻断编辑。
  const visibleDiagnostics = mode === 'canvas'
    ? []
    : diagnostics.filter(
      (diagnostic) => !dismissedDiagnosticKeys.has(authoringDiagnosticDismissKey(diagnostic))
    )
  const dismissDiagnostic = useCallback((diagnosticKey: string) => {
    setDismissedDiagnosticKeys((current) => {
      const next = new Set(current)
      next.add(diagnosticKey)
      return next
    })
  }, [])
  useEffect(() => {
    setCanvasRevealRequest(null)
    setPaletteDragPreview(null)
    setCreateWorkflowOpen(false)
    setDismissedDiagnosticKeys(new Set())
    restoredNavigationRef.current = null
  }, [workflowUuid])
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const handleInspectorResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    inspectorResizeRef.current = { startX: event.clientX, startWidth: inspectorWidth }
    const move = (moveEvent: PointerEvent) => {
      const drag = inspectorResizeRef.current
      if (!drag) return
      setInspectorWidth(Math.min(debugLayout ? 900 : 520, Math.max(debugLayout ? 320 : 240, drag.startWidth - (moveEvent.clientX - drag.startX))))
    }
    const stop = () => {
      inspectorResizeRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }, [debugLayout, inspectorWidth])
  // 实验操作调试需要始终保留左侧的操作与节点库；工作流调试仍支持手动收起。
  const operationLibraryPersistent = definitionKind === 'operation'
  const nodePaletteVisible = !hideCanvasSidebars && (operationLibraryPersistent ||
    (debugLayout && !compactCanvas) || nodePaletteOpen)

  useEffect(() => {
    const element = authoringViewRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const compact = entry.contentRect.width < COMPACT_WORKFLOW_CANVAS_WIDTH
      setCompactCanvas(compact)
      if (compact && !operationLibraryPersistent) {
        setNodePaletteOpen(false)
      }
      if (compact) setOperationStructureOpen(false)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [operationLibraryPersistent, setNodePaletteOpen])
  useEffect(() => {
    const element = graphStageRef.current
    if (!graph || !element) {
      setGraphStageReady(false)
      return
    }
    const reconcile = (): void => {
      const bounds = element.getBoundingClientRect()
      setGraphStageReady(bounds.width > 0 && bounds.height > 0)
    }
    reconcile()
    if (typeof globalThis.ResizeObserver !== 'function') {
      setGraphStageReady(true)
      return
    }
    const observer = new globalThis.ResizeObserver(reconcile)
    observer.observe(element)
    return () => observer.disconnect()
  }, [graph])
  const handleCanvasNodeSelect = useCallback((nodeId: string): void => {
    // React Flow may report the focused node again while its viewport settles.
    // Keep the external highlight for that same node; a deliberate click on a
    // different node still hands selection control back to the canvas.
    setCanvasRevealRequest((current) =>
      current?.nodeId === nodeId ? current : null
    )
    selectCanvasNode(nodeId, debugLayout && mode === 'canvas' ? 'inspector' : 'canvas')
  }, [debugLayout, mode, selectCanvasNode])
  const handleRuntimeNodeSelect = useCallback((nodeId: string): void => {
    setSelectedJobNodeUuid(nodeId)
    selectCanvasNode(nodeId, 'runtime')
    setCanvasRevealRequest((current) => ({
      nodeId,
      nonce: (current?.nonce ?? 0) + 1
    }))
  }, [selectCanvasNode, setSelectedJobNodeUuid])
  const handleStructureNodeSelect = useCallback((nodeId: string): void => {
    selectCanvasNode(nodeId, debugLayout ? 'inspector' : 'canvas')
    setCanvasRevealRequest((current) => ({
      nodeId,
      nonce: (current?.nonce ?? 0) + 1
    }))
  }, [debugLayout, selectCanvasNode])
  const [manualInsertPosition, setManualInsertPosition] = useState<WorkflowCanvasPoint | null>(null)
  const insertPaletteNode = useCallback((
    payload: WorkflowNodePaletteDragPayload,
    position?: WorkflowCanvasPoint
  ): void => {
    if (payload.kind === 'manual_confirmation') {
      if (runtime.recovery) setManualInsertPosition(position ?? { x: 96, y: 96 })
    } else if (payload.kind === 'material') {
      addMaterialSourceNode(position)
    } else if (payload.kind === 'action') {
      addTypedActionNode(payload.templateUuid, position)
    } else {
      addPublishedWorkflowNode(payload.templateUuid, position)
    }
  }, [addMaterialSourceNode, addPublishedWorkflowNode, addTypedActionNode, runtime.recovery])
  const handlePaletteDragStart = useCallback((
    payload: WorkflowNodePaletteDragPayload
  ): void => {
    paletteDragPayloadRef.current = payload
  }, [])
  const viewportInsertPoint = useCallback((): WorkflowCanvasPoint =>
    workflowDagRef.current?.viewportCenter() ?? { x: 96, y: 96 }, [])
  const canvasDropPosition = useCallback((
    clientX: number,
    clientY: number
  ): WorkflowCanvasPoint => {
    const point = workflowDagRef.current?.clientToCanvasPoint(clientX, clientY)
    return point
      ? workflowPaletteDropPosition(point)
      : viewportInsertPoint()
  }, [viewportInsertPoint])
  // Electron can suppress the native HTML drag/drop sequence when an X6
  // canvas is empty. Keep a pointer-based fallback for action templates so a
  // normal mouse drag still inserts the node into the canvas.
  const handlePalettePointerDownCapture = useCallback((
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>
  ): void => {
    if (!canvasMutationEnabled || event.button !== 0) return
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>(
        '[data-workflow-palette-action], [data-workflow-palette-workflow], [data-workflow-palette-material], [data-workflow-palette-manual]'
      )
      : null
    suppressPaletteClickRef.current = false
    if (!target || target.hasAttribute('disabled')) return
    const payload = workflowNodePalettePointerPayload(target.dataset)
    if (!payload) return
    const template = payload.kind === 'workflow'
      ? actionCatalog?.workflowTemplates.find(
        (item) => item.uuid === payload.templateUuid
      )
      : payload.kind === 'action'
        ? actionCatalog?.actionTemplates.find(
          (item) => item.uuid === payload.templateUuid
        )
        : undefined
    const templateUuid = 'templateUuid' in payload
      ? payload.templateUuid
      : ''
    const material = payload.kind === 'material'
    const manual = payload.kind === 'manual_confirmation'
    palettePointerDragRef.current = {
      payload,
      name: template?.displayName ||
        target?.querySelector('strong')?.textContent?.trim() || (manual ? '人工确认' : material ? '物料来源' : '流程节点'),
      detail: template?.name ||
        target?.querySelector('small')?.textContent?.trim() || (manual ? '确认后执行设备动作' : material ? '物料来源' : templateUuid!),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY
    }
    // Show the card immediately so the drag affordance is visible even when
    // Electron delays the first move event until pointer capture is active.
    setPaletteDragPreview({
      name: template?.displayName ||
        target?.querySelector('strong')?.textContent?.trim() || (manual ? '人工确认' : material ? '物料来源' : '流程节点'),
      detail: template?.name ||
        target?.querySelector('small')?.textContent?.trim() || (manual ? '确认后执行设备动作' : material ? '物料来源' : templateUuid!),
      clientX: event.clientX,
      clientY: event.clientY
    })
  }, [actionCatalog, canvasMutationEnabled])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent | MouseEvent): void => {
      const pending = palettePointerDragRef.current
      if (!pending) return
      pending.lastX = event.clientX
      pending.lastY = event.clientY
      if (Math.hypot(
        event.clientX - pending.startX,
        event.clientY - pending.startY
      ) > 6) {
        setPaletteDragPreview({
          name: pending.name,
          detail: pending.detail,
          clientX: event.clientX,
          clientY: event.clientY
        })
      }
    }
    const finishPointerDrag = (event: PointerEvent | MouseEvent): void => {
      const pending = palettePointerDragRef.current
      palettePointerDragRef.current = null
      setPaletteDragPreview(null)
      if (!pending || !canvasMutationEnabled) return
      const body = graphStageRef.current
      if (!body) return
      const bounds = body.getBoundingClientRect()
      const clientX = event.clientX
      const clientY = event.clientY
      const moved = Math.hypot(
        clientX - pending.startX,
        clientY - pending.startY
      ) > 6
      paletteDragPayloadRef.current = null
      if (!moved) return
      suppressPaletteClickRef.current = true
      if (!workflowPaletteDropInside(bounds, clientX, clientY)) return
      const position = canvasDropPosition(clientX, clientY)
      insertPaletteNode(pending.payload, position)
    }
    const handlePointerUp = (event: PointerEvent | MouseEvent): void => {
      finishPointerDrag(event)
    }
    const handlePointerCancel = (): void => {
      // 原生拖放接管或用户取消时，不把最后经过的坐标当成落点。
      palettePointerDragRef.current = null
      paletteDragPayloadRef.current = null
      setPaletteDragPreview(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !palettePointerDragRef.current) return
      suppressPaletteClickRef.current = true
      handlePointerCancel()
    }
    const handleDragEnd = (): void => {
      palettePointerDragRef.current = null
      paletteDragPayloadRef.current = null
      setPaletteDragPreview(null)
    }
    document.addEventListener('dragend', handleDragEnd)
    document.addEventListener('pointermove', handlePointerMove, true)
    // Some Electron/WebView versions expose the mouse sequence without a
    // corresponding PointerEvent while the palette item is being dragged.
    // Keep the mouse fallback so the projected card follows the cursor there
    // as well.
    document.addEventListener('mousemove', handlePointerMove, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('mouseup', handlePointerUp, true)
    document.addEventListener('pointercancel', handlePointerCancel, true)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handlePointerCancel)
    return () => {
      document.removeEventListener('dragend', handleDragEnd)
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('mousemove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('mouseup', handlePointerUp, true)
      document.removeEventListener('pointercancel', handlePointerCancel, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handlePointerCancel)
    }
  }, [insertPaletteNode, canvasDropPosition, canvasMutationEnabled])

  // Keep a document-level native drop listener as a final Electron fallback.
  // Some renderer/X6 combinations stop propagation before React's synthetic
  // handler sees the event, even though the browser did receive the drop.
  useEffect(() => {
    const isInsideCanvas = (event: DragEvent): boolean => {
      const body = graphStageRef.current
      if (!body) return false
      const bounds = body.getBoundingClientRect()
      return workflowPaletteDropInside(bounds, event.clientX, event.clientY)
    }
    const handleDragOver = (event: DragEvent): void => {
      if (!canvasMutationEnabled || !isInsideCanvas(event)) return
      if (!event.dataTransfer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const handleDrop = (event: DragEvent): void => {
      if (!canvasMutationEnabled || !isInsideCanvas(event)) return
      if (!event.dataTransfer) return
      const payload = readWorkflowNodePaletteDragPayload(event.dataTransfer) ??
        paletteDragPayloadRef.current
      if (!payload) return
      event.preventDefault()
      event.stopPropagation()
      suppressPaletteClickRef.current = true
      palettePointerDragRef.current = null
      paletteDragPayloadRef.current = null
      setPaletteDragPreview(null)
      const position = canvasDropPosition(event.clientX, event.clientY)
      insertPaletteNode(payload, position)
    }
    document.addEventListener('dragover', handleDragOver, true)
    document.addEventListener('drop', handleDrop, true)
    return () => {
      document.removeEventListener('dragover', handleDragOver, true)
      document.removeEventListener('drop', handleDrop, true)
    }
  }, [canvasDropPosition, canvasMutationEnabled, insertPaletteNode])
  useEffect(() => {
    if (!graphStageReady || !restoreCanvasState) return
    const restoreKey = [
      workflowUuid,
      restoreCanvasState.selectedNodeUuid ?? '',
      restoreCanvasState.viewport?.center.x ?? '',
      restoreCanvasState.viewport?.center.y ?? '',
      restoreCanvasState.viewport?.zoom ?? ''
    ].join(':')
    if (restoredNavigationRef.current === restoreKey) return
    restoredNavigationRef.current = restoreKey
    globalThis.requestAnimationFrame(() => {
      if (restoreCanvasState.viewport) {
        workflowDagRef.current?.restoreViewport(restoreCanvasState.viewport)
      }
      if (restoreCanvasState.selectedNodeUuid) {
        selectCanvasNode(restoreCanvasState.selectedNodeUuid)
      }
    })
  }, [
    graphStageReady,
    restoreCanvasState,
    selectCanvasNode,
    workflowUuid
  ])
  const realtimeFallbackOnly = taskRuntime.snapshot.realtimeError !== null &&
    taskRuntime.snapshot.actionError === null &&
    taskRuntime.snapshot.projectionError === null &&
    taskRuntime.snapshot.feedbackError === null

  const stageHeader = !hideRuntimeControls && !debugLayout ? <WorkflowCanvasStageHeader
            title={workflowName || (
              definitionKind === 'operation'
                ? '实验操作控制流 DAG'
                : '完整控制流 DAG'
            )}
            nodeCount={structure.nodes.length}
            linkCount={structure.links.length}
            description={workflowBreadcrumbs.length > 0 ? (
              <nav
                className="persistent-authoring__breadcrumbs"
                aria-label="子工作流层级"
              >
                {workflowBreadcrumbs.map((item, index) => (
                  <span key={`${item.workflowUuid}:${index}`}>
                    <WorkflowButton
                      type="button"
                      disabled={dirty || !onNavigateBreadcrumb}
                      disabledReason={dirty
                        ? '请先保存当前子工作流修改'
                        : '当前工作区不支持层级返回'}
                      onClick={() => onNavigateBreadcrumb?.(index)}
                    >
                      {item.workflowName}
                    </WorkflowButton>
                    <i aria-hidden="true">/</i>
                  </span>
                ))}
                <strong>{workflowName || '当前工作流'}</strong>
              </nav>
            ) : undefined}
            tools={(
              <>
                <WorkflowOperationCanvasToolbar
                  model={model}
                  workflowName={workflowName}
                  visible={definitionKind === 'operation'}
                  operationStructureOpen={operationStructureOpen}
                  onToggleOperationStructure={() => {
                    setOperationStructureOpen((open) => !open)
                  }}
                />
                {mode === 'canvas' && !operationLibraryPersistent && (
                  <button
                    type="button"
                    className="persistent-authoring__panel-toggle"
                    aria-controls="persistent-authoring-node-palette"
                    aria-pressed={nodePaletteOpen}
                    onClick={() => {
                      if (compactCanvas) setOperationStructureOpen(false)
                      setNodePaletteOpen((open) => !open)
                    }}
                  >
                    {nodePaletteOpen ? '隐藏节点库' : '显示节点库'}
                  </button>
                )}
                {definitionKind !== 'operation' && (
                  <WorkflowButton
                    type="button"
                    className="persistent-authoring__io-trigger"
                    disabled={!graph}
                    disabledReason="工作流图尚未加载完成"
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
                  </WorkflowButton>
                )}
              </>
            )}
          /> : null

  return (
    <div
      ref={authoringViewRef}
      className={[
        styles.workflow,
        'workflow-runtime persistent-authoring',
        mode === 'canvas' ? 'persistent-authoring--canvas' : '',
        definitionKind === 'operation' ? 'persistent-authoring--operation' : '',
        debugLayout ? 'persistent-authoring--workflow-debug' : '',
        definitionKind === 'operation' && operationStructureOpen
          ? 'persistent-authoring--operation-structure-open'
          : '',
        'relative flex h-full w-full flex-col',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
      data-workflow-source-uri={sourceProjection?.sourceUri ?? ''}
      data-workflow-source-version={sourceProjection?.sourceVersion ?? ''}
      data-workflow-source-mapping={sourceProjection?.mappingAvailable
        ? 'available'
        : 'unavailable'}
      data-workflow-ide-bridge={ideBridgeConnected ? 'connected' : 'missing'}
      data-definition-kind={definitionKind}
    >
      {debugLayout && <header className="workflow-debug-heading">
        <h1>工作流调试</h1>
        <WorkflowButton type="button" disabled={dirty || busy || !onSelectWorkflow || model.definitionEditingAvailable === false} disabledReason={dirty ? '请先保存当前工作流修改' : '当前工作区暂时不能新建工作流'} onClick={() => setCreateWorkflowOpen(true)}>＋ 新建实验工作流</WorkflowButton>
      </header>}
      {!hideRuntimeControls && !hideAuthoringToolbar && !debugLayout ? (
        <PersistentWorkflowToolbar
          model={model}
          showRunModeMenu={mode !== 'canvas'}
          onResetEnvironment={onResetEnvironment}
          environmentResetBusy={environmentResetBusy}
        />
      ) : null}

      {!hideRuntimeControls && executionBlockedReason && (
        <div className="workflow-runtime__problem" role="status">
          <strong>工作流运行暂不可用</strong>
          <span>{executionBlockedReason}</span>
        </div>
      )}

      {error && diagnostics.length === 0 && (
        <div className="workflow-runtime__problem" role="alert">
          <strong>还不能保存</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      {taskRuntime.snapshot.error && (
        <div className="workflow-runtime__problem" role="alert">
          <strong>
            {realtimeFallbackOnly
              ? '实时通知不可用，已启用定时刷新'
              : workflowRuntimeProblemHeading(taskRuntime.snapshot.actionError)}
          </strong>
          <span>
            {taskRuntime.snapshot.projectionStale
              ? `上一次一致状态已保留：${taskRuntime.snapshot.error}`
              : taskRuntime.snapshot.feedbackStale
                ? `已确认的反馈事件已保留：${taskRuntime.snapshot.error}`
                : taskRuntime.snapshot.error}
          </span>
          {canRetryWorkflowRuntimeRead(taskRuntime.snapshot.actionError) && (
            <WorkflowButton
              type="button"
              disabled={runtimeBusy}
              disabledReason="正在补读工作流任务状态，请稍候"
              onClick={() => runRuntime(() => taskRuntime.refresh())}
            >
              {realtimeFallbackOnly ? '立即刷新状态' : '重试状态读取'}
            </WorkflowButton>
          )}
          <button type="button" onClick={taskRuntime.clearError}>关闭</button>
        </div>
      )}
      {visibleDiagnostics.length > 0 && (
        <section
          className="persistent-authoring__diagnostics"
          aria-label="草稿待处理事项"
        >
          <strong>还需要处理</strong>
          <ul>
            {visibleDiagnostics.map((diagnostic) => {
              const copy = formatAuthoringDiagnostic(diagnostic)
              const diagnosticKey = authoringDiagnosticDismissKey(diagnostic)
              return (
                <li key={diagnosticKey}>
                  <strong>{copy.title}</strong>
                  <span>{copy.detail}</span>
                  {diagnosticRange(diagnostic) && (
                    <span>位置 {diagnosticRange(diagnostic)}</span>
                  )}
                  <button
                    type="button"
                    className="persistent-authoring__diagnostic-dismiss"
                    aria-label={`关闭：${copy.title}`}
                    title="关闭此提示"
                    onClick={() => dismissDiagnostic(diagnosticKey)}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="工作流编写区" className={[
        'persistent-authoring__workbench',
        mode === 'canvas' ? 'is-canvas-mode' : '',
        hideEmbeddedCodeEditor ? 'has-external-code-editor' : ''
      ].filter(Boolean).join(' ')}>
        {codeViewingAvailable !== false ? (
          <section
            className="persistent-authoring__pane persistent-authoring__code"
            aria-label="工作流代码视图"
            hidden={hideEmbeddedCodeEditor}
          >
            {mode === 'code' && (
              <div className="persistent-authoring__projection-toolbar">
                <div
                  className="persistent-authoring__projection-switch"
                  role="group"
                  aria-label="代码视图格式"
                >
                  <WorkflowButton
                    type="button"
                    className={codeProjection === 'python' ? 'is-active' : ''}
                    aria-pressed={codeProjection === 'python'}
                    disabled={!sourceEditingAvailable}
                    disabledReason={sourceEditingDisabledReason ??
                      '当前数据源没有可编辑的 Python 草稿'}
                    onClick={() => setCodeProjection('python')}
                  >
                    Python
                  </WorkflowButton>
                  <WorkflowButton
                    type="button"
                    className={codeProjection === 'json' ? 'is-active' : ''}
                    aria-pressed={codeProjection === 'json'}
                    disabled={!graph}
                    disabledReason="OS 尚未返回可展示的候选工作流图"
                    onClick={() => setCodeProjection('json')}
                  >
                    JSON
                  </WorkflowButton>
                </div>
                <span title={codeProjection === 'python'
                  ? 'Python 草稿可编辑'
                  : `${authorityLabel} 工作流图的只读投影`}>
                  {codeProjection === 'python'
                    ? 'Python 草稿 · 可编辑'
                    : `${authorityLabel} 工作流 JSON · 只读`}
                </span>
              </div>
            )}
            <div className="persistent-authoring__code-projections">
              <div
                hidden={mode === 'code' && codeProjection === 'json'}
                aria-hidden={mode === 'code' && codeProjection === 'json'}
              >
                <CodeEditor
                  title={`${workflowUuid}.py`}
                  editor={editor}
                  language="Python"
                />
              </div>
              <div
                hidden={mode !== 'code' || codeProjection !== 'json'}
                aria-hidden={mode !== 'code' || codeProjection !== 'json'}
              >
                <CodeEditor
                  title={`${workflowUuid}.json`}
                  editor={jsonProjectionEditor}
                  language="JSON · 只读"
                />
              </div>
            </div>
            <p className="persistent-authoring__authority-note">
              {!sourceEditingAvailable
                ? 'Backend 代码视图为只读；如需修改，请切回画布模式'
                : mode === 'canvas'
                  ? 'Python 是 OS 生成的只读投影'
                  : codeProjection === 'json'
                    ? 'JSON 来自 OS 候选图，仅供查看；切换不会覆盖 Python 草稿'
                    : 'Python 草稿可编辑；保存时检查是否存在冲突'}
            </p>
          </section>
        ) : null}

        <section
          className="persistent-authoring__pane persistent-authoring__canvas"
          aria-label="工作流画布"
        >
          {definitionKind !== 'operation' || !graph ? stageHeader : null}
          <div className={[
            'persistent-authoring__canvas-body',
            hideCanvasSidebars ? 'is-canvas-only' : '',
            mode === 'code' ? 'is-code-mode' : '',
            mode === 'canvas' && !nodePaletteVisible
              ? 'is-palette-closed'
              : '',
            mode === 'canvas' && !compactCanvas && !hideCanvasSidebars
              ? 'has-inspector'
              : '',
            mode === 'canvas' && !hideCanvasSidebars && (definitionKind === 'operation' || debugLayout) &&
              operationStructureOpen
              ? 'has-operation-structure'
              : ''
          ].filter(Boolean).join(' ')}
            ref={canvasBodyRef}
            onClickCapture={event => {
              if (!suppressPaletteClickRef.current) return
              suppressPaletteClickRef.current = false
              event.preventDefault()
              event.stopPropagation()
            }}
            style={{ '--inspector-width': `${inspectorWidth}px` } as React.CSSProperties}
            onPointerDownCapture={handlePalettePointerDownCapture}
            onMouseDownCapture={handlePalettePointerDownCapture}
            onDragStartCapture={(event) => {
              // 已接管指针拖动时禁用浏览器原生拖放，避免 pointercancel
              // 提前清掉候选节点，而桌面容器又拦截原生 drop 的双重丢失。
              if (!palettePointerDragRef.current) return
              event.preventDefault()
              event.stopPropagation()
            }}
            onPointerMoveCapture={(event) => {
              const pending = palettePointerDragRef.current
              if (!pending) return
              pending.lastX = event.clientX
              pending.lastY = event.clientY
              setPaletteDragPreview({
                name: pending.name,
                detail: pending.detail,
                clientX: event.clientX,
                clientY: event.clientY
              })
            }}
            onMouseMoveCapture={(event) => {
              const pending = palettePointerDragRef.current
              if (!pending) return
              pending.lastX = event.clientX
              pending.lastY = event.clientY
              setPaletteDragPreview({
                name: pending.name,
                detail: pending.detail,
                clientX: event.clientX,
                clientY: event.clientY
              })
            }}
            onDragOverCapture={(event) => {
              // X6 can replace the graph-stage DOM while a drag is in flight;
              // keep the stable canvas body as the native drop target.
              const bounds = graphStageRef.current?.getBoundingClientRect()
              if (!canvasMutationEnabled || !workflowPaletteDropInside(bounds, event.clientX, event.clientY)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDropCapture={(event) => {
              const bounds = graphStageRef.current?.getBoundingClientRect()
              if (!canvasMutationEnabled || !workflowPaletteDropInside(bounds, event.clientX, event.clientY)) return
              const payload = readWorkflowNodePaletteDragPayload(
                event.dataTransfer
              ) ?? paletteDragPayloadRef.current
              if (!payload) return
              event.preventDefault()
              event.stopPropagation()
              suppressPaletteClickRef.current = true
              palettePointerDragRef.current = null
              paletteDragPayloadRef.current = null
              setPaletteDragPreview(null)
              const position = canvasDropPosition(event.clientX, event.clientY)
              insertPaletteNode(payload, position)
            }}>
            {(mode === 'canvas' || operationLibraryPersistent) &&
              nodePaletteVisible && (
              <WorkflowAuthoringLibrary
                runtime={runtime}
                workflowUuid={workflowUuid}
                workflowName={workflowName}
                definitionKind={definitionKind}
                authoringDirty={dirty}
                onSelectWorkflow={onSelectWorkflow}
                onPaletteDragStart={handlePaletteDragStart}
                catalog={actionCatalog}
                catalogError={actionCatalogError}
                busy={busy}
                canvasMutationEnabled={canvasMutationEnabled}
                graphAvailable={Boolean(graph)}
                materialSourceCatalogAvailable={Boolean(
                  effectiveMaterialSourceCatalog
                )}
                materialSourceAuthorityBlocked={
                  materialSourceAuthorityBlocked
                }
                materialSourceCatalogLoading={materialSourceCatalogLoading}
                materialSourceCatalogError={materialSourceCatalogError}
                onAddManualConfirmation={runtime.recovery ? () => insertPaletteNode({ kind: 'manual_confirmation' }, viewportInsertPoint()) : undefined}
                onAddMaterialSource={() => insertPaletteNode(
                  { kind: 'material' },
                  viewportInsertPoint()
                )}
                onAddAction={(templateUuid) => insertPaletteNode(
                  { kind: 'action', templateUuid },
                  viewportInsertPoint()
                )}
                onAddWorkflow={(templateUuid) => insertPaletteNode(
                  { kind: 'workflow', templateUuid },
                  viewportInsertPoint()
                )}
                onRefreshMaterialSourceCatalog={
                  refreshMaterialSourceCatalog
                }
              />
            )}
            {graph ? (
              <>
                {mode === 'canvas' && !hideCanvasSidebars && (definitionKind === 'operation' || debugLayout) &&
                  operationStructureOpen && (
                  <ExperimentOperationStructure
                    workflowName={workflowName || (debugLayout ? '当前工作流' : '当前实验操作')}
                    definitionKind={definitionKind}
                    nodes={structure.nodes}
                    linkCount={structure.links.length}
                    selectedNodeId={selectedNodeUuid}
                    onSelect={handleStructureNodeSelect}
                    onClose={() => setOperationStructureOpen(false)}
                  />
                )}
                <div
                  ref={graphStageRef}
                  className={`persistent-authoring__graph-stage${!hideRuntimeControls && mode === 'canvas' && !debugLayout ? ' has-canvas-debug-mode' : ''}`}
                >
                  {definitionKind === 'operation' && stageHeader}
                  {debugLayout && <WorkflowDebugToolbar
                    model={model}
                    workflowName={workflowName}
                    structureOpen={operationStructureOpen}
                    compact={compactCanvas}
                    onToggleStructure={() => {
                      if (compactCanvas) setNodePaletteOpen(false)
                      setOperationStructureOpen((open) => !open)
                    }}
                    onToggleLibrary={() => {
                      if (compactCanvas) setOperationStructureOpen(false)
                      setNodePaletteOpen((open) => !open)
                    }}
                    onAutoLayout={() => workflowDagRef.current?.autoLayout()}
                    onZoomIn={() => workflowDagRef.current?.zoomIn()}
                    onZoomOut={() => workflowDagRef.current?.zoomOut()}
                    onConfigureIo={() => setWorkflowIoOpen(true)}
                  />}
                  {!hideRuntimeControls && mode === 'canvas' && !debugLayout ? <WorkflowCanvasDebugMode model={model} /> : null}
                  {(graphStageReady ||
                    typeof globalThis.ResizeObserver !== 'function') && (
                    <WorkflowDag
                    ref={workflowDagRef}
                    nodes={structure.nodes}
                    links={structure.links}
                    onNodeSelect={handleCanvasNodeSelect}
                    selectedNodeId={mode === 'code'
                      ? sourceSelectedNodeUuid
                      : canvasRevealRequest?.nodeId}
                    revealNodeRequest={canvasRevealRequest}
                    onSetStart={toggleDebugStartNode}
                    onToggleBreakpoint={toggleDebugBreakpoint}
                    onToggleDisabled={mode === 'canvas'
                      ? toggleNodeDisabled
                      : undefined}
                    nodeStates={taskNodeStates}
                    breakpoints={debugBreakpoints}
                    startNodeId={debugExecutionScope.startNodeId}
                    beforeStartNodeIds={
                      debugExecutionScope.beforeStartNodeIds
                    }
                    pausedBeforeNodeId={pausedBeforeNodeId}
                    canBeautify={
                      !busy &&
                      canvasMutationEnabled &&
                      structure.nodes.length > 0
                    }
                    beautifyDisabledReason={busy
                      ? '正在处理工作流，请稍后美化布局'
                      : !canvasMutationEnabled
                        ? '当前模式只允许查看工作流画布'
                        : '工作流图尚未加载完成'}
                    onBeautify={beautifyCanvasLayout}
                    canvasMutationEnabled={canvasMutationEnabled}
                    nodePositionMutationEnabled={canvasMutationEnabled}
                    onNodePositionChange={moveCanvasNode}
                    onNodePositionsChange={moveCanvasNodes}
                    onNodeParentChange={moveCanvasNodeToLoop}
                    onConnectHandles={connectTypedHandles}
                    onConnectConditionBranch={connectConditionBranchHandle}
                    onAddNodeToLoop={() => setNodePaletteOpen(true)}
                    onDeleteRequest={deleteCanvasElements}
                    onOpenChildWorkflow={onOpenChildWorkflow
                      ? (childWorkflowUuid, childWorkflowName) => {
                          if (dirty) {
                            setError('请先保存当前工作流修改，再进入子工作流')
                            return
                          }
                          onOpenChildWorkflow(
                            childWorkflowUuid,
                            childWorkflowName,
                            {
                              viewport:
                                workflowDagRef.current?.viewportSnapshot() ?? null,
                              selectedNodeUuid
                            }
                          )
                        }
                      : undefined}
                    visibleMaterialRoles={visibleMaterialRoles}
                    onVisibleMaterialRolesChange={
                      onVisibleMaterialRolesChange
                    }
                    />
                  )}
                  {(definitionKind === 'operation' || debugLayout) && (
                    <PersistentWorkflowRuntimePanel
                      model={model}
                      onNodeSelect={handleRuntimeNodeSelect}
                    />
                  )}
                </div>
                {mode === 'canvas' && !compactCanvas && !hideCanvasSidebars && (
                  <>
                    <div className="persistent-authoring__inspector-resize-handle" role="separator" aria-label="调整参数面板宽度" onPointerDown={handleInspectorResize} />
                    <WorkflowNodeInspector model={model} definitionKind={definitionKind} workflowName={workflowName} debugLayout={debugLayout} />
                  </>
                )}
              </>
            ) : (
              <p className="persistent-authoring__empty">
                正在读取 {authorityLabel} 工作流编辑数据…
              </p>
            )}
          </div>
        </section>
      </section>

      {definitionKind !== 'operation' && !debugLayout && (
        <PersistentWorkflowRuntimePanel
          model={model}
          onNodeSelect={handleRuntimeNodeSelect}
        />
      )}

      {manualInsertPosition && actionCatalog && <ManualConfirmationCreateDialog
        catalog={actionCatalog} busy={busy || !canvasMutationEnabled}
        onClose={() => setManualInsertPosition(null)}
        onCreate={(templateUuid, config) => {
          if (busy || !canvasMutationEnabled) return
          addTypedActionNode(templateUuid, manualInsertPosition, config)
          setManualInsertPosition(null)
        }} />}
      <PersistentWorkflowOverlays
        model={model}
        definitionKind={definitionKind}
      />
      {createWorkflowOpen && <CreateWorkflowDialog
        onCancel={() => setCreateWorkflowOpen(false)}
        onCreate={async (request) => {
          const created = await runtime.createWorkflowDefinition(request)
          setCreateWorkflowOpen(false)
          onSelectWorkflow?.(created.uuid, created.name)
        }}
      />}
      {paletteDragPreview && typeof document !== 'undefined' && createPortal(
        <div
          className="persistent-authoring__palette-drag-preview"
          style={{
            left: paletteDragPreview.clientX,
            top: paletteDragPreview.clientY,
            width: WORKFLOW_PALETTE_PREVIEW_WIDTH,
            minHeight: WORKFLOW_PALETTE_PREVIEW_HEIGHT
          }}
          aria-hidden="true"
        >
          <span className="persistent-authoring__palette-drag-preview-kind">
            <i />实验操作
          </span>
          <strong>{paletteDragPreview.name}</strong>
          <small>{paletteDragPreview.detail}</small>
        </div>,
        document.body
      )}
    </div>
  )
}
