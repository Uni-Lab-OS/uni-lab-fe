import { CodeEditor } from '@unilab/code-editor'
import { SlideOverDrawer } from '@unilab/design-system'

import type { usePersistentWorkflowAuthoring } from '../hooks/usePersistentWorkflowAuthoring'
import { diagnosticRange } from '../utils/persistentAuthoringSession'
import { workflowIoMetadata } from '../utils/persistentAuthoringProjection'
import { workflowTaskControlStatusLabel, workflowTaskStatusLabel, workflowTaskVisualStatus } from '../utils/workflowTaskPresentation'
import { workflowTaskMetadata } from '../utils/workflowTaskPanelProjection'
import WorkflowDag from './WorkflowDag'
import { WorkflowDebugger } from './WorkflowDebugger'
import { WorkflowOutput } from './WorkflowOutput'
import { WorkflowIoSummary } from './WorkflowIoSummary'
import { WorkflowIoEditor } from './WorkflowIoEditor'
import { WorkflowTaskInputForm } from './WorkflowTaskInputForm'
import { WorkflowActionParameterDrawer } from './WorkflowActionParameterDrawer'
import { WorkflowTraceViewer } from './WorkflowTraceViewer'
import { WorkflowButton } from './WorkflowButton'
import { MaterialSourceInspector } from './MaterialSourceInspector'
import styles from './workflow.module.scss'

type PersistentWorkflowAuthoringModel = ReturnType<
  typeof usePersistentWorkflowAuthoring
>

export function PersistentWorkflowAuthoringView({
  model
}: {
  model: PersistentWorkflowAuthoringModel
}): React.JSX.Element {
  const {
    acceptFullSourceDiff,
    actionCatalog,
    actionParametersOpen,
    addMaterialSourceNode,
    addPublishedWorkflowNode,
    addTypedActionNode,
    adoptRemoteConflict,
    aggregate,
    appliedIo,
    appliedWorkflowRunnable,
    applyCandidate,
    beautifyCanvasLayout,
    bindTypedFieldToWorkflowInput,
    busy,
    candidateIo,
    codeProjection,
    completedTaskJobCount,
    connectTypedHandles,
    deleteCanvasElements,
    debugBreakpoints,
    debugExecutionScope,
    diagnostics,
    dirty,
    discardAndSwitch,
    editor,
    effectiveMaterialSourceCatalog,
    error,
    fileUpload,
    fullSourceDiff,
    graph,
    jsonProjectionEditor,
    materialSourceAuthorityBlocked,
    materialSourceCatalogError,
    materialSourceCatalogLoading,
    materialTraces,
    message,
    mode,
    nodePaletteOpen,
    onChooseWorkflow,
    openTaskInputForm,
    outputExpanded,
    outputTab,
    pendingMode,
    policy,
    projectionKind,
    refreshMaterialSourceCatalog,
    remoteConflict,
    requestMode,
    resourceSlotOptions,
    retryLocalAfterConflict,
    runRuntime,
    runtime,
    runtimeBusy,
    saveDraft,
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
    setCanvasDirty,
    setCodeProjection,
    setError,
    setFullSourceDiff,
    setGraph,
    setMessage,
    setNodePaletteOpen,
    setOutputExpanded,
    setOutputTab,
    setPendingMode,
    setRemoteConflict,
    setResourceSlotOptions,
    setSelectedJobNodeUuid,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    setTaskInputAuthority,
    setTaskInputForm,
    setTaskInputProblem,
    setTaskRunMode,
    setTraceViewerOpen,
    setWorkflowIoOpen,
    structure,
    submitTaskInput,
    task,
    taskControls,
    taskInputAuthority,
    taskInputForm,
    taskInputProblem,
    taskJobs,
    taskNodeNames,
    taskNodeStates,
    taskOutputNodes,
    taskRunMode,
    taskRuntime,
    taskRuntimeEvents,
    toggleDebugBreakpoint,
    toggleDebugStartNode,
    traceRuntime,
    traceViewerOpen,
    updateMaterialSource,
    updateTaskInput,
    updateTypedField,
    updateTypedFieldFromRaw,
    workflowIoOpen,
    workflowUuid,
  } = model

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
          <WorkflowButton
            type="button"
            className={mode === 'code' ? 'is-active' : ''}
            aria-pressed={mode === 'code'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换编辑模式"
            onClick={() => requestMode('code')}
          >
            代码模式
          </WorkflowButton>
          <WorkflowButton
            type="button"
            className={mode === 'canvas' ? 'is-active' : ''}
            aria-pressed={mode === 'canvas'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换编辑模式"
            onClick={() => requestMode('canvas')}
          >
            画布模式
          </WorkflowButton>
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
              <WorkflowButton
                type="button"
                className="workflow__upload"
                disabled={busy || dirty}
                disabledReason={busy
                  ? '正在处理工作流，请稍后返回列表'
                  : '请先保存当前可写内容'}
                title={dirty ? '请先保存当前可写表示' : undefined}
                onClick={onChooseWorkflow}
              >
                工作流列表
              </WorkflowButton>
            )}
            <WorkflowButton
              type="button"
              className="workflow__upload"
              disabled={busy || dirty || !aggregate}
              disabledReason={busy
                ? '正在处理工作流，请稍后导入 Python'
                : dirty
                  ? '请先保存当前可写内容'
                  : '工作流尚未加载完成'}
              title={dirty ? '请先保存当前可写表示' : undefined}
              onClick={() => fileUpload.openFilePicker('python')}
            >
              导入 Python
            </WorkflowButton>
            <WorkflowButton
              type="button"
              className="workflow__upload"
              disabled={busy || dirty || !aggregate}
              disabledReason={busy
                ? '正在处理工作流，请稍后导入 JSON'
                : dirty
                  ? '请先保存当前可写内容'
                  : '工作流尚未加载完成'}
              title={dirty ? '请先保存当前可写表示' : undefined}
              onClick={() => fileUpload.openFilePicker('json')}
            >
              导入 JSON
            </WorkflowButton>
          </div>
          <div
            className="persistent-authoring__toolbar-group"
            role="group"
            aria-label="工作流保存与应用"
          >
            <WorkflowButton
              type="button"
              className="workflow__upload"
              disabled={busy || !aggregate}
              disabledReason={busy
                ? '正在处理工作流，请稍后保存草稿'
                : '工作流尚未加载完成'}
              onClick={saveDraft}
            >
              保存草稿
            </WorkflowButton>
            <WorkflowButton
              type="button"
              className="workflow__upload persistent-authoring__apply"
              disabled={
                busy ||
                dirty ||
                !aggregate?.candidate ||
                materialSourceAuthorityBlocked
              }
              disabledReason={busy
                ? '正在处理工作流，请稍后应用'
                : dirty
                  ? '请先保存当前可写内容'
                  : materialSourceAuthorityBlocked
                    ? '物料来源目录或引用已失效，请先刷新'
                    : '当前没有可应用的候选版本'}
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
            </WorkflowButton>
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
            <WorkflowButton
              type="button"
              className={taskRunMode === 'normal' ? 'is-active' : ''}
              aria-pressed={taskRunMode === 'normal'}
              disabled={runtimeBusy}
              disabledReason="正在处理工作流任务，暂时不能切换运行模式"
              onClick={() => setTaskRunMode('normal')}
            >
              正常运行
            </WorkflowButton>
            <WorkflowButton
              type="button"
              className={taskRunMode === 'step' ? 'is-active' : ''}
              aria-pressed={taskRunMode === 'step'}
              disabled={runtimeBusy}
              disabledReason="正在处理工作流任务，暂时不能切换运行模式"
              onClick={() => setTaskRunMode('step')}
            >
              单步模式
            </WorkflowButton>
            </div>
            <WorkflowButton
              type="button"
              className="workflow-runtime__primary"
              disabled={
                busy ||
                runtimeBusy ||
                dirty ||
                !aggregate ||
                !appliedWorkflowRunnable
              }
              disabledReason={busy
                ? '正在处理工作流编写操作，请稍候'
                : runtimeBusy
                  ? '正在处理上一项工作流任务操作，请稍候'
                  : dirty
                    ? '请先保存当前可写内容'
                    : !appliedWorkflowRunnable
                      ? '请先应用包含可执行节点的工作流'
                      : '已应用工作流尚未就绪'}
              title={
                dirty
                  ? '请先保存当前可写表示'
                  : appliedWorkflowRunnable && aggregate
                    ? `将使用已应用版本 ${aggregate.workflow_revision}`
                    : '请先应用包含可执行节点的工作流'
              }
              onClick={openTaskInputForm}
            >
              {runtimeBusy ? '处理中…' : '开始运行'}
            </WorkflowButton>
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
          <WorkflowButton
            type="button"
            disabled={runtimeBusy}
            disabledReason="正在补读工作流任务状态，请稍候"
            onClick={() => runRuntime(() => taskRuntime.refresh())}
          >
            重试状态读取
          </WorkflowButton>
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
          aria-label="工作流代码视图"
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
            {mode === 'canvas'
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
                    <WorkflowButton
                      type="button"
                      className="persistent-authoring__palette-source"
                      disabled={
                        busy ||
                        !policy.canvasMutationEnabled ||
                        !effectiveMaterialSourceCatalog ||
                        materialSourceAuthorityBlocked
                      }
                      disabledReason={busy
                        ? '正在处理工作流，请稍后添加物料来源'
                        : !policy.canvasMutationEnabled
                          ? '当前模式只允许查看工作流画布'
                          : materialSourceAuthorityBlocked
                            ? '物料来源目录或引用已失效，请先刷新'
                            : '物料与库位目录尚未加载完成'}
                      onClick={addMaterialSourceNode}
                    >
                      <span aria-hidden="true">▱</span>
                      <span>
                        <strong>物料来源</strong>
                        <small>OS 准入声明</small>
                      </span>
                    </WorkflowButton>
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
                        <WorkflowButton
                          type="button"
                          key={template.uuid}
                          disabled={
                            busy ||
                            !policy.canvasMutationEnabled ||
                            !graph
                          }
                          disabledReason={busy
                            ? '正在处理工作流，请稍后添加操作节点'
                            : !policy.canvasMutationEnabled
                              ? '当前模式只允许查看工作流画布'
                              : '工作流图尚未加载完成'}
                          onClick={() => addTypedActionNode(template.uuid)}
                        >
                          <span aria-hidden="true">⌁</span>
                          <span>
                            <strong>{template.displayName}</strong>
                            <small>{template.name}</small>
                          </span>
                        </WorkflowButton>
                      ))}
                    </div>
                  </section>
                  {Boolean(actionCatalog?.workflowTemplates.length) && (
                    <section>
                      <h3>子工作流</h3>
                      <div className="persistent-authoring__palette-actions">
                        {actionCatalog?.workflowTemplates.map((template) => (
                          <WorkflowButton
                            type="button"
                            key={template.uuid}
                            disabled={
                              busy ||
                              !policy.canvasMutationEnabled ||
                              !graph
                            }
                            disabledReason={busy
                              ? '正在处理工作流，请稍后添加子工作流'
                              : !policy.canvasMutationEnabled
                                ? '当前模式只允许查看工作流画布'
                                : '工作流图尚未加载完成'}
                            onClick={() => addPublishedWorkflowNode(template.uuid)}
                          >
                            <span aria-hidden="true">▣</span>
                            <span>
                              <strong>{template.displayName}</strong>
                              <small>{template.source.symbol}</small>
                            </span>
                          </WorkflowButton>
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
                    canBeautify={
                      !busy &&
                      policy.canvasMutationEnabled &&
                      structure.nodes.length > 0
                    }
                    beautifyDisabledReason={busy
                      ? '正在处理工作流，请稍后美化布局'
                      : !policy.canvasMutationEnabled
                        ? '当前模式只允许查看工作流画布'
                        : '工作流图尚未加载完成'}
                    onBeautify={beautifyCanvasLayout}
                    canvasMutationEnabled={policy.canvasMutationEnabled}
                    onConnectHandles={connectTypedHandles}
                    onDeleteRequest={deleteCanvasElements}
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
                    ? '规范化源码确认'
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
              <WorkflowButton
                type="button"
                className="workflow-save-prompt__cancel"
                disabled={busy}
                disabledReason="正在处理工作流源码，请稍候"
                onClick={() => setFullSourceDiff(null)}
              >
                取消
              </WorkflowButton>
              <WorkflowButton
                type="button"
                className="workflow-save-prompt__file"
                disabled={busy}
                disabledReason="正在保存并校验工作流源码，请稍候"
                onClick={acceptFullSourceDiff}
              >
                {busy
                  ? '处理中…'
                  : fullSourceDiff.applyAfterSave
                    ? '接受完整差异并应用'
                    : '接受完整差异并保存'}
              </WorkflowButton>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}
