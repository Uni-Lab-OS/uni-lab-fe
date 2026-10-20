import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { Segmented } from 'antd'
import { ScheduleGantt } from '../schedule/SchedulePage'
import { useBackend } from '../../app/BackendProvider'
import taskDetailPageStyles from './TaskDetailPage.module.scss'
import { TaskDetailSummary } from './TaskDetailSummary'
import { TaskDetailTimelinePanel } from './TaskDetailTimelinePanel'
import { TaskDetailInspectorDrawer } from './TaskDetailInspectorDrawer'
import { TaskHumanInteractionPanel } from './TaskHumanInteractionPanel'
import { TaskResourceHandoff } from './TaskResourceHandoff'
import { TaskPendingActions, type PlanStallItem } from './TaskPendingActions'
import { useTaskPlanStalls } from './useTaskPlanStalls'
import { humanCommandNodeIds } from './taskDomain'
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
    activeTimelineEvents,
    statusTooltip,
    selectedTask,
    submittedNodeUuid,
    submittedLifecycle,
    submitBranch,
  } = controller
  const taskUuid = selectedTask?.taskUuid ?? requestedTaskUuid
  const { backend } = useBackend()
  const ganttAvailable = backend.getCapabilityStatus('scheduler.timePlan').available
  const [view, setView] = useState<'timeline' | 'gantt'>('timeline')
  const planStalls = useTaskPlanStalls(
    taskUuid ?? null,
    ['pending', 'running'].includes(selectedTask?.status ?? ''),
  )
  const stallItems = useMemo<PlanStallItem[]>(() => {
    if (planStalls.length === 0) return []
    const jobByNode = new Map(
      (viewModel?.timeline ?? [])
        .filter((item) => item.currentAttempt !== false)
        .map((item) => [item.workflowNodeUuid, item.jobUuid]),
    )
    const eventById = new Map(controller.timelineEvents.map((event) => [event.id, event]))
    return planStalls.map((stall) => {
      const jobUuid = jobByNode.get(stall.nodeId)
      return {
        nodeId: stall.nodeId,
        reason: stall.reason,
        event: (jobUuid && eventById.get(jobUuid)) || null,
      }
    })
  }, [controller.timelineEvents, planStalls, viewModel?.timeline])
  const humanNodeIds = useMemo(() => humanCommandNodeIds(selectedTask?.raw), [selectedTask?.raw])
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
        task={selectedTask}
        facts={facts}
        currentTimelineEvent={currentTimelineEvent}
        activeEvents={activeTimelineEvents}
        statusTooltip={statusTooltip}
      />
      <TaskResourceHandoff
        task={selectedTask}
        jobs={viewModel?.timeline ?? []}
        stopRequested={controller.stopRequested}
        onChanged={controller.reloadTask}
      />
      <TaskPendingActions
        events={controller.timelineEvents}
        stalls={stallItems}
        onOpen={(id) => controller.openEvent(id)}
      />
      <TaskHumanInteractionPanel
        taskUuid={selectedTask?.taskUuid ?? null}
        timeline={viewModel?.timeline ?? []}
        taskVersion={`${selectedTask?.status ?? ''}:${selectedTask?.updatedAt ?? ''}`}
        humanNodeIds={humanNodeIds}
      />
      {ganttAvailable && (
        <div className={clsx(taskDetailPageStyles['debug-view-switch'])}>
          <Segmented
            value={view}
            onChange={(value) => setView(value as 'timeline' | 'gantt')}
            options={[
              { label: '执行时间线', value: 'timeline' },
              { label: '调度甘特图', value: 'gantt' },
            ]}
          />
        </div>
      )}
      {view === 'gantt' && ganttAvailable ? (
        <section className={clsx(taskDetailPageStyles['debug-gantt'])} aria-label="调度甘特图">
          <ScheduleGantt taskId={taskUuid} />
        </section>
      ) : (
        <TaskDetailTimelinePanel controller={controller} />
      )}
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
