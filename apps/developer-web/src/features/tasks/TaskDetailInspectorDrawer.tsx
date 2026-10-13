import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { StatusBadge } from '@unilab/lab-ui'
import { DebugIcon } from './TaskDetailIcons'
import {
  EvidenceTab,
  IssuesTab,
  LocksTab,
  ObservabilityTab,
  ResourcesTab,
} from './TaskDetailInspector'
import { ManualConfirmationActions } from './TaskDetailManualConfirmation'
import { tabLabels } from './taskDetailModel'
import { useStationHandling } from '../station-handling/StationHandlingProvider'
import { stationErrorForJob } from '../station-handling/stationHandlingPresentation'
import type { useTaskDetailController } from './useTaskDetailController'

type Controller = ReturnType<typeof useTaskDetailController>

export function TaskDetailInspectorDrawer({ controller }: { controller: Controller }) {
  const {
    selectedEvent,
    setSelectedId,
    activeTab,
    setActiveTab,
    facts,
    viewModel,
    decideManualConfirmation,
    // 执行锁是按任务作用域读的，不是按节点；整组解锁成功后还要重读任务详情。
    taskUuid,
    reloadSelectedTask,
  } = controller
  // 标签上的红点必须和面板里的结论同源：同一个 OS 错误事实谓词 + 节点自身的失败状态。
  const { snapshot } = useStationHandling()
  if (!selectedEvent) return null
  const issuesAttention =
    selectedEvent.status === 'failed' || stationErrorForJob(snapshot, selectedEvent.id) !== null
  const selectedJob =
    viewModel?.selectedJobUuid === selectedEvent.id ? (viewModel.selectedJob ?? null) : null
  return (
    <div
      className={clsx(taskDetailStyles['debug-drawer-backdrop'])}
      onClick={() => setSelectedId(null)}
    >
      <aside
        className={clsx(taskDetailInspectorStyles['debug-inspector'])}
        onClick={(event) => event.stopPropagation()}
        aria-label="节点详情"
      >
        <div className={clsx(taskDetailStyles['debug-inspector-head'])}>
          <h2>{selectedEvent.title}</h2>
          <button
            type="button"
            className={clsx(taskDetailStyles['debug-icon-button'])}
            aria-label="关闭详情"
            onClick={() => setSelectedId(null)}
          >
            <DebugIcon name="x" size={18} />
          </button>
        </div>
        <div className={clsx(taskDetailInspectorStyles['debug-inspector-state'])}>
          <StatusBadge status={selectedEvent.status} />
          <span>{selectedEvent.device ?? 'OS NodeJob'}</span>
          <span>{selectedEvent.time}</span>
        </div>
        <nav
          className={clsx(taskDetailInspectorStyles['debug-inspector-tabs'])}
          aria-label="节点信息分类"
        >
          {tabLabels.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={clsx(
                activeTab === tab.id ? clsx(taskDetailInspectorStyles['is-active']) : '',
              )}
              title={
                tab.id === 'issues' && issuesAttention ? '这个节点存在待处置的异常' : undefined
              }
              data-alert={tab.id === 'issues' && issuesAttention ? 'true' : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              <DebugIcon name={tab.icon} size={14} /> {tab.label}
              {tab.id === 'issues' && issuesAttention && (
                <span
                  className={clsx(taskDetailInspectorStyles['debug-tab-alert'])}
                  aria-hidden="true"
                />
              )}
              {/*
                这里**不再**显示来自任务详情投影的锁数量角标：那份数据常常是空的，
                角标会固定在 0，而面板里读的是专用锁快照端点，两处对不上就是新的谎。
                真实数量由面板自己按快照渲染，标签上不再重复一个不可信的计数。
              */}
            </button>
          ))}
        </nav>
        <ManualConfirmationActions job={selectedJob} onDecide={decideManualConfirmation} />
        <div className={clsx(taskDetailInspectorStyles['debug-inspector-body'])}>
          {activeTab === 'evidence' && <EvidenceTab event={selectedEvent} job={selectedJob} />}
          {activeTab === 'resources' && (
            <ResourcesTab waits={facts?.resourceWaits ?? []} job={selectedJob} />
          )}
          {activeTab === 'issues' && (
            <IssuesTab
              event={selectedEvent}
              job={selectedJob}
              taskStatus={viewModel?.selectedTask?.status ?? null}
            />
          )}
          {activeTab === 'locks' && (
            <LocksTab
              taskUuid={taskUuid}
              cleanupStatus={viewModel?.selectedTask?.cleanupStatus ?? null}
              onReloadTaskDetail={reloadSelectedTask}
            />
          )}
          {activeTab === 'observability' && (
            <ObservabilityTab
              feedback={
                viewModel?.selectedJobUuid === selectedEvent.id ? viewModel?.feedback : null
              }
            />
          )}
        </div>
      </aside>
    </div>
  )
}
