import { clsx } from 'clsx'
import taskDetailPageStyles from './TaskDetailPage.module.scss'
import { TaskDetailSummary } from './TaskDetailSummary'
import { TaskDetailTimelinePanel } from './TaskDetailTimelinePanel'
import { TaskDetailInspectorDrawer } from './TaskDetailInspectorDrawer'
import { DebugIcon } from './TaskDetailIcons'
import { ParallelDrawer } from './TaskParallelDrawer'
import { useTaskDetailController } from './useTaskDetailController'

export function TaskDetailPage({
  taskUuid: requestedTaskUuid,
  onBack,
}: { taskUuid?: string; onBack?: () => void } = {}) {
  const controller = useTaskDetailController(requestedTaskUuid)
  const {
    viewModel,
    parallelOpen,
    setParallelOpen,
    selectedBranch,
    setSelectedBranch,
    parallelNotice,
    facts,
    currentTimelineEvent,
    statusTooltip,
    selectedTask,
    submittedNodeUuid,
    submittedLifecycle,
    submitBranch,
  } = controller
  const taskUuid = selectedTask?.taskUuid ?? requestedTaskUuid
  return (
    <main className={clsx(taskDetailPageStyles['debug-page'])}>
      <header className={clsx(taskDetailPageStyles['debug-header'])}>
        <div className={clsx(taskDetailPageStyles['debug-header-title'])}>
          {onBack && (
            <button
              type="button"
              className={clsx(taskDetailPageStyles['debug-back-button'])}
              aria-label="返回任务列表"
              onClick={onBack}
            >
              <DebugIcon name="arrow-left" size={19} />
            </button>
          )}
          <div className={clsx(taskDetailPageStyles['debug-header-title-copy'])}>
            <h1>{viewModel?.selectedTaskTitle ?? 'Task 详情'}</h1>
            {taskUuid && (
              <span className={clsx(taskDetailPageStyles['debug-task-id'])}>
                任务 ID：<code>{taskUuid}</code>
              </span>
            )}
          </div>
        </div>
      </header>
      <TaskDetailSummary
        facts={facts}
        currentTimelineEvent={currentTimelineEvent}
        statusTooltip={statusTooltip}
      />
      <TaskDetailTimelinePanel controller={controller} />
      <TaskDetailInspectorDrawer controller={controller} />
      {parallelOpen && (
        <ParallelDrawer
          candidates={facts?.readyFrontier ?? []}
          joins={facts?.joins ?? []}
          selectedBranch={selectedBranch}
          submittedNodeUuid={submittedNodeUuid}
          submittedLifecycle={submittedLifecycle}
          notice={parallelNotice}
          onSelect={setSelectedBranch}
          onSubmit={submitBranch}
          onClose={() => setParallelOpen(false)}
        />
      )}
    </main>
  )
}
