import type {
  ManualConfirmationAction,
  WorkflowDebugTimelineItem,
  WorkflowNodeJobDetail,
  WorkflowResourceWaitFact,
} from '@unilab-fe/core'

export type EventStatus =
  | 'success'
  | 'running'
  | 'waiting'
  | 'manual'
  | 'unknown'
  | 'pending'
  | 'failed'
  | 'skipped'
  | 'canceled'

export type InspectorTab = 'evidence' | 'resources' | 'issues' | 'locks' | 'observability'
export type ControlStatus = 'active' | 'paused' | 'canceling'
export type BranchId = string
export type DebugCommandType = 'step' | 'pause' | 'resume' | 'cancel'

export interface TimelineEvent {
  readonly id: string
  readonly time: string
  readonly title: string
  readonly group: string
  readonly description: string
  readonly status: EventStatus
  readonly device?: string
  readonly duration: string
  readonly progress?: number
  /** 服务端时间排序键：开始时间，缺失时用结束时间；都没有则为 null（显示“未开始”）。 */
  readonly sortTime?: number | null
  readonly topologicalIndex?: number
  readonly attempt?: number
  /** false 表示已被重试替代的历史 attempt。 */
  readonly currentAttempt?: boolean
}

/**
 * 正在进行或等待处置的状态：执行中、等待资源/派发、待人工确认、结果待核对。
 * 时间线置顶、概览“当前节点”都以此为准，不另立一套词表。
 */
export const ACTIVE_EVENT_STATUSES: readonly EventStatus[] = [
  'running',
  'waiting',
  'manual',
  'unknown',
]

/** 当前 attempt 且处于进行中/待处置状态；已被重试替代的历史 attempt 不算。 */
export function isActiveTimelineEvent(event: TimelineEvent): boolean {
  return event.currentAttempt !== false && ACTIVE_EVENT_STATUSES.includes(event.status)
}

export const markerGlyph: Record<EventStatus, string> = {
  success: 'check',
  running: 'play',
  waiting: 'clock',
  manual: 'user-check',
  unknown: 'help',
  pending: 'minus',
  failed: 'alert-triangle',
  skipped: 'skip-forward',
  canceled: 'slash',
}

export const statusLabels: Record<EventStatus, string> = {
  success: '已完成',
  running: '执行中',
  waiting: '等待资源',
  manual: '待人工确认',
  unknown: '结果待核对',
  pending: '未到达',
  failed: '失败',
  skipped: '已跳过（分支未选中）',
  canceled: '已取消（未执行）',
}

export const tabLabels: Array<{ id: InspectorTab; label: string; icon: string }> = [
  { id: 'evidence', label: '输入输出', icon: 'file-text' },
  { id: 'resources', label: '资源', icon: 'cube' },
  { id: 'issues', label: '异常处置', icon: 'alert-triangle' },
  { id: 'locks', label: '执行锁', icon: 'lock' },
  { id: 'observability', label: 'Trace / 日志', icon: 'activity' },
]

export function mapJobStatus(status: string): EventStatus {
  if (status === 'succeeded') return 'success'
  if (status === 'running') return 'running'
  if (status === 'intervention_required') return 'manual'
  if (status === 'execution_unknown') return 'unknown'
  if (status === 'failed' || status === 'timeout') return 'failed'
  // 取消（因任务取消未执行）与跳过（条件分支未选中）语义不同，分开呈现。
  if (status === 'canceled' || status === 'cancelled') return 'canceled'
  if (status === 'skipped') return 'skipped'
  if (status === 'pending') return 'pending'
  return 'waiting'
}

export function formatTimelineTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatTimelineDuration(
  startedAt: string | null,
  finishedAt: string | null,
  status: string,
): string {
  if (!startedAt) return '时间未提供'
  const start = Date.parse(startedAt)
  const end = finishedAt ? Date.parse(finishedAt) : NaN
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start)
    return `${Math.max(1, Math.round((end - start) / 1000))} 秒`
  return ['running', 'dispatched', 'pending'].includes(status) ? '执行中' : '时间未提供'
}

export function toTimelineEvent(job: WorkflowDebugTimelineItem): TimelineEvent {
  if (job.uncertaintyReason && (job.status === 'running' || job.status === 'failed')) {
    // OS 保持占用、等待物理对账：不能显示成“执行中”或普通失败。
    return {
      id: job.jobUuid,
      time: timelineTimeLabel(job),
      title: job.nodeLabel,
      group: job.executorKind,
      description: `结果未知，需现场核对后处置：${job.uncertaintyReason}`,
      status: 'unknown',
      device: timelineDevice(job),
      duration: formatTimelineDuration(job.startedAt, job.finishedAt, job.status),
      ...timelineOrder(job),
    }
  }
  return {
    id: job.jobUuid,
    time: timelineTimeLabel(job),
    title: job.nodeLabel,
    group: job.executorKind,
    description:
      Object.keys(job.waitReason).length > 0
        ? String(job.waitReason.reason ?? job.waitReason.message ?? '等待运行时条件')
        : job.errorInfo.length > 0
          ? 'OS 返回异常事实'
          : '',
    // 人工确认节点的 running 表示在等人批准，设备尚未动作；pending 且带 OS 等待原因
    // （如库位被占用、资源等待）表示已就绪但在等资源，不是“未到达”。
    status:
      job.executorKind === 'manual_confirm' && job.status === 'running'
        ? 'manual'
        : job.status === 'pending' && Object.keys(job.waitReason).length > 0
          ? 'waiting'
          : mapJobStatus(job.status),
    device: timelineDevice(job),
    duration: formatTimelineDuration(job.startedAt, job.finishedAt, job.status),
    ...timelineOrder(job),
  }
}

const EXECUTOR_LABELS: Readonly<Record<string, string>> = {
  manual_confirm: '人工确认',
  material_source: '物料来源',
  workflow_input: '工作流输入',
  workflow_output: '工作流输出',
  human_command: '人工交互',
}

/**
 * 设备动作显示实际执行设备；人工确认等非设备类别显示类别名，若绑定了设备一并显示
 * （如“人工确认 · robot”：批准后由该设备执行）。
 */
function timelineDevice(job: WorkflowDebugTimelineItem): string {
  const kind = EXECUTOR_LABELS[job.executorKind]
  if (!kind) return job.deviceId ?? job.executorKind
  return job.deviceId ? `${kind} · ${job.deviceId}` : kind
}

function timelineTimeLabel(job: WorkflowDebugTimelineItem): string {
  if (job.startedAt) return formatTimelineTime(job.startedAt)
  if (job.finishedAt) return formatTimelineTime(job.finishedAt)
  return '未开始'
}

function timelineOrder(job: WorkflowDebugTimelineItem) {
  const parse = (value: string | null | undefined) => {
    const time = value ? Date.parse(value) : Number.NaN
    return Number.isFinite(time) ? time : null
  }
  return {
    sortTime: parse(job.startedAt) ?? parse(job.finishedAt),
    topologicalIndex: job.topologicalIndex,
    attempt: job.attempt,
    currentAttempt: job.currentAttempt !== false,
  }
}

export type TimelineOrder = 'time' | 'steps'

/**
 * 时间视图中的分段（按出现顺序）：进行中（置顶）→ 已发生（最近在前）→ 未开始（按步骤）。
 * `start` 是该段第一项在 `items` 中的下标；步骤视图不分段。
 */
export interface TimelineSection {
  readonly kind: 'active' | 'history' | 'unstarted'
  readonly start: number
  readonly count: number
}

export interface ArrangedTimeline {
  readonly items: readonly TimelineEvent[]
  readonly sections: readonly TimelineSection[]
  /** 默认折叠的未执行节点（取消、跳过、未到达）计数。 */
  readonly collapsed: {
    readonly canceled: number
    readonly skipped: number
    readonly pending: number
  }
  readonly historical: number
}

const UNEXECUTED: readonly EventStatus[] = ['canceled', 'skipped', 'pending']

/**
 * 整理时间线：
 * - time：当前正在进行或等待处置的节点（见 ACTIVE_EVENT_STATUSES）置顶；其余已发生的节点按
 *   服务端开始时间（缺失用结束时间）倒序，最近发生的在前；没有时间的节点（显示“未开始”）
 *   放在最后并按步骤顺序。同一时间按步骤倒序，重试 attempt 总在原 attempt 之上。
 * - steps：按步骤（拓扑）顺序，仅用于理解 DAG 结构，不表示先后，也不置顶：
 *   置顶会打乱 DAG 结构顺序，当前节点在该视图中由状态标签区分。
 * 未执行节点与历史 attempt 默认折叠，避免几千个取消节点淹没真正执行过的节点。
 */
export function arrangeTimeline(
  events: readonly TimelineEvent[],
  options: { order: TimelineOrder; showUnexecuted: boolean; showHistory: boolean },
): ArrangedTimeline {
  const collapsed = { canceled: 0, skipped: 0, pending: 0 }
  let historical = 0
  const visible = events.filter((event) => {
    if (event.currentAttempt === false) {
      historical += 1
      if (!options.showHistory) return false
    }
    if (UNEXECUTED.includes(event.status) && event.sortTime == null) {
      collapsed[event.status as keyof typeof collapsed] += 1
      return options.showUnexecuted
    }
    return true
  })
  const byStep = (a: TimelineEvent, b: TimelineEvent) =>
    (a.topologicalIndex ?? 0) - (b.topologicalIndex ?? 0) || (a.attempt ?? 0) - (b.attempt ?? 0)
  if (options.order === 'steps')
    return { items: [...visible].sort(byStep), sections: [], collapsed, historical }

  // 最近在前；没有时间的排在有时间的之后，彼此按步骤顺序。
  const recentFirst = (a: TimelineEvent, b: TimelineEvent) => {
    if (a.sortTime != null && b.sortTime != null) return b.sortTime - a.sortTime || byStep(b, a)
    if (a.sortTime != null) return -1
    if (b.sortTime != null) return 1
    return byStep(a, b)
  }
  const active = visible.filter(isActiveTimelineEvent).sort(recentFirst)
  const rest = visible.filter((event) => !isActiveTimelineEvent(event))
  const history = rest.filter((event) => event.sortTime != null).sort(recentFirst)
  const unstarted = rest.filter((event) => event.sortTime == null).sort(byStep)
  const sections: TimelineSection[] = []
  let start = 0
  for (const [kind, group] of [
    ['active', active],
    ['history', history],
    ['unstarted', unstarted],
  ] as const) {
    if (group.length > 0) sections.push({ kind, start, count: group.length })
    start += group.length
  }
  return { items: [...active, ...history, ...unstarted], sections, collapsed, historical }
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

function asReadonlyRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

export interface ManualConfirmationView {
  readonly status: string
  readonly deadlineAt: string | null
  readonly actions: readonly ManualConfirmationAction[]
}

/** Read only the explicit OS projection; malformed or absent data fails closed. */
export function readManualConfirmation(
  job: WorkflowNodeJobDetail | null,
): ManualConfirmationView | null {
  const raw = asReadonlyRecord(job?.raw.manual_confirmation ?? job?.controlData.manual_confirmation)
  if (!raw || typeof raw.status !== 'string') return null
  const actions = Array.isArray(raw.actions)
    ? raw.actions.filter(
        (action): action is ManualConfirmationAction => action === 'approve' || action === 'reject',
      )
    : []
  return {
    status: raw.status,
    deadlineAt: typeof raw.deadline_at === 'string' ? raw.deadline_at : null,
    actions,
  }
}

/**
 * NodeJob 详情的规范化字段目前不包含 expected_change_set；详情接口仍会
 * 将它保留在 raw 或 dispatch_payload 中。读取时必须兼容两种投影，并把缺失
 * 或异常形状视为“OS 未提供”，不能让检查面板因为展示字段白屏。
 */
function readExpectedChangeSet(
  job: WorkflowNodeJobDetail | null,
): Readonly<Record<string, unknown>> | null {
  const dispatchPayload = asReadonlyRecord(job?.controlData.dispatch_payload)
  return asReadonlyRecord(
    job?.raw?.expected_change_set ??
      job?.raw?.expectedChangeSet ??
      dispatchPayload?.expected_change_set ??
      dispatchPayload?.expectedChangeSet,
  )
}

export function readExpectedChangeSetKind(job: WorkflowNodeJobDetail | null): string | null {
  const kind = readExpectedChangeSet(job)?.kind
  return typeof kind === 'string' ? kind : null
}

function hasStringField(
  record: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): boolean {
  return keys.some((key) => typeof record?.[key] === 'string' && record[key].trim().length > 0)
}

/** 只有 OS 明确返回 Site 事实时才显示库位区，不能从动作名或设备名猜库位。 */
export function hasWorkflowSiteFact(
  job: WorkflowNodeJobDetail | null,
  waits: readonly WorkflowResourceWaitFact[],
): boolean {
  const changeSet = readExpectedChangeSet(job)
  const selection = asReadonlyRecord(changeSet?.site_selection ?? changeSet?.siteSelection)
  const changeSetHasSite =
    hasStringField(changeSet, [
      'site_uuid',
      'siteUuid',
      'source_site_uuid',
      'sourceSiteUuid',
      'target_site_uuid',
      'targetSiteUuid',
      'gripper_site_uuid',
      'gripperSiteUuid',
    ]) ||
    hasStringField(selection, ['selected_site_uuid', 'selectedSiteUuid']) ||
    (Array.isArray(selection?.site_uuids) &&
      selection.site_uuids.some((value) => typeof value === 'string' && value.trim().length > 0)) ||
    (Array.isArray(selection?.siteUuids) &&
      selection.siteUuids.some((value) => typeof value === 'string' && value.trim().length > 0))
  if (changeSetHasSite) return true

  return waits.some((wait) => {
    const resourceKind = wait.resourceKind?.trim().toLowerCase()
    return (
      resourceKind === 'site' ||
      hasStringField(wait.raw, [
        'site_uuid',
        'siteUuid',
        'source_site_uuid',
        'sourceSiteUuid',
        'target_site_uuid',
        'targetSiteUuid',
      ])
    )
  })
}

/**
 * 调度甘特图条带对应的作业：优先按调度器作业身份匹配（重试后的旧尝试也能定位），
 * 否则取该节点当前尝试的作业；都没有时返回 null（例如计划节点尚未生成作业）。
 */
export function findTimelineJob(
  timeline: readonly WorkflowDebugTimelineItem[],
  target: { readonly jobUuid?: string | null; readonly nodeUuid?: string | null },
): WorkflowDebugTimelineItem | null {
  if (target.jobUuid) {
    const job = timeline.find((item) => item.jobUuid === target.jobUuid)
    if (job) return job
  }
  if (!target.nodeUuid) return null
  return (
    timeline.find(
      (item) => item.workflowNodeUuid === target.nodeUuid && item.currentAttempt !== false,
    ) ?? null
  )
}
