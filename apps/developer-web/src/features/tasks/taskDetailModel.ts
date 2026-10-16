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
      device: job.executorKind,
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
    // 人工确认节点的 running 表示在等人批准，设备尚未动作。
    status:
      job.executorKind === 'manual_confirm' && job.status === 'running' ? 'manual' : mapJobStatus(job.status),
    device: job.executorKind,
    duration: formatTimelineDuration(job.startedAt, job.finishedAt, job.status),
    ...timelineOrder(job),
  }
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

export interface ArrangedTimeline {
  readonly items: readonly TimelineEvent[]
  /** 默认折叠的未执行节点（取消、跳过、未到达）计数。 */
  readonly collapsed: { readonly canceled: number; readonly skipped: number; readonly pending: number }
  readonly historical: number
}

const UNEXECUTED: readonly EventStatus[] = ['canceled', 'skipped', 'pending']

/**
 * 整理时间线：
 * - time：按服务端开始时间（缺失用结束时间）排序；没有时间的节点排在后面并显示“未开始”，
 *   同一时间按拓扑序稳定排序。并行与重试按真实发生先后理解。
 * - steps：按步骤（拓扑）顺序，仅用于理解 DAG 结构，不表示先后。
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
  const sorted = [...visible].sort(
    options.order === 'steps'
      ? byStep
      : (a, b) => {
          if (a.sortTime != null && b.sortTime != null) return a.sortTime - b.sortTime || byStep(a, b)
          if (a.sortTime != null) return -1
          if (b.sortTime != null) return 1
          return byStep(a, b)
        },
  )
  return { items: sorted, collapsed, historical }
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
