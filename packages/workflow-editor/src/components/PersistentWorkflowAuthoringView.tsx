import { CodeEditor } from '@unilab/code-editor'
import type { WorkflowDefinitionKind } from '@unilab/services'
import { useCallback, useEffect, useRef, useState } from 'react'

import { diagnosticRange } from '../utils/persistentAuthoringSession'
import {
  canRetryWorkflowRuntimeRead,
  workflowRuntimeProblemHeading
} from '../utils/workflowRuntimeProblem'
import WorkflowDag, { type WorkflowDagHandle } from './WorkflowDag'
import { ExperimentOperationStructure } from './ExperimentOperationStructure'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowCanvasStageHeader } from './WorkflowCanvasStageHeader'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { PersistentWorkflowOverlays } from './PersistentWorkflowOverlays'
import { PersistentWorkflowRuntimePanel } from './PersistentWorkflowRuntimePanel'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'
import { WorkflowAuthoringLibrary } from './WorkflowAuthoringLibrary'
import { WorkflowNodeInspector } from './WorkflowNodeInspector'
import {
  hasWorkflowNodePaletteDragPayload,
  readWorkflowNodePaletteDragPayload,
  type WorkflowCanvasBreadcrumb,
  type WorkflowCanvasNavigationState,
  type WorkflowCanvasPoint,
  type WorkflowNodePaletteDragPayload
} from '../utils/workflowCanvasCommands'
import styles from './workflow.module.scss'

export const COMPACT_WORKFLOW_CANVAS_WIDTH = 1024

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
  hideRuntimeControls = false,
  onResetEnvironment,
  environmentResetBusy = false
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
  hideRuntimeControls?: boolean
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
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
    deleteCanvasElements,
    debugBreakpoints,
    debugExecutionScope,
    definitionEditingAvailable,
    definitionEditingDisabledReason,
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
    nodePaletteOpen,
    pausedBeforeNodeId,
    policy,
    projectionKind,
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
  const graphStageRef = useRef<HTMLDivElement | null>(null)
  const workflowDagRef = useRef<WorkflowDagHandle | null>(null)
  const restoredNavigationRef = useRef<string | null>(null)
  const [compactCanvas, setCompactCanvas] = useState(false)
  const [graphStageReady, setGraphStageReady] = useState(false)
  const [operationStructureOpen, setOperationStructureOpen] = useState(true)

  useEffect(() => {
    const element = authoringViewRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const compact = entry.contentRect.width < COMPACT_WORKFLOW_CANVAS_WIDTH
      setCompactCanvas(compact)
      if (compact) {
        setNodePaletteOpen(false)
        setOperationStructureOpen(false)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [setNodePaletteOpen])
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
    selectCanvasNode(nodeId)
  }, [selectCanvasNode])
  const handleRuntimeNodeSelect = useCallback((nodeId: string): void => {
    setSelectedJobNodeUuid(nodeId)
    selectCanvasNode(nodeId, 'runtime')
    setCanvasRevealRequest((current) => ({
      nodeId,
      nonce: (current?.nonce ?? 0) + 1
    }))
  }, [selectCanvasNode, setSelectedJobNodeUuid])
  const handleStructureNodeSelect = useCallback((nodeId: string): void => {
    selectCanvasNode(nodeId)
    setCanvasRevealRequest((current) => ({
      nodeId,
      nonce: (current?.nonce ?? 0) + 1
    }))
  }, [selectCanvasNode])
  const insertPaletteNode = useCallback((
    payload: WorkflowNodePaletteDragPayload,
    position?: WorkflowCanvasPoint
  ): void => {
    if (payload.kind === 'material') {
      addMaterialSourceNode(position)
    } else if (payload.kind === 'action') {
      addTypedActionNode(payload.templateUuid, position)
    } else {
      addPublishedWorkflowNode(payload.templateUuid, position)
    }
  }, [addMaterialSourceNode, addPublishedWorkflowNode, addTypedActionNode])
  const viewportInsertPoint = useCallback((): WorkflowCanvasPoint =>
    workflowDagRef.current?.viewportCenter() ?? { x: 96, y: 96 }, [])
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

  return (
    <div
      ref={authoringViewRef}
      className={[
        styles.workflow,
        'workflow-runtime persistent-authoring',
        mode === 'canvas' ? 'persistent-authoring--canvas' : '',
        definitionKind === 'operation' ? 'persistent-authoring--operation' : '',
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
      {!hideRuntimeControls ? (
        <PersistentWorkflowToolbar
          model={model}
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

      {error && (
        <div className="workflow-runtime__problem" role="alert">
          <strong>工作流编辑操作失败</strong>
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
                    : 'Python 草稿可编辑；保存时校验草稿哈希与工作流版本'}
            </p>
          </section>
        ) : null}

        <section
          className="persistent-authoring__pane persistent-authoring__canvas"
          aria-label="工作流画布"
        >
          {!hideRuntimeControls ? <WorkflowCanvasStageHeader
            title={workflowName || (
              definitionKind === 'operation'
                ? '实验操作控制流 DAG'
                : '完整控制流 DAG'
            )}
            nodeCount={structure.nodes.length}
            linkCount={structure.links.length}
            projectionTitle={authorityLabel === 'Backend'
              ? definitionEditingAvailable
                ? '正式 Backend 仅支持画布编辑，修改后可直接保存'
                : definitionEditingDisabledReason ??
                  '当前 Backend 工作流定义只读'
              : projectionKind === 'candidate'
              ? mode === 'code'
                ? '当前画布是服务器候选版本的只读预览'
                : '画布编辑区基于候选版本；保存时由 OS 生成完整 Python'
              : mode === 'code'
                ? '当前显示已应用版本；暂无待应用修改'
                : '画布编辑区基于已应用版本；暂无待应用修改'}
            projectionLabel={authorityLabel === 'Backend'
              ? definitionEditingAvailable
                ? 'Backend 定义 · 已同步'
                : 'Backend 定义 · 只读'
              : projectionKind === 'candidate'
              ? mode === 'code'
                ? '候选版本 · 只读'
                : '候选版本 · 待保存'
              : mode === 'code'
                ? '已应用版本 · 只读'
                : '已应用版本 · 可编辑'}
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
                {mode === 'canvas' && (
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
                {mode === 'canvas' && definitionKind === 'operation' && (
                  <button
                    type="button"
                    className="persistent-authoring__panel-toggle"
                    aria-controls="persistent-authoring-operation-structure"
                    aria-pressed={operationStructureOpen}
                    onClick={() => {
                      if (compactCanvas) setNodePaletteOpen(false)
                      setOperationStructureOpen((open) => !open)
                    }}
                  >
                    {operationStructureOpen ? '隐藏流程' : '显示流程'}
                  </button>
                )}
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
                  <span>{definitionKind === 'operation'
                    ? '操作输入与输出'
                    : '输入与输出'}</span>
                  <strong>
                    输入 {candidateIo?.input_contract.parameters.length ?? 0}
                    {' · '}输出 {candidateIo?.output_contract.outputs.length ?? 0}
                  </strong>
                </WorkflowButton>
              </>
            )}
          /> : null}
          <div className={[
            'persistent-authoring__canvas-body',
            mode === 'code' ? 'is-code-mode' : '',
            mode === 'canvas' && !nodePaletteOpen
              ? 'is-palette-closed'
              : '',
            mode === 'canvas' && !compactCanvas
              ? 'has-inspector'
              : '',
            mode === 'canvas' && definitionKind === 'operation' &&
              operationStructureOpen
              ? 'has-operation-structure'
              : ''
          ].filter(Boolean).join(' ')}>
            {graph ? (
              <>
                {mode === 'canvas' && nodePaletteOpen && (
                  <WorkflowAuthoringLibrary
                    runtime={runtime}
                    workflowUuid={workflowUuid}
                    workflowName={workflowName}
                    definitionKind={definitionKind}
                    authoringDirty={dirty}
                    onSelectWorkflow={onSelectWorkflow}
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
                {mode === 'canvas' && definitionKind === 'operation' &&
                  operationStructureOpen && (
                  <ExperimentOperationStructure
                    workflowName={workflowName || '当前实验操作'}
                    nodes={structure.nodes}
                    linkCount={structure.links.length}
                    selectedNodeId={selectedNodeUuid}
                    onSelect={handleStructureNodeSelect}
                    onClose={() => setOperationStructureOpen(false)}
                  />
                )}
                <div
                  ref={graphStageRef}
                  className="persistent-authoring__graph-stage"
                  onDragOverCapture={(event) => {
                    if (!canvasMutationEnabled ||
                      !hasWorkflowNodePaletteDragPayload(event.dataTransfer)) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                  }}
                  onDropCapture={(event) => {
                    if (!canvasMutationEnabled) return
                    const payload = readWorkflowNodePaletteDragPayload(
                      event.dataTransfer
                    )
                    if (!payload) return
                    event.preventDefault()
                    event.stopPropagation()
                    const position = workflowDagRef.current
                      ?.clientToCanvasPoint(event.clientX, event.clientY) ??
                      viewportInsertPoint()
                    insertPaletteNode(payload, position)
                  }}
                >
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
                    onConnectHandles={connectTypedHandles}
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
                  {definitionKind === 'operation' && (
                    <PersistentWorkflowRuntimePanel
                      model={model}
                      onNodeSelect={handleRuntimeNodeSelect}
                    />
                  )}
                </div>
                {mode === 'canvas' && !compactCanvas && (
                  <WorkflowNodeInspector
                    model={model}
                    definitionKind={definitionKind}
                  />
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

      {definitionKind !== 'operation' && (
        <PersistentWorkflowRuntimePanel
          model={model}
          onNodeSelect={handleRuntimeNodeSelect}
        />
      )}

      <PersistentWorkflowOverlays
        model={model}
        definitionKind={definitionKind}
      />
    </div>
  )
}
