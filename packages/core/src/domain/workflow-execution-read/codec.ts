import { WorkflowExecutionReadError } from './errors'
import type { TaskJobsResponse, WorkflowExecutionRecord } from './api'
import type { TaskJobSummary, TaskRuntimeDetail } from './model'

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

export function decodeTaskJobs(value: unknown): readonly TaskJobSummary[] {
  const root = asRecord(value, 'task jobs')
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
  if (value === null) return null
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

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkflowExecutionReadError('INVALID_TASK_RUNTIME_RESPONSE', `${path} must be a boolean`)
  }
  return value
}

