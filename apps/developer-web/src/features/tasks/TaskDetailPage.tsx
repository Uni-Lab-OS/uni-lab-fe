import { clsx } from 'clsx'
import taskDetailPageStyles from './TaskDetailPage.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { TaskDetailSummary } from './TaskDetailSummary'
import { TaskDetailTimelinePanel } from './TaskDetailTimelinePanel'
import { TaskDetailInspectorDrawer } from './TaskDetailInspectorDrawer'
import { DebugIcon } from './TaskDetailIcons'
import {
  EvidenceTab,
  IssuesTab,
  LocksTab,
  ObservabilityTab,
  ResourcesTab,
} from './TaskDetailInspector'
import { ParallelDrawer } from './TaskParallelDrawer'
import { useTaskDetailController } from './useTaskDetailController'
import { type EventStatus, markerGlyph, tabLabels } from './taskDetailModel'

export function TaskDetailPage({
  taskUuid: requestedTaskUuid,
  onBack,
}: { taskUuid?: string; onBack?: () => void } = {}) {
  const controller = useTaskDetailController(requestedTaskUuid)
  const {
    viewModel,
    storeCommand,
    storeError,
    storeStatus,
    inspectJob,
    selectedId,
    setSelectedId,
    activeTab,
    setActiveTab,
    parallelOpen,
    setParallelOpen,
    selectedBranch,
    setSelectedBranch,
    parallelNotice,
    facts,
    joins,
    readyFrontier,
    timelineEvents,
    currentTimelineEvent,
    statusTooltip,
    selectedEvent,
    submittedNodeUuid,
    submittedLifecycle,
    controlStatus,
    timelineLoading,
    commandResultMessage,
    openEvent,
    submitCommand,
    submitBranch,
  } = controller
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
          <h1>{viewModel?.selectedTaskTitle ?? 'Task 详情'}</h1>
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
