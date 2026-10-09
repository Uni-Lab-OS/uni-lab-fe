import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { TaskStatusBadge } from '@unilab/lab-ui'
import { DebugIcon } from './TaskDetailIcons'
import {
  EvidenceTab,
  IssuesTab,
  LocksTab,
  ObservabilityTab,
  ResourcesTab,
} from './TaskDetailInspector'
import { tabLabels } from './taskDetailModel'
import type { useTaskDetailController } from './useTaskDetailController'

type Controller = ReturnType<typeof useTaskDetailController>

export function TaskDetailInspectorDrawer({ controller }: { controller: Controller }) {
  const { selectedEvent, setSelectedId, activeTab, setActiveTab, facts, viewModel } = controller
  if (!selectedEvent) return null
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
          <TaskStatusBadge status={selectedEvent.status} />
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
              onClick={() => setActiveTab(tab.id)}
            >
              <DebugIcon name={tab.icon} size={14} /> {tab.label}
              {tab.id === 'locks' && (
                <span className={clsx(taskDetailInspectorStyles['debug-tab-count'])}>
                  {facts?.recovery.locks.length ?? 0}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className={clsx(taskDetailInspectorStyles['debug-inspector-body'])}>
          {activeTab === 'evidence' && (
            <EvidenceTab event={selectedEvent} job={viewModel?.selectedJob ?? null} />
          )}
          {activeTab === 'resources' && (
            <ResourcesTab waits={facts?.resourceWaits ?? []} job={viewModel?.selectedJob ?? null} />
          )}
          {activeTab === 'issues' && <IssuesTab event={selectedEvent} />}
          {activeTab === 'locks' && (
            <LocksTab locks={facts?.recovery.locks ?? []} recovery={facts?.recovery} />
          )}
          {activeTab === 'observability' && <ObservabilityTab feedback={viewModel?.feedback} />}
        </div>
      </aside>
    </div>
  )
}
