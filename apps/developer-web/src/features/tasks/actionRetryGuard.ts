import type { WorkflowNodeJobDetail } from '@unilab-fe/core'

/** OS 只为这些已结束的作业创建下一次尝试；其余状态说明动作尚未结束。 */
export const RETRYABLE_JOB_STATUSES: ReadonlySet<string> = new Set([
  'failed',
  'timeout',
  'canceled',
])

/** OS 已登记的人工处置（control_data.manual_resolution）。 */
export function readManualResolution(
  job: WorkflowNodeJobDetail | null,
): { reason: string; status: string } | null {
  const raw = job?.controlData.manual_resolution
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  return {
    reason: typeof record.reason === 'string' ? record.reason : '',
    status: typeof record.status === 'string' ? record.status : '',
  }
}

/**
 * 依据 OS 作业事实判断能否“重新执行该动作”（retry_current_node）：结果未知（uncertainty_reason）
 * 或作业尚未结束时不能重发，否则同一动作可能被执行两次。必须先在现场核对并按“已取消”收尾，
 * OS 清除不确定事实后才放行。任务详情与工站错误处置对话框共用这一规则。
 */
export function retryBlockReason(job: WorkflowNodeJobDetail): string | null {
  if (job.uncertaintyReason) {
    return readManualResolution(job)
      ? '已请求按“已取消”收尾，等待设备侧确认；OS 记录收尾后才能重新执行。'
      : `动作结果未知（${job.uncertaintyReason}），可能已经执行。请先现场核对并“按已取消收尾”，OS 记录收尾后才能重新执行。`
  }
  if (!RETRYABLE_JOB_STATUSES.has(job.status))
    return `该动作尚未结束（OS 状态 ${job.status}），不能重新执行。`
  return null
}
