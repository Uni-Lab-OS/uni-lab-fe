import type { TaskPresentationResponse, WorkflowExecutionRecord } from './api'
import {
  asRecord,
  booleanValue,
  invalid,
  nonNegativeInteger,
  nullableString,
  positiveInteger,
  requiredString,
  unwrapData,
} from './codec'
import { countWorkflowJobsFromAggregate } from './debug-facts'
import type {
  TaskRuntimeSummary,
  TaskRuntimeSummaryActiveJob,
  TaskRuntimeSummaryPage,
  WorkflowJobStatusCounts,
} from './model'

/** 本前端实现的摘要合同版本；OS 递增版本表示字段语义变化，必须先升级本解码器。 */
export const TASK_SUMMARY_VERSION = 1

/**
 * 解码 GET /workflow-task-presentations?view=summary。页级 view/summary_version 必须与本合同一致，
 * 否则整体拒绝：旧 OS 若忽略 view 返回默认投影，也不能被当作摘要使用。
 */
export function decodeTaskSummaryPage(value: unknown): TaskRuntimeSummaryPage {
  const root = unwrapData(asRecord(value, 'task summary list')) as TaskPresentationResponse
  if (root.view !== 'summary') {
    invalid(`task summary list.view must be "summary", got ${JSON.stringify(root.view)}`)
  }
  if (root.summary_version !== TASK_SUMMARY_VERSION) {
    invalid(`unsupported task summary version: ${JSON.stringify(root.summary_version)}`)
  }
  if (!Array.isArray(root.items)) invalid('task summary list.items must be an array')
  return {
    view: 'summary',
    summaryVersion: TASK_SUMMARY_VERSION,
    items: root.items.map((item, index) =>
      decodeTaskSummary(asRecord(item, `task summaries.items[${index}]`)),
    ),
    total: nonNegativeInteger(root.total, 'task summaries.total'),
    page: positiveInteger(root.page, 'task summaries.page'),
    pageSize: positiveInteger(root.page_size, 'task summaries.page_size'),
    raw: root,
  }
}

function decodeTaskSummary(value: WorkflowExecutionRecord): TaskRuntimeSummary {
  const activity = asRecord(value.job_activity, 'summary.job_activity')
  const activeJobs = value.active_jobs
  if (!Array.isArray(activeJobs)) invalid('summary.active_jobs must be an array')
  return {
    kind: 'task_runtime_summary',
    source: 'os',
    taskUuid: requiredString(value.uuid, 'summary.uuid'),
    workflowUuid: nullableString(value.workflow_uuid, 'summary.workflow_uuid'),
    executionKind: requiredString(value.execution_kind, 'summary.execution_kind'),
    status: requiredString(value.status, 'summary.status'),
    runMode: requiredString(value.run_mode, 'summary.run_mode'),
    controlStatus: requiredString(value.control_status, 'summary.control_status'),
    cleanupStatus: requiredString(value.cleanup_status, 'summary.cleanup_status'),
    priority: nullableString(value.priority, 'summary.priority'),
    description: nullableString(value.description, 'summary.description'),
    createdAt: requiredString(value.create_time, 'summary.create_time'),
    updatedAt: requiredString(value.update_time, 'summary.update_time'),
    startedAt: nullableString(value.started_at, 'summary.started_at'),
    finishedAt: nullableString(value.finished_at, 'summary.finished_at'),
    attentionReason: nullableString(value.attention_reason, 'summary.attention_reason'),
    jobCounts: decodeSummaryJobCounts(value.job_counts),
    jobActivity: {
      firstStartedAt: nullableString(
        activity.first_started_at,
        'summary.job_activity.first_started_at',
      ),
      lastFinishedAt: nullableString(
        activity.last_finished_at,
        'summary.job_activity.last_finished_at',
      ),
    },
    activeJobs: activeJobs.map((job, index) =>
      decodeActiveJob(asRecord(job, `summary.active_jobs[${index}]`)),
    ),
    activeJobsTruncated: booleanValue(value.active_jobs_truncated, 'summary.active_jobs_truncated'),
    pendingManualConfirmationCount: nonNegativeInteger(
      value.pending_manual_confirmation_count,
      'summary.pending_manual_confirmation_count',
    ),
    manualReviewAttentionResolved: booleanValue(
      value.manual_review_attention_resolved,
      'summary.manual_review_attention_resolved',
    ),
    raw: value,
  }
}

/** 聚合计数必须自洽（按状态之和等于 total，不确定子集不超过对应状态），否则拒绝而不是算出负数。 */
function decodeSummaryJobCounts(value: unknown): WorkflowJobStatusCounts {
  const raw = asRecord(value, 'summary.job_counts')
  const total = nonNegativeInteger(raw.total, 'summary.job_counts.total')
  const byStatus = statusCounts(raw.by_status, 'summary.job_counts.by_status')
  const uncertainByStatus = statusCounts(
    raw.uncertain_by_status,
    'summary.job_counts.uncertain_by_status',
  )
  const sum = Object.values(byStatus).reduce((left, right) => left + right, 0)
  if (sum !== total) {
    invalid(`summary.job_counts.by_status sums to ${sum}, expected total ${total}`)
  }
  for (const [status, count] of Object.entries(uncertainByStatus)) {
    if (count > (byStatus[status] ?? 0)) {
      invalid(`summary.job_counts.uncertain_by_status.${status} exceeds by_status`)
    }
  }
  return countWorkflowJobsFromAggregate({
    total,
    historicalAttempts: nonNegativeInteger(
      raw.historical_attempts,
      'summary.job_counts.historical_attempts',
    ),
    byStatus,
    uncertainByStatus,
  })
}

function statusCounts(value: unknown, path: string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [status, count] of Object.entries(asRecord(value, path))) {
    result[status] = nonNegativeInteger(count, `${path}.${status}`)
  }
  return result
}

function decodeActiveJob(value: WorkflowExecutionRecord): TaskRuntimeSummaryActiveJob {
  return {
    jobUuid: requiredString(value.uuid, 'summary.active_job.uuid'),
    workflowNodeUuid: requiredString(
      value.workflow_node_uuid,
      'summary.active_job.workflow_node_uuid',
    ),
    nodeName: nullableString(value.node_name, 'summary.active_job.node_name'),
    executorKind: requiredString(value.executor_kind, 'summary.active_job.executor_kind'),
    status: requiredString(value.status, 'summary.active_job.status'),
    attempt: nonNegativeInteger(value.attempt, 'summary.active_job.attempt'),
    deviceId: nullableString(value.device_id, 'summary.active_job.device_id'),
    startedAt: nullableString(value.started_at, 'summary.active_job.started_at'),
    uncertaintyReason: nullableString(
      value.uncertainty_reason,
      'summary.active_job.uncertainty_reason',
    ),
    raw: value,
  }
}
