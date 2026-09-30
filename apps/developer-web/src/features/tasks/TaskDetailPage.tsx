import { cx } from './taskDetailClassNames'
import { useEffect, useMemo, useState } from 'react'
import { createWorkflowDebuggingReactStore } from '@unilab-fe/core/react'
import { EmptyState } from '@unilab/design-v2'
import { TaskStatusBadge } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'
import { TaskExecutionTimeline } from './TaskExecutionTimeline'
import { TaskParallelTimelineRow } from './TaskParallelTimelineRow'
import { DebugActionButton, DebugIcon } from './TaskDetailIcons'
import {
  EvidenceTab,
  IssuesTab,
  LocksTab,
  ObservabilityTab,
  ResourcesTab,
} from './TaskDetailInspector'
import { ParallelDrawer } from './TaskParallelDrawer'
import {
  type BranchId,
  type ControlStatus,
  type DebugCommandType,
  type EventStatus,
  type InspectorTab,
  markerGlyph,
  statusLabels,
  tabLabels,
  toTimelineEvent,
} from './taskDetailModel'

export function TaskDetailPage({
  taskUuid: requestedTaskUuid,
  onBack,
}: { taskUuid?: string; onBack?: () => void } = {}) {
  const { backend } = useBackend()
  const debugStore = useMemo(
    () => createWorkflowDebuggingReactStore(backend.core.workflowDebugging),
    [backend.core.workflowDebugging],
  )
  const viewModel = debugStore((state) => state.viewModel)
  const storeCommand = debugStore((state) => state.command)
  const storeError = debugStore((state) => state.error)
  const storeStatus = debugStore((state) => state.status)
  const load = debugStore((state) => state.load)
  const inspectTask = debugStore((state) => state.inspectTask)
  const inspectJob = debugStore((state) => state.inspectJob)
  const sendCommand = debugStore((state) => state.sendCommand)
  const stopRuntimeSubscription = debugStore((state) => state.stopRuntimeSubscription)
  useEffect(() => {
    // Task 详情读取标准 Task presentation；OS 只接受空 view 或 matrix，
    // debug 是前端场景语义，不能作为后端查询参数下发。
    void load({ page: 1, pageSize: 20 })
    return () => stopRuntimeSubscription()
  }, [load, stopRuntimeSubscription])
  useEffect(() => {
    const taskUuid = requestedTaskUuid ?? viewModel?.tasks[0]?.taskUuid
    if (taskUuid && viewModel && !viewModel.selectedTaskUuid) void inspectTask(taskUuid)
  }, [inspectTask, requestedTaskUuid, viewModel])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<InspectorTab>('evidence')
  const [parallelOpen, setParallelOpen] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<BranchId | null>(null)
  const [parallelNotice, setParallelNotice] = useState('等待 OS 返回 ready frontier。')
  const [lastCommandType, setLastCommandType] = useState<DebugCommandType | null>(null)
  const selectedTask = viewModel?.selectedTask ?? null
  // 首轮任务列表和指定 Task 详情是两次读取。列表完成后 selectedTask
  // 仍为空的短窗口也属于 loading，不能把尚未 inspect 的时间线误报为空。
  const timelineLoading =
    !selectedTask &&
    storeStatus !== 'error' &&
    (!viewModel || storeStatus === 'loading' || Boolean(viewModel.tasks.length))
  const facts = viewModel?.facts
  const readyFrontier = facts?.readyFrontier ?? []
  const joins = facts?.joins ?? []
  const timelineEvents = useMemo(
    () => (viewModel?.timeline ?? []).map(toTimelineEvent),
    [viewModel?.timeline],
  )
  const currentTimelineEvent = useMemo(() => {
    const focusedJobUuid = viewModel?.currentFocus?.jobUuid
    if (focusedJobUuid) {
      const focusedEvent = timelineEvents.find((event) => event.id === focusedJobUuid)
      if (focusedEvent) return focusedEvent
    }
    return (
      timelineEvents.find((event) =>
        ['running', 'waiting', 'manual', 'unknown', 'pending'].includes(event.status),
      ) ??
      timelineEvents.at(-1) ??
      null
    )
  }, [timelineEvents, viewModel?.currentFocus?.jobUuid])
  const statusTooltip = useMemo(() => {
    const counts = timelineEvents.reduce<Partial<Record<EventStatus, number>>>((result, event) => {
      result[event.status] = (result[event.status] ?? 0) + 1
      return result
    }, {})
    const summary = (Object.entries(counts) as Array<[EventStatus, number]>)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${statusLabels[status]} ${count}`)
      .join(' · ')
    return summary || '暂无节点状态'
  }, [timelineEvents])
  const selectedEvent = useMemo(
    () => timelineEvents.find((event) => event.id === selectedId) ?? null,
    [selectedId, timelineEvents],
  )
  const submittedNodeUuid = storeCommand?.type === 'step' ? storeCommand.targetNodeUuid : null
  const submittedLifecycle = storeCommand?.type === 'step' ? storeCommand.lifecycle : null
  const controlStatus: ControlStatus =
    selectedTask?.controlStatus === 'active'
      ? 'active'
      : selectedTask?.controlStatus === 'canceling'
        ? 'canceling'
        : 'paused'
  const openEvent = (id: string, tab: InspectorTab = 'evidence') => {
    setSelectedId(id)
    setActiveTab(tab)
    void inspectJob(id)
  }
  const submitCommand = (type: DebugCommandType, targetNodeUuid?: string) => {
    if (!selectedTask) return
    setLastCommandType(type)
    void sendCommand({
      type,
      targetNodeUuid: targetNodeUuid ?? null,
      idempotencyKey: `${selectedTask.taskUuid}:${type}:${Date.now()}`,
    })
  }
  const submitBranch = () => {
    if (!selectedBranch) return
    const candidate = facts?.readyFrontier.find(
      (item) => item.selectable && (item.branchUuid ?? item.nodeUuid) === selectedBranch,
    )
    if (!candidate) {
      setParallelNotice('OS 尚未返回可选择的 ready frontier，不能伪造单步节点。')
      return
    }
    setParallelNotice('正在发送单步命令，等待 Core 返回 accepted/applied 与 NodeJob 状态。')
    submitCommand('step', candidate.nodeUuid)
  }
  const commandLabel =
    lastCommandType === 'step'
      ? '执行下一步'
      : lastCommandType === 'pause'
        ? '暂停任务'
        : lastCommandType === 'resume'
          ? '继续任务'
          : '取消任务'
  const commandResultMessage =
    storeStatus === 'commanding' && lastCommandType
      ? `正在提交“${commandLabel}”命令，等待 Core 返回回执。`
      : storeError && lastCommandType
        ? `“${commandLabel}”命令发送失败：${storeError.message}`
        : storeCommand && lastCommandType
          ? storeCommand.lifecycle === 'accepted'
            ? `“${commandLabel}”命令已接受，等待 OS 更新任务状态。`
            : storeCommand.lifecycle === 'applied'
              ? `“${commandLabel}”命令已生效，任务状态以 OS 回传为准。`
              : storeCommand.lifecycle === 'rejected'
                ? `“${commandLabel}”命令已被拒绝。`
                : `“${commandLabel}”命令回执状态未知，请查看任务状态。`
          : null

  return (
    <main className={cx('debug-page')}>
      <header className={cx('debug-header')}>
        <div className={cx('debug-header-title')}>
          {onBack && (
            <button
              type="button"
              className={cx('debug-back-button')}
              aria-label="返回任务列表"
              onClick={onBack}
            >
              <DebugIcon name="arrow-left" size={19} />
            </button>
          )}
          <h1>{viewModel?.selectedTaskTitle ?? 'Task 详情'}</h1>
        </div>
      </header>
      <section className={cx('debug-summary-grid')} aria-label="任务概览">
        <div className={cx('debug-summary-card')}>
          <span className={cx('debug-summary-icon')} aria-hidden="true">
            <DebugIcon name="bar-chart" size={17} />
          </span>
          <div className={cx('debug-summary-body')}>
            <div className={cx('debug-summary-head')}>
              <span className={cx('debug-summary-metric')}>
                <span className={cx('debug-summary-label')}>进度</span>
                <span className={cx('debug-summary-value')}>
                  {facts?.progress ? `${facts.progress.percent}%` : '—'}
                </span>
              </span>
              <span className={cx('debug-summary-meta')}>
                {facts?.progress
                  ? `${facts.progress.completed} / ${facts.progress.total} 节点`
                  : 'OS 未提供进度'}
              </span>
            </div>
            <div className={cx('debug-summary-line')}>
              <div
                className={cx(
                  `debug-summary-progress-track ${facts?.progress ? '' : 'is-unavailable'}`,
                )}
                role="progressbar"
                aria-label={
                  facts?.progress
                    ? `任务进度 ${facts.progress.percent}%，${facts.progress.completed} / ${facts.progress.total} 节点`
                    : '任务进度未提供'
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={facts?.progress?.percent ?? 0}
                title={
                  facts?.progress
                    ? `${facts.progress.percent}% · ${facts.progress.completed} / ${facts.progress.total} 节点`
                    : 'OS 未提供进度'
                }
              >
                <span style={{ width: `${facts?.progress?.percent ?? 0}%` }} />
              </div>
            </div>
          </div>
        </div>
        <div className={cx('debug-summary-card')}>
          <span className={cx('debug-summary-icon')} aria-hidden="true">
            <DebugIcon name="activity" size={17} />
          </span>
          <div className={cx('debug-summary-body')}>
            <div className={cx('debug-summary-head')}>
              <span className={cx('debug-summary-metric')}>
                <span className={cx('debug-summary-label')}>状态</span>
                <span className={cx('debug-current-status')}>
                  {currentTimelineEvent ? (
                    <TaskStatusBadge status={currentTimelineEvent.status} />
                  ) : (
                    '—'
                  )}
                </span>
              </span>
              <span className={cx('debug-summary-meta')}>{statusTooltip}</span>
            </div>
            <div
              className={cx('debug-summary-line')}
              title={`当前节点：${currentTimelineEvent?.title ?? '—'}；${statusTooltip}`}
            >
              <span className={cx('debug-summary-focus')}>
                <span className={cx('debug-summary-focus-label')}>当前节点</span>
                {currentTimelineEvent?.title ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className={cx('debug-workspace')}>
        <div className={cx('debug-timeline-panel')}>
          <div className={cx('debug-panel-heading')}>
            <div>
              <h2>执行时间线</h2>
            </div>
            <div className={cx('debug-timeline-actions')} aria-label="任务调试操作">
              {controlStatus === 'active' ? (
                <DebugActionButton
                  label="暂停任务"
                  className="debug-timeline-action-pause"
                  disabled={!viewModel?.controls.canPause || storeStatus === 'commanding'}
                  onClick={() => submitCommand('pause')}
                >
                  <DebugIcon name="pause" size={17} />
                </DebugActionButton>
              ) : (
                <DebugActionButton
                  label="继续任务"
                  className="debug-timeline-action-primary"
                  disabled={!viewModel?.controls.canResume || storeStatus === 'commanding'}
                  onClick={() => submitCommand('resume')}
                >
                  <DebugIcon name="play" size={17} />
                </DebugActionButton>
              )}
              <DebugActionButton
                label="执行下一步"
                tooltip={
                  storeStatus === 'commanding'
                    ? '命令提交中，请等待 Core 回执'
                    : viewModel?.controls.canStep
                      ? '执行下一步'
                      : '仅暂停中的单步任务可以执行下一步'
                }
                disabled={!viewModel?.controls.canStep || storeStatus === 'commanding'}
                onClick={() => submitCommand('step')}
              >
                <DebugIcon name="skip-forward" size={17} />
              </DebugActionButton>
              <DebugActionButton
                label="取消任务"
                className="debug-timeline-action-danger"
                disabled={!viewModel?.controls.canCancel || storeStatus === 'commanding'}
                onClick={() => submitCommand('cancel')}
              >
                <DebugIcon name="square" size={16} />
              </DebugActionButton>
            </div>
          </div>
          {commandResultMessage && (
            <div
              className={cx(
                `debug-command-feedback ${storeError || storeCommand?.lifecycle === 'rejected' ? 'is-error' : storeStatus === 'commanding' ? 'is-pending' : 'is-success'}`,
              )}
              role="status"
            >
              <DebugIcon
                name={
                  storeError || storeCommand?.lifecycle === 'rejected'
                    ? 'alert-circle'
                    : storeStatus === 'commanding'
                      ? 'activity'
                      : 'check-circle'
                }
                size={15}
              />
              <span>{commandResultMessage}</span>
            </div>
          )}
          <div className={cx('debug-timeline-list')}>
            {timelineLoading ? (
              <TaskExecutionTimeline items={[]} loading />
            ) : storeError ? (
              <div className={cx('debug-error-line')} role="alert">
                <DebugIcon name="alert-circle" size={15} />
                <span>{storeError.message}</span>
              </div>
            ) : timelineEvents.length === 0 ? (
              <EmptyState
                className={cx('debug-timeline-empty')}
                scene="no-data"
                size="compact"
                title="暂无可展示的 NodeJob"
              />
            ) : (
              <TaskExecutionTimeline
                items={timelineEvents}
                selectedId={selectedId}
                onSelect={(event) => openEvent(event.id)}
                isLast={(_, index) =>
                  readyFrontier.length <= 1 && index === timelineEvents.length - 1
                }
                renderMarker={(event) => (
                  <DebugIcon
                    name={markerGlyph[event.status as EventStatus] ?? markerGlyph.unknown}
                    size={13}
                  />
                )}
              />
            )}
            {readyFrontier.length > 1 && (
              <TaskParallelTimelineRow
                candidates={readyFrontier}
                open={parallelOpen}
                onOpen={() => setParallelOpen(true)}
              />
            )}
          </div>
        </div>
      </section>
      {selectedEvent && (
        <div className={cx('debug-drawer-backdrop')} onClick={() => setSelectedId(null)}>
          <aside
            className={cx('debug-inspector')}
            onClick={(event) => event.stopPropagation()}
            aria-label="节点详情"
          >
            <div className={cx('debug-inspector-head')}>
              <h2>{selectedEvent.title}</h2>
              <button
                type="button"
                className={cx('debug-icon-button')}
                aria-label="关闭详情"
                onClick={() => setSelectedId(null)}
              >
                <DebugIcon name="x" size={18} />
              </button>
            </div>
            <div className={cx('debug-inspector-state')}>
              <TaskStatusBadge status={selectedEvent.status} />
              <span>{selectedEvent.device ?? 'OS NodeJob'}</span>
              <span>{selectedEvent.time}</span>
            </div>
            <nav className={cx('debug-inspector-tabs')} aria-label="节点信息分类">
              {tabLabels.map((tab) => (
                <button
                  type="button"
                  key={tab.id}
                  className={cx(activeTab === tab.id ? 'is-active' : '')}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <DebugIcon name={tab.icon} size={14} /> {tab.label}
                  {tab.id === 'locks' && (
                    <span className={cx('debug-tab-count')}>
                      {facts?.recovery.locks.length ?? 0}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div className={cx('debug-inspector-body')}>
              {activeTab === 'evidence' && (
                <EvidenceTab event={selectedEvent} job={viewModel?.selectedJob ?? null} />
              )}
              {activeTab === 'resources' && (
                <ResourcesTab
                  waits={facts?.resourceWaits ?? []}
                  job={viewModel?.selectedJob ?? null}
                />
              )}
              {activeTab === 'issues' && <IssuesTab event={selectedEvent} />}
              {activeTab === 'locks' && (
                <LocksTab locks={facts?.recovery.locks ?? []} recovery={facts?.recovery} />
              )}
              {activeTab === 'observability' && <ObservabilityTab feedback={viewModel?.feedback} />}
            </div>
          </aside>
        </div>
      )}
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
