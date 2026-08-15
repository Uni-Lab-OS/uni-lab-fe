import { CodeEditor } from '@unilab/code-editor'
import { useCallback, useEffect, useRef, useState } from 'react'

import { diagnosticRange } from '../utils/persistentAuthoringSession'
import {
  canRetryWorkflowRuntimeRead,
  workflowRuntimeProblemHeading
} from '../utils/workflowRuntimeProblem'
import WorkflowDag from './WorkflowDag'
import { WorkflowOutput } from './WorkflowOutput'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowCanvasStageHeader } from './WorkflowCanvasStageHeader'
import { MaterialSourceInspector } from './MaterialSourceInspector'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { PersistentWorkflowOverlays } from './PersistentWorkflowOverlays'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'
import { WorkflowNodePalette } from './WorkflowNodePalette'
import styles from './workflow.module.scss'

export const COMPACT_WORKFLOW_CANVAS_WIDTH = 1024

export function PersistentWorkflowAuthoringView({
  model,
  workflowName,
  visibleMaterialRoles,
  onVisibleMaterialRolesChange,
  hideEmbeddedCodeEditor = false
}: {
  model: PersistentWorkflowAuthoringModel
  workflowName?: string
  visibleMaterialRoles?: readonly string[] | null
  onVisibleMaterialRolesChange?: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
  hideEmbeddedCodeEditor?: boolean
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
    canvasSaveHint,
    codeProjection,
    completedTaskJobCount,
    connectTypedHandles,
    deleteCanvasElements,
    debugBreakpoints,
    debugExecutionScope,
    definitionEditingAvailable,
    definitionEditingDisabledReason,
    diagnostics,
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
    materialTraces,
    mode,
    nodePaletteOpen,
    outputExpanded,
    outputTab,
    pausedBeforeNodeId,
    policy,
    projectionKind,
    refreshMaterialSourceCatalog,
    revealPackageSource,
    runRuntime,
    runtime,
    runtimeBusy,
    selectCanvasNode,
    selectedActionEditor,
    selectedActionProjection,
    selectedActionTemplate,
    selectedIsMaterialSource,
    selectedJobNodeUuid,
    selectedMaterialSourceEditor,
    selectedMaterialSourceProjection,
    selectedNodeIsInternal,
    selectedNodeName,
    selectedNodeUuid,
    selectedTaskNode,
    setActionParametersOpen,
    setCodeProjection,
    setError,
    setGraph,
    setMessage,
    setNodePaletteOpen,
    setOutputExpanded,
    setOutputTab,
    setSelectedJobNodeUuid,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    setTraceViewerOpen,
    setWorkflowIoOpen,
    sourceSelectedNodeUuid,
    sourceEditingAvailable,
    sourceEditingDisabledReason,
    sourceProjection,
    structure,
    task,
    taskJobs,
    taskNodeNames,
    taskNodeStates,
    taskOutputNodes,
    taskRuntime,
    taskActivity,
    traceRuntime,
    toggleDebugBreakpoint,
    toggleDebugStartNode,
    toggleNodeDisabled,
    updateMaterialSource,
    workflowUuid,
  } = model
  const [canvasRevealRequest, setCanvasRevealRequest] = useState<{
    nodeId: string
    nonce: number
  } | null>(null)
  const authoringViewRef = useRef<HTMLDivElement | null>(null)
  const [compactCanvas, setCompactCanvas] = useState(false)

  useEffect(() => {
    const element = authoringViewRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const compact = entry.contentRect.width < COMPACT_WORKFLOW_CANVAS_WIDTH
      setCompactCanvas(compact)
      if (compact) setNodePaletteOpen(false)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [setNodePaletteOpen])
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
  const debugProjection = taskRuntime.snapshot.debug
  const debugFinished = !task || [
    'succeeded',
    'failed',
    'canceled',
    'timeout'
  ].includes(task.status) || [
    'completed',
    'stopped'
  ].includes(debugProjection?.status ?? '')
  const debugStatusLabel: Record<string, string> = {
    paused: '已暂停',
    running: '运行中',
    completed: '已完成',
    stopped: '已停止'
  }

  return (
    <div
      ref={authoringViewRef}
      className={[
        styles.workflow,
        'workflow-runtime persistent-authoring',
        mode === 'canvas' ? 'persistent-authoring--canvas' : '',
        'relative flex h-full w-full flex-col',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
      data-workflow-source-uri={sourceProjection?.sourceUri ?? ''}
      data-workflow-source-version={sourceProjection?.sourceVersion ?? ''}
      data-workflow-source-mapping={sourceProjection?.mappingAvailable
        ? 'available'
        : 'unavailable'}
      data-workflow-ide-bridge={ideBridgeConnected ? 'connected' : 'missing'}
    >
      <PersistentWorkflowToolbar model={model} />

      {executionBlockedReason && (
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
            {workflowRuntimeProblemHeading(taskRuntime.snapshot.actionError)}
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
              重试状态读取
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
                  disabledReason="Python 草稿视图始终可用"
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
                : 'JSON 是 OS 候选图的只读投影'}>
                {codeProjection === 'python'
                  ? 'Python 草稿 · 可编辑'
                  : 'OS 候选图 · 只读'}
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
              ? sourceEditingDisabledReason
              : mode === 'canvas'
                ? 'Python 是 OS 生成的只读投影'
                : codeProjection === 'json'
                  ? 'JSON 来自 OS 候选图，仅供查看；切换不会覆盖 Python 草稿'
                  : 'Python 草稿可编辑；保存时校验草稿哈希与工作流版本'}
          </p>
        </section>

        <section
          className="persistent-authoring__pane persistent-authoring__canvas"
          aria-label="工作流画布"
        >
          <WorkflowCanvasStageHeader
            title={workflowName || '完整控制流 DAG'}
            nodeCount={structure.nodes.length}
            linkCount={structure.links.length}
            projectionTitle={authorityLabel === 'Backend'
              ? definitionEditingAvailable
                ? '画布可编辑并直接保存；工作区代码修改不生效'
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
            tools={(
              <>
                {mode === 'canvas' && !compactCanvas && (
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
              </>
            )}
          />
          <div className={[
            'persistent-authoring__canvas-body',
            mode === 'code' ? 'is-code-mode' : '',
            mode === 'canvas' && (!nodePaletteOpen || compactCanvas)
              ? 'is-palette-closed'
              : '',
            mode === 'canvas' && selectedNodeUuid && !compactCanvas
              ? 'has-inspector'
              : ''
          ].filter(Boolean).join(' ')}>
            {graph ? (
              <>
                {mode === 'canvas' && nodePaletteOpen && !compactCanvas && (
                  <WorkflowNodePalette
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
                    onAddMaterialSource={addMaterialSourceNode}
                    onAddAction={addTypedActionNode}
                    onAddWorkflow={addPublishedWorkflowNode}
                    onRefreshMaterialSourceCatalog={
                      refreshMaterialSourceCatalog
                    }
                  />
                )}
                <div className="persistent-authoring__graph-stage">
                  <WorkflowDag
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
                    onConnectHandles={connectTypedHandles}
                    onDeleteRequest={deleteCanvasElements}
                    visibleMaterialRoles={visibleMaterialRoles}
                    onVisibleMaterialRolesChange={
                      onVisibleMaterialRolesChange
                    }
                  />
                </div>
                {mode === 'canvas' && selectedNodeUuid && !compactCanvas && (
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
                          busy || !canvasMutationEnabled ||
                          selectedNodeIsInternal
                        }
                        aria-describedby="persistent-node-name-help"
                        onChange={(event) => {
                          setSelectedNodeName(event.target.value)
                          setSelectedNodeNameDirty(true)
                          setMessage(canvasSaveHint)
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
                            !busy && canvasMutationEnabled &&
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
                          onRevealSource={revealPackageSource}
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
                      {canvasSaveHint}
                    </p>
                  </aside>
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

      <section
        className="persistent-authoring__runtime"
        aria-label="工作流任务运行控制"
      >
        {debugProjection && (
          <section
            className="persistent-authoring__debug-console"
            aria-label="调试控制台"
            data-debug-status={debugProjection.status}
          >
            <div>
              <strong>调试控制台</strong>
              <span>
                {pausedBeforeNodeId
                  ? `已在节点前暂停：${taskNodeNames[pausedBeforeNodeId] || pausedBeforeNodeId}`
                  : debugProjection.status === 'running'
                    ? '正在运行到下一个断点'
                    : `调试会话：${debugStatusLabel[debugProjection.status] ?? debugProjection.status}`}
              </span>
            </div>
            <div role="group" aria-label="调试执行控制">
              <WorkflowButton
                type="button"
                disabled={runtimeBusy || !pausedBeforeNodeId}
                disabledReason="当前没有可单步放行的暂停点"
                title="只执行当前暂停节点，然后在下一节点前暂停"
                onClick={() => runRuntime(
                  () => taskRuntime.debugCommand('step')
                )}
              >
                <span aria-hidden="true">↷</span>
                <span>单步</span>
              </WorkflowButton>
              <WorkflowButton
                type="button"
                disabled={runtimeBusy || !pausedBeforeNodeId}
                disabledReason="当前没有可继续放行的暂停点"
                title="继续运行到下一个断点"
                onClick={() => runRuntime(
                  () => taskRuntime.debugCommand('continue')
                )}
              >
                <span aria-hidden="true">▶</span>
                <span>继续</span>
              </WorkflowButton>
              <WorkflowButton
                type="button"
                className="is-danger"
                disabled={runtimeBusy || debugFinished}
                disabledReason="当前没有可停止的调试任务"
                title="停止调试并取消剩余节点作业"
                onClick={() => runRuntime(
                  () => taskRuntime.command('cancel')
                )}
              >
                <span aria-hidden="true">■</span>
                <span>停止</span>
              </WorkflowButton>
            </div>
          </section>
        )}
        <WorkflowOutput
          expanded={outputExpanded}
          resizable
          activeTab={outputTab}
          completedNodeCount={completedTaskJobCount}
          expectedNodeCount={taskJobs.length}
          nodes={taskOutputNodes}
          nodeNames={taskNodeNames}
          activity={taskActivity}
          error={taskRuntime.snapshot.error}
          selectedNode={selectedTaskNode}
          selectedNodeId={selectedJobNodeUuid}
          pausedBeforeNodeId={pausedBeforeNodeId}
          title="运行输出"
          countLabel="个节点任务已结束"
          nodesTabLabel="节点任务状态"
          onExpandedChange={setOutputExpanded}
          onTabChange={setOutputTab}
          onNodeSelect={handleRuntimeNodeSelect}
          onClearError={taskRuntime.clearError}
          onTraceOpen={traceRuntime
            ? () => setTraceViewerOpen(true)
            : undefined}
        />
      </section>

      <PersistentWorkflowOverlays model={model} />
    </div>
  )
}
