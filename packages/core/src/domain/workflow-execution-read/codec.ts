import { WorkflowExecutionReadError } from './errors'
import type { TaskJobsResponse, TaskListResponse, WorkflowExecutionRecord } from './api'
import type {
  WorkflowNodeJobDetail,
  NodeJobFeedback,
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimePage,
  TaskRuntimeDetail
} from './model'

export function decodeTaskRuntimeDetail(value: unknown): TaskRuntimeDetail {
  const raw = unwrapData(asRecord(value, 'task'))
  return {
    kind: 'task_runtime_detail',
    source: 'os',
    taskUuid: requiredString(raw.uuid ?? raw.task_uuid, 'task.uuid'),
    workflowUuid: nullableString(raw.workflow_uuid, 'task.workflow_uuid'),
    executionKind: requiredString(raw.execution_kind, 'task.execution_kind'),
    status: requiredString(raw.status, 'task.status'),
    runMode: requiredString(raw.run_mode, 'task.run_mode'),
    controlStatus: requiredString(raw.control_status, 'task.control_status'),
    cleanupStatus: requiredString(raw.cleanup_status, 'task.cleanup_status'),
    ...(optionalString(raw.priority) === undefined ? {} : { priority: optionalString(raw.priority) }),
    ...(optionalString(raw.description) === undefined ? {} : { description: optionalString(raw.description) }),
    createdAt: requiredString(raw.create_time, 'task.create_time'),
    updatedAt: requiredString(raw.update_time, 'task.update_time'),
    ...(optionalString(raw.finished_at) === undefined ? {} : { finishedAt: optionalString(raw.finished_at) }),
    ...(optionalString(raw.attention_reason) === undefined ? {} : { attentionReason: optionalString(raw.attention_reason) }),
    raw
  }
}

export function decodeTaskPage(value: unknown): TaskRuntimePage {
  const root = unwrapData(asRecord(value, 'task list')) as TaskListResponse
  if (!Array.isArray(root.items)) invalid('task list.items must be an array')
  const page = positiveInteger(root.page, 'task list.page')
  const pageSize = positiveInteger(root.page_size, 'task list.page_size')
  const total = nonNegativeInteger(root.total, 'task list.total')
  return {
    items: root.items.map((item, index) => decodeTaskRuntimeDetail(
      asRecord(item, `task list.items[${index}]`)
    )),
    total,
    page,
    pageSize,
    hasMore: root.has_more === undefined
      ? page * pageSize < total
      : booleanValue(root.has_more, 'task list.has_more'),
    raw: root
  }
}

export function decodeTaskJobs(value: unknown): readonly TaskJobSummary[] {
  const root = Array.isArray(value)
    ? { data: value } as WorkflowExecutionRecord
    : asRecord(value, 'task jobs')
  const unwrapped = unwrapData(root)
  const items = Array.isArray(unwrapped.items)
    ? unwrapped.items
    : Array.isArray(unwrapped.jobs)
      ? unwrapped.jobs
      : Array.isArray(unwrapped.data)
        ? unwrapped.data
        : Array.isArray(value)
          ? value
          : []
  return items.map((item, index) => decodeTaskJob(asRecord(item, `task jobs[${index}]`)))
}

export function decodeNodeJobDetail(value: unknown): WorkflowNodeJobDetail {
  const raw = unwrapData(asRecord(value, 'node job'))
  return {
    kind: 'node_job_detail',
    source: 'os',
    jobUuid: requiredString(raw.uuid ?? raw.job_uuid, 'job.uuid'),
    workflowTaskUuid: requiredString(raw.workflow_task_uuid, 'job.workflow_task_uuid'),
    workflowNodeUuid: requiredString(raw.workflow_node_uuid, 'job.workflow_node_uuid'),
    materialUuid: nullableString(raw.material_uuid, 'job.material_uuid'),
    edgeUuid: nullableString(raw.edge_uuid, 'job.edge_uuid'),
    edgeCommandUuid: nullableString(raw.edge_command_uuid, 'job.edge_command_uuid'),
    feedbackSequence: nullableNonNegativeInteger(raw.feedback_sequence, 'job.feedback_sequence'),
    topologicalIndex: nullableNonNegativeInteger(raw.topological_index, 'job.topological_index'),
    executorKind: requiredString(raw.executor_kind, 'job.executor_kind'),
    executionPolicy: asOptionalRecord(raw.execution_policy) ?? {},
    executionTimeoutSeconds: nullableNonNegativeNumber(raw.execution_timeout_seconds, 'job.execution_timeout_seconds'),
    status: requiredString(raw.status, 'job.status'),
    attempt: nonNegativeInteger(raw.attempt, 'job.attempt'),
    param: asOptionalRecord(raw.param) ?? {},
    feedbackData: asOptionalRecord(raw.feedback_data) ?? {},
    returnInfo: asOptionalRecord(raw.return_info) ?? {},
    controlData: asOptionalRecord(raw.control_data) ?? {},
    errorInfo: Array.isArray(raw.error_info) ? raw.error_info : [],
    uncertaintyReason: nullableString(raw.uncertainty_reason, 'job.uncertainty_reason'),
    dispatchDeadlineAt: nullableString(raw.dispatch_deadline_at, 'job.dispatch_deadline_at'),
    executionDeadlineAt: nullableString(raw.execution_deadline_at, 'job.execution_deadline_at'),
    cancelCommandUuid: nullableString(raw.cancel_command_uuid, 'job.cancel_command_uuid'),
    cancelAckDeadlineAt: nullableString(raw.cancel_ack_deadline_at, 'job.cancel_ack_deadline_at'),
    cancelCompleteDeadlineAt: nullableString(raw.cancel_complete_deadline_at, 'job.cancel_complete_deadline_at'),
    startedAt: nullableString(raw.started_at, 'job.started_at'),
    finishedAt: nullableString(raw.finished_at, 'job.finished_at'),
    raw
  }
}

export function decodeNodeJobFeedbackPage(value: unknown): NodeJobFeedbackPage {
  const raw = unwrapData(asRecord(value, 'node job feedback'))
  const items = raw.items
  if (!Array.isArray(items)) invalid('node job feedback.items must be an array', 'INVALID_FEEDBACK_RESPONSE')
  const decoded = items.map((item, index) => decodeNodeJobFeedback(
    asRecord(item, `node job feedback.items[${index}]`)
  ))
  return {
    items: decoded,
    nextCursor: raw.next_cursor === undefined
      ? decoded.at(-1)?.sequence ?? 0
      : nonNegativeInteger(raw.next_cursor, 'node job feedback.next_cursor'),
    hasMore: booleanValue(raw.has_more, 'node job feedback.has_more'),
    raw
  }
}

function decodeNodeJobFeedback(value: WorkflowExecutionRecord): NodeJobFeedback {
  return {
    kind: 'node_job_feedback',
    source: 'os',
    feedbackUuid: requiredString(value.uuid, 'feedback.uuid'),
    jobUuid: requiredString(value.workflow_node_job_uuid, 'feedback.workflow_node_job_uuid'),
    sequence: nonNegativeInteger(value.sequence, 'feedback.sequence'),
    feedbackType: requiredString(value.feedback_type, 'feedback.feedback_type'),
    data: asOptionalRecord(value.data) ?? {},
    observedAt: requiredString(value.observed_at, 'feedback.observed_at'),
    receivedAt: requiredString(value.received_at, 'feedback.received_at'),
    publishedAt: nullableString(value.published_at, 'feedback.published_at'),
    idempotencyKey: requiredString(value.idempotency_key, 'feedback.idempotency_key'),
    description: nullableString(value.description, 'feedback.description'),
    metadata: asOptionalRecord(value.meta_data) ?? {},
    raw: value
  }
}

function decodeTaskJob(value: WorkflowExecutionRecord): TaskJobSummary {
  return {
    kind: 'task_job_summary',
    source: 'os',
    jobUuid: requiredString(value.uuid ?? value.job_uuid, 'job.uuid'),
    workflowNodeUuid: requiredString(value.workflow_node_uuid, 'job.workflow_node_uuid'),
    topologicalIndex: nonNegativeInteger(value.topological_index, 'job.topological_index'),
    executorKind: requiredString(value.executor_kind, 'job.executor_kind'),
    status: requiredString(value.status, 'job.status'),
    attempt: nonNegativeInteger(value.attempt, 'job.attempt'),
    currentAttempt: booleanValue(value.current_attempt, 'job.current_attempt'),
    ...(optionalString(value.execution_source) === undefined
      ? {}
      : { executionSource: optionalString(value.execution_source) }),
    ...(optionalString(value.start_state) === undefined
      ? {}
      : { startState: optionalString(value.start_state) }),
    controlData: asOptionalRecord(value.control_data) ?? {},
    errorInfo: Array.isArray(value.error_info) ? value.error_info : [],
    waitReason: asOptionalRecord(value.wait_reason) ?? {},
    expectedChangeSet: asOptionalRecord(value.expected_change_set) ?? {},
    ...(optionalString(value.finished_at) === undefined
      ? {}
      : { finishedAt: optionalString(value.finished_at) }),
    raw: value
  }
}

function unwrapData(value: WorkflowExecutionRecord): WorkflowExecutionRecord {
  if (value.code !== undefined && value.code !== 0 && value.code !== '0') {
    throw new WorkflowExecutionReadError(
      'OS_REQUEST_REJECTED',
      optionalString(asOptionalRecord(value.error)?.message ?? asOptionalRecord(value.error)?.msg ?? value.message)
        ?? `OS request rejected with code ${String(value.code)}`
    )
  }
  return asOptionalRecord(value.data) ?? value
}

function asRecord(value: unknown, path: string): WorkflowExecutionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be an object`)
  }
  return value as WorkflowExecutionRecord
}

function asOptionalRecord(value: unknown): WorkflowExecutionRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as WorkflowExecutionRecord
    : undefined
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be a string`)
  }
  return result
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null
  const result = optionalString(value)
  if (result === undefined) {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be a string or null`)
  }
  return result
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be a non-negative integer`)
  }
  return value
}

function positiveInteger(value: unknown, path: string): number {
  const result = nonNegativeInteger(value, path)
  if (result < 1) {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be positive`)
  }
  return result
}

function nullableNonNegativeInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  return nonNegativeInteger(value, path)
}

function nullableNonNegativeNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new WorkflowExecutionReadError('INVALID_NODE_JOB_RESPONSE', `${path} must be a non-negative number`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be a boolean`)
  }
  return value
}

function invalid(
  message: string,
  code: 'INVALID_TASK_RUNTIME_RESPONSE' | 'INVALID_NODE_JOB_RESPONSE' | 'INVALID_FEEDBACK_RESPONSE' = 'INVALID_TASK_RUNTIME_RESPONSE'
): never {
  throw new WorkflowExecutionReadError(code, message)
}
