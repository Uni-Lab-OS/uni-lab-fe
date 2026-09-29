import { Fragment, useEffect, useMemo, useState } from 'react'
import { createWorkflowDebuggingReactStore } from '@unilab-fe/core/react'
import type { WorkflowReadyFrontierCandidate, WorkflowJoinFact, WorkflowExecutionLockFact, WorkflowResourceWaitFact, WorkflowRecoveryFact, NodeJobFeedbackPage, WorkflowTaskCommandLifecycle } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { AppIcon } from '../../components/ui/Icon'
import '../../styles/task-detail.css'

type EventStatus =
  | 'success'
  | 'running'
  | 'waiting'
  | 'manual'
  | 'unknown'
  | 'pending'
  | 'failed'
  | 'skipped'

type InspectorTab = 'evidence' | 'resources' | 'issues' | 'locks' | 'observability'
type ControlStatus = 'active' | 'paused' | 'canceling'
type BranchId = string

type TimelineEvent = {
  id: string
  time: string
  title: string
  group: string
  description: string
  status: EventStatus
  device?: string
  duration: string
  progress?: number
}

const statusMeta: Record<EventStatus, { label: string; icon: string }> = {
  success: { label: '已完成', icon: 'check-circle' },
  running: { label: '执行中', icon: 'play-circle' },
  waiting: { label: '等待资源', icon: 'clock' },
  manual: { label: '待人工确认', icon: 'user-check' },
  unknown: { label: '结果待核对', icon: 'help-circle' },
  pending: { label: '未到达', icon: 'minus-circle' },
  failed: { label: '失败', icon: 'alert-circle' },
  skipped: { label: '已跳过', icon: 'skip-forward' },
}

const tabLabels: Array<{ id: InspectorTab; label: string; icon: string }> = [
  { id: 'evidence', label: '输入输出', icon: 'file-text' },
  { id: 'resources', label: '资源', icon: 'cube' },
  { id: 'issues', label: '异常处置', icon: 'alert-triangle' },
  { id: 'locks', label: '执行锁', icon: 'lock' },
  { id: 'observability', label: 'Trace / 日志', icon: 'activity' },
]

const iconMap: Record<string, string> = {
  'check-circle': 'general/check-circle', 'play-circle': 'media/play-circle', clock: 'time/clock',
  'user-check': 'users/user-check-01', 'help-circle': 'general/help-circle', 'minus-circle': 'general/minus-circle',
  'alert-circle': 'alerts-feedback/alert-circle', 'alert-triangle': 'alerts-feedback/alert-triangle',
  'skip-forward': 'media/skip-forward', 'chevron-right': 'arrows/chevron-right', 'git-branch': 'development/git-branch-01',
  hash: 'general/hash-01', 'more-horizontal': 'general/dots-horizontal', play: 'media/play', pause: 'media/pause-circle',
  'list-ordered': 'layout/list', square: 'media/stop-circle', info: 'general/info-circle', 'arrow-up-right': 'arrows/arrow-up-right',
  list: 'layout/list',
  activity: 'general/activity', filter: 'general/filter-lines', 'shield-check': 'security/shield-tick', x: 'general/x-close', 'arrow-left': 'arrows/arrow-left',
  'file-text': 'files/file-structure', cube: 'shapes/cube-01', lock: 'security/lock-01', 'layout-grid': 'layout/layout-grid-01',
  check: 'general/check', search: 'general/search-md', 'refresh-cw': 'arrows/refresh-cw-01', 'git-branch-01': 'development/git-branch-01',
  'shield-alert': 'security/shield-zap', unlock: 'security/lock-unlocked-01', 'clipboard-check': 'files/clipboard-check',
  bot: 'shapes/cube-02', flask: 'education/beaker-01', 'map-pin': 'maps/marker-pin-01', scale: 'editor/scale-01',
}

function DebugIcon({ name, size, className }: { name: string; size?: number; className?: string }) {
  return <span className={className}><AppIcon name={(iconMap[name] ?? 'general/info-circle') as never} size={(size === 13 ? 14 : size) as never} color="inherit" /></span>
}

function mapJobStatus(status: string): EventStatus {
  if (status === 'succeeded') return 'success'
  if (status === 'running') return 'running'
  if (status === 'intervention_required') return 'manual'
  if (status === 'execution_unknown') return 'unknown'
  if (status === 'failed' || status === 'timeout') return 'failed'
  if (status === 'canceled') return 'skipped'
  if (status === 'pending') return 'pending'
  return 'waiting'
}

function StatusBadge({ status }: { status: EventStatus }) {
  const meta = statusMeta[status]
  return <span className={`debug-status debug-status-${status}`}><DebugIcon name={meta.icon} size={13} />{meta.label}</span>
}

function ParallelTimelineRow({ open, onOpen, candidates }: { open: boolean; onOpen: () => void; candidates: readonly WorkflowReadyFrontierCandidate[] }) {
  const selectableCount = candidates.filter((candidate) => candidate.selectable).length
  return <button type="button" className={`debug-parallel-row ${open ? 'is-selected' : ''}`} onClick={onOpen}>
    <span className="debug-timeline-event-time">—</span><span className="debug-timeline-marker debug-marker-parallel" aria-hidden="true"><DebugIcon name="git-branch" size={15} /></span>
    <span className="debug-timeline-content">
      <span className="debug-timeline-row-head"><span className="debug-timeline-title">OS 返回的并行候选</span><span className="debug-status debug-status-manual"><DebugIcon name="git-branch" size={13} />待选择</span></span>
      <span className="debug-timeline-meta"><span>{selectableCount} 个可选择节点</span><span>共 {candidates.length} 个候选</span></span>
    </span><DebugIcon name="chevron-right" size={16} className="debug-row-chevron" />
  </button>
}

function TimelineRow({ event, selected, isLast, onSelect }: { event: TimelineEvent; selected: boolean; isLast: boolean; onSelect: () => void }) {
  return <button type="button" className={`debug-timeline-row ${selected ? 'is-selected' : ''} ${isLast ? 'is-last' : ''}`} onClick={onSelect}>
    <span className="debug-timeline-event-time">{event.time}</span><span className={`debug-timeline-marker debug-marker-${event.status}`} aria-hidden="true"><DebugIcon name={statusMeta[event.status].icon} size={15} /></span>
    <span className="debug-timeline-content">
      <span className="debug-timeline-row-head"><span className="debug-timeline-title">{event.title}</span><StatusBadge status={event.status} /></span>
      <span className="debug-timeline-meta"><span>执行设备：{event.device ?? 'OS 未提供'}</span><span>持续时间：{event.duration}</span></span>
      {event.status === 'running' && <span className="debug-inline-progress"><span style={{ width: `${event.progress ?? 0}%` }} /></span>}
    </span><DebugIcon name="chevron-right" size={16} className="debug-row-chevron" />
  </button>
}

function formatTimelineTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTimelineDuration(startedAt: string | null, finishedAt: string | null, status: string): string {
  if (!startedAt) return '时间未提供'
  const start = Date.parse(startedAt)
  const end = finishedAt ? Date.parse(finishedAt) : NaN
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return `${Math.max(1, Math.round((end - start) / 1000))} 秒`
  return ['running', 'dispatched', 'pending'].includes(status) ? '执行中' : '时间未提供'
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

export function TaskDetailPage({ taskUuid: requestedTaskUuid, onBack }: { taskUuid?: string; onBack?: () => void } = {}) {
  const { backend } = useBackend()
  const debugStore = useMemo(() => createWorkflowDebuggingReactStore(backend.core.workflowDebugging), [backend.core.workflowDebugging])
  const viewModel = debugStore((state) => state.viewModel)
  const storeCommand = debugStore((state) => state.command)
  const storeError = debugStore((state) => state.error)
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
  const selectedTask = viewModel?.selectedTask ?? null
  const facts = viewModel?.facts
  const readyFrontier = facts?.readyFrontier ?? []
  const joins = facts?.joins ?? []
  const timelineEvents = useMemo(() => (viewModel?.timeline ?? []).map((job): TimelineEvent => ({
    id: job.jobUuid,
    time: formatTimelineTime(job.startedAt),
    title: job.nodeLabel,
    group: job.executorKind,
    description: Object.keys(job.waitReason).length > 0
      ? String(job.waitReason.reason ?? job.waitReason.message ?? '等待运行时条件')
      : job.errorInfo.length > 0 ? 'OS 返回异常事实' : '',
    status: mapJobStatus(job.status),
    device: job.executorKind,
    duration: formatTimelineDuration(job.startedAt, job.finishedAt, job.status),
  })), [viewModel?.timeline])
  const currentTimelineEvent = useMemo(() => {
    const focusedJobUuid = viewModel?.currentFocus?.jobUuid
    if (focusedJobUuid) {
      const focusedEvent = timelineEvents.find((event) => event.id === focusedJobUuid)
      if (focusedEvent) return focusedEvent
    }
    return timelineEvents.find((event) => ['running', 'waiting', 'manual', 'unknown', 'pending'].includes(event.status))
      ?? timelineEvents.at(-1)
      ?? null
  }, [timelineEvents, viewModel?.currentFocus?.jobUuid])
  const statusTooltip = useMemo(() => {
    const counts = timelineEvents.reduce<Partial<Record<EventStatus, number>>>((result, event) => {
      result[event.status] = (result[event.status] ?? 0) + 1
      return result
    }, {})
    const summary = (Object.entries(counts) as Array<[EventStatus, number]>)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${statusMeta[status].label} ${count}`)
      .join(' · ')
    return summary || '暂无节点状态'
  }, [timelineEvents])
  const selectedEvent = useMemo(() => timelineEvents.find((event) => event.id === selectedId) ?? null, [selectedId, timelineEvents])
  const submittedNodeUuid = storeCommand?.type === 'step' ? storeCommand.targetNodeUuid : null
  const submittedLifecycle = storeCommand?.type === 'step' ? storeCommand.lifecycle : null
  const controlStatus: ControlStatus = selectedTask?.controlStatus === 'active' ? 'active' : selectedTask?.controlStatus === 'canceling' ? 'canceling' : 'paused'
  const openEvent = (id: string, tab: InspectorTab = 'evidence') => { setSelectedId(id); setActiveTab(tab); void inspectJob(id) }
  const submitCommand = (label: string, targetNodeUuid?: string) => {
    if (!selectedTask) return
    const type = label.includes('取消') ? 'cancel' : label.includes('暂停') ? 'pause' : label.includes('继续') ? 'resume' : 'step'
    void sendCommand({ type, targetNodeUuid: targetNodeUuid ?? null, idempotencyKey: `${selectedTask.taskUuid}:${type}:${Date.now()}` })
  }
  const submitBranch = () => {
    if (!selectedBranch) return
    const candidate = facts?.readyFrontier.find((item) => item.selectable && (item.branchUuid ?? item.nodeUuid) === selectedBranch)
    if (!candidate) {
      setParallelNotice('OS 尚未返回可选择的 ready frontier，不能伪造单步节点。')
      return
    }
    setParallelNotice('正在发送单步命令，等待 Core 返回 accepted/applied 与 NodeJob 状态。')
    submitCommand('执行下一步', candidate.nodeUuid)
  }

  return <main className="debug-page">
    <header className="debug-header"><div className="debug-header-title">{onBack && <button type="button" className="debug-back-button" aria-label="返回任务列表" onClick={onBack}><DebugIcon name="arrow-left" size={19} /></button>}<h1>{viewModel?.selectedTaskTitle ?? 'Task 详情'}</h1></div></header>
    <section className="debug-workspace"><div className="debug-timeline-panel"><div className="debug-panel-heading"><div><h2>执行时间线</h2></div><div className="debug-timeline-heading-right"><div className="debug-timeline-summary"><div className="debug-timeline-summary-item debug-timeline-progress" title={facts?.progress ? `${facts.progress.percent}% · ${facts.progress.completed} / ${facts.progress.total} 节点` : 'OS 未提供进度'}><span className="debug-timeline-summary-label">进度</span><div className={`debug-summary-progress-track ${facts?.progress ? '' : 'is-unavailable'}`} role="progressbar" aria-label={facts?.progress ? `任务进度 ${facts.progress.percent}%，${facts.progress.completed} / ${facts.progress.total} 节点` : '任务进度未提供'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={facts?.progress?.percent ?? 0}><span style={{ width: `${facts?.progress?.percent ?? 0}%` }} /></div></div><div className="debug-timeline-summary-item debug-timeline-summary-status" title={`当前节点：${currentTimelineEvent?.title ?? '—'}；${statusTooltip}`}><span className="debug-timeline-summary-label">状态</span><span className="debug-current-status">{currentTimelineEvent ? <StatusBadge status={currentTimelineEvent.status} /> : '—'}</span></div></div><div className="debug-timeline-actions" aria-label="任务调试操作">{controlStatus === 'active' ? <button type="button" className="debug-timeline-action debug-timeline-action-pause" aria-label="暂停任务" title="暂停任务" disabled={!viewModel?.controls.canPause} onClick={() => submitCommand('暂停任务')}><DebugIcon name="pause" size={17} /></button> : <button type="button" className="debug-timeline-action debug-timeline-action-primary" aria-label="继续任务" title="继续任务" disabled={!viewModel?.controls.canResume} onClick={() => submitCommand('继续任务')}><DebugIcon name="play" size={17} /></button>}<button type="button" className="debug-timeline-action" aria-label="进入单步" title="进入单步" disabled={!viewModel?.controls.canStep} onClick={() => submitCommand('进入单步')}><DebugIcon name="skip-forward" size={17} /></button><button type="button" className="debug-timeline-action debug-timeline-action-danger" aria-label="取消任务" title="取消任务" disabled={!viewModel?.controls.canCancel} onClick={() => submitCommand('取消任务')}><DebugIcon name="square" size={16} /></button></div></div></div><div className="debug-timeline-list">{timelineEvents.length === 0 && <div className="debug-empty-state">{storeError?.message ?? '暂无可展示的 NodeJob。'}</div>}{timelineEvents.map((event, index) => <Fragment key={event.id}><TimelineRow event={event} selected={selectedId === event.id} isLast={readyFrontier.length <= 1 && index === timelineEvents.length - 1} onSelect={() => openEvent(event.id)} /></Fragment>)}{readyFrontier.length > 1 && <ParallelTimelineRow candidates={readyFrontier} open={parallelOpen} onOpen={() => setParallelOpen(true)} />}</div></div></section>
    {selectedEvent && <div className="debug-drawer-backdrop" onClick={() => setSelectedId(null)}><aside className="debug-inspector" onClick={(event) => event.stopPropagation()} aria-label="节点详情"><div className="debug-inspector-head"><h2>{selectedEvent.title}</h2><button type="button" className="debug-icon-button" aria-label="关闭详情" onClick={() => setSelectedId(null)}><DebugIcon name="x" size={18} /></button></div><div className="debug-inspector-state"><StatusBadge status={selectedEvent.status} /><span>{selectedEvent.device ?? 'OS NodeJob'}</span><span>{selectedEvent.time}</span></div><nav className="debug-inspector-tabs" aria-label="节点信息分类">{tabLabels.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? 'is-active' : ''} onClick={() => setActiveTab(tab.id)}><DebugIcon name={tab.icon} size={14} /> {tab.label}{tab.id === 'locks' && <span className="debug-tab-count">{facts?.recovery.locks.length ?? 0}</span>}</button>)}</nav><div className="debug-inspector-body">{activeTab === 'evidence' && <EvidenceTab event={selectedEvent} job={viewModel?.selectedJob ?? null} />}{activeTab === 'resources' && <ResourcesTab waits={facts?.resourceWaits ?? []} />}{activeTab === 'issues' && <IssuesTab event={selectedEvent} />}{activeTab === 'locks' && <LocksTab locks={facts?.recovery.locks ?? []} recovery={facts?.recovery} />}{activeTab === 'observability' && <ObservabilityTab feedback={viewModel?.feedback} />}</div></aside></div>}
    {parallelOpen && <ParallelDrawer candidates={facts?.readyFrontier ?? []} joins={facts?.joins ?? []} selectedBranch={selectedBranch} submittedNodeUuid={submittedNodeUuid} submittedLifecycle={submittedLifecycle} notice={parallelNotice} onSelect={setSelectedBranch} onSubmit={submitBranch} onClose={() => setParallelOpen(false)} />}
  </main>
}

function EvidenceTab({ event, job }: { event: TimelineEvent; job: { readonly param: Readonly<Record<string, unknown>>; readonly returnInfo: Readonly<Record<string, unknown>>; readonly attempt: number } | null }) {
  return <div className="debug-tab-content">
    <div className="debug-detail-section">
      <div className="debug-detail-section-head"><h3>运行输入</h3></div>
      <pre className="debug-code-block">{formatJson(job?.param ?? {})}</pre>
    </div>
    <div className="debug-detail-section">
      <div className="debug-detail-section-head"><h3>当前输出</h3></div>
      <pre className="debug-code-block debug-output-block">{formatJson(job?.returnInfo ?? {})}</pre>
      <dl className="debug-output-meta">
        <div><dt>反馈</dt><dd>{event.status === 'success' ? '已返回成功状态' : '尚未形成终态回执'}</dd></div>
        <div><dt>尝试次数</dt><dd>{job?.attempt ?? '—'}</dd></div>
      </dl>
    </div>
  </div>
}

function ResourcesTab({ waits }: { waits: readonly WorkflowResourceWaitFact[] }) { return <div className="debug-tab-content"><div className="debug-resource-summary"><span><DebugIcon name="cube" size={17} /><b>{waits.length}</b> 项等待资源</span></div><div className="debug-resource-list">{waits.length === 0 ? <div className="debug-empty-state debug-resource-empty-state">暂无资源等待或 Site 占用。</div> : waits.map((wait, index) => <ResourceRow key={`${wait.resourceUuid ?? 'resource'}-${index}`} icon="cube" title={wait.resourceUuid ?? '未命名资源'} meta={wait.resourceKind ?? '未知类型'} state={wait.reason ?? '等待'} />)}</div><div className="debug-site-choice"><h3>库位图</h3><button type="button" className="debug-secondary-button" disabled><DebugIcon name="layout-grid" size={15} /> 库位图不可用</button></div></div> }

function IssuesTab({ event }: { event: TimelineEvent }) {
  const intervention = event.status === 'manual'
  const unknown = event.status === 'unknown'
  return <div className="debug-tab-content"><div className={`debug-intervention-card ${intervention ? 'debug-intervention-manual' : unknown ? 'debug-intervention-unknown' : 'debug-intervention-waiting'}`}><div className="debug-intervention-title"><DebugIcon name={intervention ? 'user-check' : unknown ? 'help-circle' : 'info'} size={18} /><div><strong>{intervention ? '需要人工确认' : unknown ? '结果待核对' : event.status === 'waiting' ? '等待资源' : '没有待处理异常'}</strong></div></div>{event.description && <div className="debug-context-box"><span>状态</span><strong>{event.description}</strong></div>}</div></div>
}

function LocksTab({ locks, recovery }: { locks: readonly WorkflowExecutionLockFact[]; recovery?: WorkflowRecoveryFact }) { const canRelease = locks.length > 0 && locks.every((lock) => lock.canRelease === true) && !recovery?.requiresReconciliation; return <div className="debug-tab-content"><div className={`debug-lock-guard ${canRelease ? 'is-ready' : ''}`}><div className="debug-lock-guard-head"><DebugIcon name={canRelease ? 'unlock' : 'shield-alert'} size={18} /><div><strong>{canRelease ? '可释放执行锁' : '当前不可直接释放执行锁'}</strong></div></div></div><div className="debug-lock-group">{locks.length === 0 ? <div className="debug-empty-state debug-lock-empty-state">暂无执行锁快照。</div> : locks.map((lock, index) => <LockRow key={`${lock.lockUuid ?? 'lock'}-${index}`} title={lock.lockKey ?? lock.lockUuid ?? '未命名锁'} scope={lock.scope ?? '未知范围'} state={lock.state === 'uncertain' ? '状态不明' : lock.canRelease === true ? '可释放' : lock.state} />)}</div><div className="debug-lock-actions"><button type="button" className="debug-danger-outline-button" disabled><DebugIcon name="unlock" size={15} /> 人工解除整组锁</button></div></div> }

function ObservabilityTab({ feedback }: { feedback: NodeJobFeedbackPage | null | undefined }) { return <div className="debug-tab-content"><div className="debug-trace-banner"><span className="debug-trace-id">Trace / feedback</span><span>{feedback?.items.length ?? 0} 条反馈</span></div><div className="debug-observe-section"><div className="debug-detail-section-head"><h3>反馈事件</h3></div><div className="debug-event-log">{feedback?.items.length ? feedback.items.map((item) => <span key={item.feedbackUuid}><b>#{item.sequence}</b><em>{item.feedbackType}</em><small>{item.description ?? JSON.stringify(item.data)}</small></span>) : <span><small>暂无反馈事件。</small></span>}</div></div></div> }

function ResourceRow({ icon, title, meta, state }: { icon: string; title: string; meta: string; state: string }) { return <div className="debug-resource-row"><span className="debug-resource-icon"><DebugIcon name={icon} size={16} /></span><span><strong>{title}</strong><small>{meta}</small></span><em>{state}</em></div> }
function LockRow({ title, scope, state }: { title: string; scope: string; state: string }) { return <div className="debug-lock-row"><span><strong>{title}</strong><small>{scope}</small></span><span className={state === '可释放' ? 'lock-ready' : state === '状态不明' ? 'lock-unknown' : 'lock-held'}><span className="debug-state-dot" />{state}</span></div> }
function ParallelDrawer({ candidates, joins, selectedBranch, submittedNodeUuid, submittedLifecycle, notice, onSelect, onSubmit, onClose }: { candidates: readonly WorkflowReadyFrontierCandidate[]; joins: readonly WorkflowJoinFact[]; selectedBranch: BranchId | null; submittedNodeUuid: string | null; submittedLifecycle: WorkflowTaskCommandLifecycle | null; notice: string; onSelect: (branch: BranchId) => void; onSubmit: () => void; onClose: () => void }) {
  const branchCard = (candidate: WorkflowReadyFrontierCandidate) => {
    const id = candidate.branchUuid ?? candidate.nodeUuid
    const selected = selectedBranch === id
    const submitted = submittedNodeUuid === candidate.nodeUuid
    const lifecycleLabel = submittedLifecycle === 'accepted' ? '命令已接受' : submittedLifecycle === 'applied' ? '命令已生效' : submittedLifecycle === 'rejected' ? '命令已拒绝' : '命令状态未知'
    return <button type="button" className={`debug-branch-card ${selected ? 'is-selected' : ''} ${submitted ? 'is-submitted' : ''}`} onClick={() => onSelect(id)}>
      <span className="debug-branch-card-icon"><DebugIcon name="git-branch" size={18} /></span>
      <span className="debug-branch-card-body"><span className="debug-branch-card-head"><strong>{candidate.label ?? candidate.nodeUuid}</strong><span className={`debug-branch-state ${submitted ? 'is-submitted' : candidate.selectable ? 'is-ready' : 'is-blocked'}`}>{submitted ? lifecycleLabel : candidate.selectable ? '可选择' : '不可选择'}</span></span><span className="debug-branch-node">node {candidate.nodeUuid}</span><span className="debug-branch-detail">{candidate.blockedBy.join(' · ') || candidate.waitReason.reason?.toString() || 'OS 未提供阻塞原因'}</span></span>
      <span className="debug-branch-card-check">{selected ? <DebugIcon name="check-circle" size={18} /> : <span className="debug-radio" />}</span>
    </button>
  }
  const join = joins[0]
  return <div className="debug-drawer-backdrop" onClick={onClose}><aside className="debug-parallel-drawer" onClick={(event) => event.stopPropagation()} aria-label="并行分支选择"><div className="debug-inspector-head"><h2>选择分支</h2><button type="button" className="debug-icon-button" aria-label="关闭并行分支" onClick={onClose}><DebugIcon name="x" size={18} /></button></div><div className="debug-parallel-summary"><span><DebugIcon name="git-branch" size={16} /> {candidates.length} 个候选</span><span><b>{candidates.filter((candidate) => candidate.selectable).length}</b> 个可选择</span><span className="debug-parallel-join"><DebugIcon name="lock" size={14} /> {join?.ready ? 'Join 已满足' : 'Join 等待前置条件'}</span></div><div className="debug-parallel-body"><div className="debug-parallel-section"><div className="debug-detail-section-head"><h3>选择下一步</h3></div><div className="debug-branch-list">{candidates.map((candidate) => <Fragment key={candidate.nodeUuid}>{branchCard(candidate)}</Fragment>)}</div><div className="debug-selection-note"><DebugIcon name="info" size={15} /><span>{notice}</span></div><button type="button" className="debug-primary-button debug-submit-branch" disabled={!selectedBranch || !candidates.some((candidate) => (candidate.branchUuid ?? candidate.nodeUuid) === selectedBranch && candidate.selectable)} onClick={onSubmit}><DebugIcon name="skip-forward" size={16} /> 执行选中节点</button></div><div className="debug-parallel-section"><div className="debug-detail-section-head"><h3>汇合条件</h3></div><div className="debug-join-checks">{join ? <>{join.requiredBranchUuids.map((branch) => <span key={branch}><DebugIcon name={join.satisfiedBranchUuids.includes(branch) ? 'check-circle' : 'minus-circle'} size={15} /> {branch}</span>)}{join.missingConditions.map((condition) => <span key={condition}><DebugIcon name="minus-circle" size={15} /> {condition}</span>)}</> : <span><DebugIcon name="info" size={15} /> 未提供 Join 准入事实</span>}</div></div></div></aside></div>
}
