import type { WorkflowJobStatusCounts } from '@unilab-fe/core'

const COUNT_LABELS: ReadonlyArray<readonly [keyof WorkflowJobStatusCounts, string]> = [
  ['succeeded', '成功'],
  ['running', '运行中'],
  ['waiting', '等待'],
  ['unknown', '结果待核对'],
  ['failed', '失败'],
  ['timeout', '超时'],
  ['canceled', '取消'],
  ['skipped', '跳过'],
]

export interface JobCountPart {
  readonly key: keyof WorkflowJobStatusCounts
  readonly label: string
  readonly value: number
}

/** 非零状态计数，顺序固定；这是 OS Job 状态的如实汇总，不是实验完成度。 */
export function jobCountParts(counts: WorkflowJobStatusCounts): JobCountPart[] {
  return COUNT_LABELS.filter(([key]) => counts[key] > 0).map(([key, label]) => ({
    key,
    label,
    value: counts[key],
  }))
}

export function formatJobCounts(counts: WorkflowJobStatusCounts): string {
  const parts = jobCountParts(counts).map((part) => `${part.label} ${part.value}`)
  if (parts.length === 0) return '暂无节点'
  const history =
    counts.historicalAttempts > 0 ? `（另有历史重试 ${counts.historicalAttempts}）` : ''
  return `${parts.join(' · ')}${history}`
}

const ATTENTION_LABELS: Readonly<Record<string, string>> = {
  resource_handoff_required: '需要物料交接',
  local_cancel_acceptance_unavailable: '取消未获设备受理',
  edge_disconnected: '执行端断开',
  manual_confirmation_rejected: '人工确认被拒绝',
  edge_reported_unknown_commands: '设备命令结果未知，需现场核对',
}

/** OS 的原因可能带“:<命令号>”后缀，按代码部分取中文说明，未收录的代码原样显示。 */
function attentionLabel(reason: string): string {
  const code = reason.split(':')[0]!
  return ATTENTION_LABELS[reason] ?? ATTENTION_LABELS[code] ?? reason
}

/**
 * 任务终态之外仍需人工处理的事项（如取消后待物料交接、手动处置会话未关闭）。
 * 与 Task 终态分开呈现：任务“已取消”不等于现场已收尾。
 */
export function taskAttention(task: {
  readonly status: string
  readonly controlStatus: string
  readonly cleanupStatus: string
  readonly attentionReason?: string | null
}): string | null {
  const reason = task.attentionReason ? attentionLabel(task.attentionReason) : null
  if (task.cleanupStatus === 'requires_attention')
    return reason ? `待人工收尾：${reason}` : '待人工收尾'
  if (task.controlStatus === 'waiting_reconciliation')
    return reason ? `待物理对账：${reason}` : '待物理对账'
  if (['error_waiting', 'waiting_intervention'].includes(task.controlStatus)) {
    return reason ? `等待人工处置：${reason}` : '等待人工处置'
  }
  return reason
}
