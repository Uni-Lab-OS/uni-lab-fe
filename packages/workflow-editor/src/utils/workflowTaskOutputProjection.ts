import type {
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowTaskRuntimeEvent
} from '@unilab/services'

import type {
  WorkflowOutputEvent,
  WorkflowOutputNode
} from '../components/WorkflowOutput'

export function projectWorkflowTaskJob(
  job: WorkflowNodeJob
): WorkflowOutputNode {
  return {
    nodeId: job.uuid,
    sourceNodeId: job.workflow_node_uuid,
    nodeType: job.executor_kind,
    state: job.status,
    attempt: job.attempt,
    result: {
      job_uuid: job.uuid,
      workflow_node_uuid: job.workflow_node_uuid,
      executor_kind: job.executor_kind,
      status: job.status,
      attempt: job.attempt,
      param: job.param,
      feedback_sequence: job.feedback_sequence,
      feedback_data: job.feedback_data,
      return_info: job.return_info,
      error_info: job.error_info,
      create_time: job.create_time,
      update_time: job.update_time,
      started_at: job.started_at,
      finished_at: job.finished_at
    }
  }
}

export function projectWorkflowTaskEvents(
  runtimeEvents: readonly WorkflowTaskRuntimeEvent[],
  feedback: readonly WorkflowNodeJobFeedback[],
  jobs: readonly WorkflowNodeJob[]
): WorkflowOutputEvent[] {
  const sourceNodeByJob = new Map(jobs.map((job) => [
    job.uuid,
    job.workflow_node_uuid
  ]))
  const committedFeedback = new Set(runtimeEvents.flatMap((event) => {
    if (
      event.kind !== 'feedback_committed' ||
      !event.workflow_node_job_uuid
    ) return []
    const sequence = event.data.sequence
    return typeof sequence === 'number'
      ? [`${event.workflow_node_job_uuid}:${sequence}`]
      : []
  }))
  const projectedRuntime = runtimeEvents.map((event) => ({
    key: `runtime-${event.sequence}`,
    seq: event.sequence,
    type: runtimeEventType(event),
    nodeId: event.workflow_node_uuid ?? (
      event.workflow_node_job_uuid
        ? sourceNodeByJob.get(event.workflow_node_job_uuid) ?? null
        : null
    ),
    detail: runtimeEventDetail(event)
  }))
  const fallbackFeedback = feedback
    .filter((item) => !committedFeedback.has(
      `${item.workflow_node_job_uuid}:${item.sequence}`
    ))
    .map((item) => ({
      key: `feedback-${item.uuid}`,
      seq: item.sequence,
      type: 'node.feedback',
      nodeId: sourceNodeByJob.get(item.workflow_node_job_uuid) ?? null,
      detail: {
        feedback_type: item.feedback_type,
        feedback: item.data,
        observed_at: item.observed_at,
        received_at: item.received_at
      }
    }))
  return [...projectedRuntime, ...fallbackFeedback].sort(
    (left, right) => left.seq - right.seq
  )
}

function runtimeEventType(event: WorkflowTaskRuntimeEvent): string {
  if (event.kind === 'task_transition') {
    if (event.to_status === 'running') return 'run.started'
    if (event.to_status === 'succeeded') return 'run.completed'
    if (
      event.to_status === 'failed' ||
      event.to_status === 'timeout' ||
      event.to_status === 'canceled'
    ) return 'run.failed'
    return 'run.status'
  }
  if (event.kind === 'job_transition') {
    const byStatus: Readonly<Record<string, string>> = {
      dispatched: 'node.dispatched',
      running: 'node.started',
      succeeded: 'node.result',
      failed: 'node.exception',
      timeout: 'node.exception',
      skipped: 'node.skipped',
      canceled: 'node.completed'
    }
    return byStatus[event.to_status ?? ''] ?? 'node.status'
  }
  const byKind: Readonly<Record<WorkflowTaskRuntimeEvent['kind'], string>> = {
    task_transition: 'run.status',
    job_transition: 'node.status',
    command_consumed: 'run.command',
    feedback_committed: 'node.feedback',
    uncertainty_opened: 'node.uncertainty_opened',
    uncertainty_resolved: 'node.uncertainty_resolved',
    startup_recovered: 'run.recovered'
  }
  return byKind[event.kind]
}

function runtimeEventDetail(
  event: WorkflowTaskRuntimeEvent
): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    kind: event.kind,
    create_time: event.create_time,
    data: event.data
  }
  assignDefined(detail, 'from_status', event.from_status)
  assignDefined(detail, 'to_status', event.to_status)
  assignDefined(detail, 'workflow_node_job_uuid', event.workflow_node_job_uuid)
  assignDefined(detail, 'workflow_task_command_uuid', event.workflow_task_command_uuid)
  assignDefined(detail, 'executor_kind', event.executor_kind)
  assignDefined(detail, 'attempt', event.attempt)
  assignDefined(detail, 'param', event.param)
  assignDefined(detail, 'return_info', event.return_info)
  assignDefined(detail, 'error_info', event.error_info)
  assignDefined(detail, 'feedback_type', event.feedback_type)
  assignDefined(detail, 'feedback', event.feedback)
  assignDefined(detail, 'command_type', event.command_type)
  assignDefined(detail, 'command_result', event.command_result)
  return detail
}

function assignDefined(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (value !== undefined) target[key] = value
}
