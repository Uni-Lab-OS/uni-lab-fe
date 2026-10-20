import { clsx } from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Segmented } from 'antd'
import { openBarInTasks, ScheduleGantt } from '../schedule/SchedulePage'
import type { GanttBar } from '../schedule/scheduleGanttModel'
import { detailNodeFacts } from '../schedule/scheduleNodeFacts'
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
import { findTimelineJob } from './taskDetailModel'
import { DebugIcon } from './TaskDetailIcons'
import { ParallelDrawer } from './TaskParallelDrawer'
import { useTaskDetailController } from './useTaskDetailController'

/** 进入详情后要定位的节点（来自调度甘特图）；有作业身份时优先定位该次作业。 */
export interface TaskDetailFocus {
  readonly nodeUuid?: string | null
  readonly jobUuid?: string | null
}

export function TaskDetailPage({
  taskUuid: requestedTaskUuid,
  onBack,
  focus,
}: { taskUuid?: string; onBack?: () => void; focus?: TaskDetailFocus } = {}) {
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
  // 本任务的节点名与作业事实已随详情读到，甘特图直接复用，不再为标签另行请求。
  const ganttFacts = useMemo(
    () =>
      taskUuid && viewModel?.selectedTaskUuid === taskUuid
        ? detailNodeFacts(taskUuid, viewModel.timeline, viewModel.selectedJobs)
        : undefined,
    [taskUuid, viewModel?.selectedJobs, viewModel?.selectedTaskUuid, viewModel?.timeline],
  )

  const findJob = useCallback(
    (target: TaskDetailFocus) => findTimelineJob(viewModel?.timeline ?? [], target),
    [viewModel?.timeline],
  )
  // openEvent 每次渲染重建；经 ref 调用，让甘特图回调保持稳定、聚焦只在数据就绪时触发一次。
  const openEventRef = useRef(controller.openEvent)
  openEventRef.current = controller.openEvent
  const pendingFocus = useRef(focus)
  useEffect(() => {
    const target = pendingFocus.current
    if (!target || !taskUuid || viewModel?.selectedTaskUuid !== taskUuid) return
    const job = findJob(target)
    if (!job) return
    pendingFocus.current = undefined
    openEventRef.current(job.jobUuid)
  }, [findJob, taskUuid, viewModel?.selectedTaskUuid])
  const openGanttBar = useCallback(
    (bar: GanttBar) => {
      const job =
        bar.taskId === taskUuid ? findJob({ jobUuid: bar.jobId, nodeUuid: bar.nodeId }) : null
      if (job) openEventRef.current(job.jobUuid)
      else openBarInTasks(bar)
    },
    [findJob, taskUuid],
  )
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
          <ScheduleGantt taskId={taskUuid} onOpenBar={openGanttBar} focusFacts={ganttFacts} />
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
