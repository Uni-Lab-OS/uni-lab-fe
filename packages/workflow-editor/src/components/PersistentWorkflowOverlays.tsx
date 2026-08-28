import { SlideOverDrawer } from '@unilab/design-system'
import type { WorkflowDefinitionKind } from '@unilab/services'

import { workflowIoMetadata } from '../utils/persistentAuthoringProjection'
import { WorkflowActionParameterDrawer } from './WorkflowActionParameterDrawer'
import { WorkflowButton } from './WorkflowButton'
import { DebugLaunchInputForm } from './DebugLaunchInputForm'
import { WorkflowIoEditor } from './WorkflowIoEditor'
import { WorkflowIoSummary } from './WorkflowIoSummary'
import { WorkflowTaskInputForm } from './WorkflowTaskInputForm'
import { WorkflowTraceViewer } from './WorkflowTraceViewer'
import { WorkflowSourceDiff } from './WorkflowSourceDiff'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'

/**
 * 呈现工作流（Workflow）编写器的抽屉、冲突门禁和完整源码复核层。
 *
 * @param props 共享编写模型；该组件不拥有持久化状态。
 * @returns 叠加在主工作区之上的受控交互层。
 */
export function PersistentWorkflowOverlays({
  model,
  definitionKind = 'workflow'
}: {
  model: PersistentWorkflowAuthoringModel
  definitionKind?: WorkflowDefinitionKind
}): React.JSX.Element {
  const definitionLabel = definitionKind === 'operation' ? '操作' : '工作流'
  const {
    acceptFullSourceDiff,
    actionParametersOpen,
    adoptRemoteConflict,
    aggregate,
    appliedIo,
    backToTaskInput,
    bindTypedFieldToWorkflowInput,
    busy,
    cancelFullSourceDiff,
    closeTaskInputForm,
    discardAndSwitch,
    debugLaunchForm,
    fullSourceDiff,
    graph,
    mode,
    pendingMode,
    policy,
    remoteConflict,
    resourceSlotOptions,
    retryLocalAfterConflict,
    runtimeBusy,
    selectedActionEditor,
    selectedActionTemplate,
    selectedNodeName,
    setActionParametersOpen,
    setCanvasDirty,
    setError,
    setGraph,
    setMessage,
    setPendingMode,
    setRemoteConflict,
    setTaskInputProblem,
    setTraceViewerOpen,
    setWorkflowIoOpen,
    submitTaskInput,
    submitDebugLaunch,
    task,
    taskInputAuthority,
    taskInputForm,
    taskInputProblem,
    traceRuntime,
    traceViewerOpen,
    updateTaskInput,
    updateDebugLaunchInput,
    updateTypedField,
    updateTypedFieldFromRaw,
    workflowIoOpen
  } = model

  return (
    <>
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
        resourceSlotOptions={resourceSlotOptions}
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
        onResourceChange={(field, materialUuid) => updateTypedField(
          field.handleUuid,
          materialUuid ? { uuid: materialUuid } : undefined
        )}
        onClear={(handleUuid) => updateTypedField(handleUuid, undefined)}
        onNull={(handleUuid) => updateTypedField(handleUuid, null)}
      />

      <SlideOverDrawer
        open={workflowIoOpen}
        size="medium"
        ariaLabel={`${definitionLabel}输入与输出配置`}
        title={(
          <span className="persistent-authoring__drawer-title">
            <span>{definitionLabel}设置</span>
            <strong>设置{definitionLabel}输入与输出</strong>
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
            <strong>整个{definitionLabel}的输入与输出</strong>
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
                  `${definitionLabel}输入与输出已修改；保存前将由 OS 生成规范 Python`
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
            <strong>
              {debugLaunchForm ? '补充调试输入' : '确认运行参数'}
            </strong>
          </span>
        )}
        onClose={closeTaskInputForm}
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
            {debugLaunchForm ? (
              <DebugLaunchInputForm
                form={debugLaunchForm}
                busy={runtimeBusy}
                problem={taskInputProblem}
                onChange={updateDebugLaunchInput}
                onSubmit={submitDebugLaunch}
                onCancel={backToTaskInput}
              />
            ) : (
              <WorkflowTaskInputForm
                aggregate={taskInputAuthority}
                form={taskInputForm}
                busy={runtimeBusy}
                problem={taskInputProblem}
                resourceSlotOptions={resourceSlotOptions}
                onChange={updateTaskInput}
                onProblem={setTaskInputProblem}
                onSubmit={submitTaskInput}
                onCancel={closeTaskInputForm}
              />
            )}
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
            aria-labelledby="persistent-source-diff-title"
            aria-describedby="persistent-source-diff-description"
          >
            <header className="workflow-save-prompt__header">
              <h2 id="persistent-source-diff-title">完整 Python 差异</h2>
              <p
                id="persistent-source-diff-description"
                className="persistent-authoring__diff-description"
              >
                {fullSourceDiff.reason === 'conflict_retry'
                  ? '冲突重试检查'
                  : fullSourceDiff.reason === 'source_normalization'
                    ? '规范化源码确认'
                    : '画布保存检查'}
                {' · '}<span aria-hidden="true">+</span> 新增
                {' · '}<span aria-hidden="true">−</span> 删除
                {' · '}高亮显示行内变化
              </p>
            </header>
            <div className="persistent-authoring__diff-content">
              <WorkflowSourceDiff
                before={fullSourceDiff.before}
                after={fullSourceDiff.after}
              />
            </div>
            <footer className="workflow-save-prompt__actions">
              <WorkflowButton
                type="button"
                className="workflow-save-prompt__cancel"
                disabled={busy}
                disabledReason="正在处理工作流源码，请稍候"
                onClick={cancelFullSourceDiff}
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
    </>
  )
}
