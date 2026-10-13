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
}

export const markerGlyph: Record<EventStatus, string> = {
  success: 'check',
  running: 'play',
  waiting: 'clock',
  manual: 'user-check',
  unknown: 'help',
  pending: 'minus',
  // 失败用「叉」：警告三角与「结果待核对」太像，不够醒目。
  failed: 'x',
  skipped: 'skip-forward',
}

export const statusLabels: Record<EventStatus, string> = {
  success: '已完成',
  running: '执行中',
  waiting: '等待资源',
  manual: '待人工确认',
  unknown: '结果待核对',
  pending: '未到达',
  failed: '失败',
  skipped: '已跳过',
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
  if (status === 'canceled') return 'skipped'
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

/**
 * 把 OS 返回的 error_info 条目转成可读文本。
 *
 * OS 的 error_info 是开放数组（可能是字符串、字符串数组或任意对象），
 * 这里只做展示投影：能取出 message/code 就用，取不出就退化成 JSON，
 * 但绝不丢掉原始事实、也不编造文案。
 */
export function formatErrorInfoEntries(errorInfo: readonly unknown[]): readonly string[] {
  return errorInfo
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim()
      if (entry == null) return ''
      if (typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const code = typeof record.code === 'string' ? record.code : undefined
        const message =
          typeof record.message === 'string'
            ? record.message
            : typeof record.msg === 'string'
              ? record.msg
              : typeof record.reason === 'string'
                ? record.reason
                : undefined
        if (code && message) return `${code}：${message}`
        if (message) return message
        if (code) return code
        return formatJson(entry)
      }
      return String(entry)
    })
    .filter((text) => text.length > 0)
}

/** 时间线上只需要一句摘要；取不到可读内容时明确说明还有多少条原文。 */
export function summarizeErrorInfo(errorInfo: readonly unknown[]): string | null {
  const entries = formatErrorInfoEntries(errorInfo)
  if (entries.length === 0) {
    return errorInfo.length > 0 ? `${errorInfo.length} 条错误信息，详情见异常处置` : null
  }
  return entries[0]
}

/**
 * 把可能是一整段 Python traceback 的原文压成一句话。
 *
 * 摘要区域不能直接放多行堆栈：既读不出重点，也会把布局撑破。traceback 只取
 * 最后一行（异常类型与消息），其余长文本按长度截断；完整原文始终由异常处置的
 * 折叠详情原样展示，不做有损替换。
 */
export function summarizeErrorText(value: string, maxLength = 240): string {
  const text = value.trim()
  if (!text) return ''
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const candidate =
    text.includes('Traceback (most recent call last)') && lines.length > 0
      ? lines[lines.length - 1]
      : text
  if (candidate.length <= maxLength) return candidate
  return `${candidate.slice(0, Math.max(1, maxLength - 1))}…`
}

export function toTimelineEvent(job: WorkflowDebugTimelineItem): TimelineEvent {
  return {
    id: job.jobUuid,
    time: formatTimelineTime(job.startedAt),
    title: job.nodeLabel,
    group: job.executorKind,
    description:
      Object.keys(job.waitReason).length > 0
        ? String(job.waitReason.reason ?? job.waitReason.message ?? '等待运行时条件')
        : summarizeErrorText(summarizeErrorInfo(job.errorInfo) ?? ''),
    status: mapJobStatus(job.status),
    device: job.executorKind,
    duration: formatTimelineDuration(job.startedAt, job.finishedAt, job.status),
  }
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
