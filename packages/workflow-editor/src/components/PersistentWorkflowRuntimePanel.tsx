import { WorkflowButton } from './WorkflowButton'
import { WorkflowOutput } from './WorkflowOutput'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'

/** 把调试控制和权威运行输出收敛为可嵌入画布的结果坞。 */
export function PersistentWorkflowRuntimePanel({
  model,
  onNodeSelect
}: {
  model: PersistentWorkflowAuthoringModel
  onNodeSelect(nodeId: string): void
}): React.JSX.Element {
  const {
    completedTaskJobCount,
    outputExpanded,
    outputTab,
    pausedBeforeNodeId,
    runRuntime,
    runtimeBusy,
    selectedJobNodeUuid,
    selectedTaskNode,
    setOutputExpanded,
    setOutputTab,
    setTraceViewerOpen,
    task,
    taskActivity,
    taskJobs,
    taskNodeNames,
    taskOutputNodes,
    taskRuntime,
    traceRuntime
  } = model
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
              <span className="codicon codicon-debug-step-over" aria-hidden="true" />
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
              <span className="codicon codicon-debug-continue" aria-hidden="true" />
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
              <span className="codicon codicon-debug-stop" aria-hidden="true" />
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
        onNodeSelect={onNodeSelect}
        onClearError={taskRuntime.clearError}
        onTraceOpen={traceRuntime
          ? () => setTraceViewerOpen(true)
          : undefined}
      />
    </section>
  )
}
