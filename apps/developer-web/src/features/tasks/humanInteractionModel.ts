import type { WorkflowDebugTimelineItem, WorkflowHumanInteraction } from '@unilab-fe/core'

export const HUMAN_STATUS_LABELS: Record<WorkflowHumanInteraction['status'], string> = {
  pending: '等待处理',
  answered: '已回复',
  timed_out: '已超时',
  canceled: '已随任务结束',
}

export const HUMAN_KIND_LABELS: Record<WorkflowHumanInteraction['interactionKind'], string> = {
  choose: '人工选择',
  text: '人工填写',
  numbers: '人工数值',
  sketch: '人工手绘',
  review: '人工复核',
}

export interface HumanWorkSummary {
  /** OS 已打开、尚未回复的请求。 */
  readonly pending: readonly WorkflowHumanInteraction[]
  /** 已结束的请求（回复、超时、随任务结束），按打开时间倒序。 */
  readonly settled: readonly WorkflowHumanInteraction[]
  /**
   * 工作流命令作业仍待执行、但 OS 尚未返回对应请求。
   * OS 打开请求时不一定发出运行时事件，界面据此提示操作员手动刷新，而不是轮询。
   */
  readonly awaitingRequest: readonly WorkflowDebugTimelineItem[]
}

export function summarizeHumanWork(
  timeline: readonly WorkflowDebugTimelineItem[],
  interactions: readonly WorkflowHumanInteraction[],
  /** 快照中确认为 HumanCommands 的节点；库存命令等其他 workflow_command 不提示。 */
  humanNodeIds: ReadonlySet<string> = new Set(),
): HumanWorkSummary {
  const known = new Set(interactions.map((item) => item.jobUuid))
  return {
    pending: interactions.filter((item) => item.status === 'pending'),
    settled: interactions
      .filter((item) => item.status !== 'pending')
      .slice()
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    awaitingRequest: timeline.filter(
      (job) =>
        job.executorKind === 'workflow_command' &&
        humanNodeIds.has(job.workflowNodeUuid) &&
        (job.status === 'pending' || job.status === 'waiting') &&
        !known.has(job.jobUuid),
    ),
  }
}

/** 时间线快照签名：SSE invalidation 触发 Task/Jobs 重读后签名变化，人工交互随之重读。 */
export function timelineSignature(timeline: readonly WorkflowDebugTimelineItem[]): string {
  return timeline.map((job) => `${job.jobUuid}:${job.status}:${job.attempt}`).join('|')
}

export function isExpired(
  interaction: WorkflowHumanInteraction,
  now: number = Date.now(),
): boolean {
  const deadline = Date.parse(interaction.deadlineAt)
  return Number.isFinite(deadline) && now >= deadline
}

export function formatDeadline(
  interaction: WorkflowHumanInteraction,
  now: number = Date.now(),
): string {
  const deadline = Date.parse(interaction.deadlineAt)
  if (!Number.isFinite(deadline)) return '截止时间未提供'
  const remaining = deadline - now
  if (remaining <= 0) return '已超过截止时间'
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  return hours > 0 ? `剩余 ${hours} 小时 ${minutes} 分` : `剩余 ${Math.max(1, minutes)} 分钟`
}

/** 把界面上的数值输入解析为有限数；空串或非法输入返回 NaN，由 core 校验给出具体字段。 */
export function parseNumberInputs(values: readonly string[]): number[] {
  return values.map((value) => (value.trim() === '' ? Number.NaN : Number(value)))
}
