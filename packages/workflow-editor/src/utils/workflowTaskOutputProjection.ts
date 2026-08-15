import type {
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowTask,
  WorkflowTaskStatus
} from '@unilab/services'

import type {
  WorkflowOutputActivity,
  WorkflowOutputNode
} from '../components/WorkflowOutput'

export interface WorkflowTaskOutputSnapshot {
  task: WorkflowTask | null
  jobs: readonly WorkflowNodeJob[]
  feedback: readonly WorkflowNodeJobFeedback[]
}

export interface WorkflowTaskOutputProjection {
  nodes: readonly WorkflowOutputNode[]
  activity: readonly WorkflowOutputActivity[]
}

interface SortableActivity extends WorkflowOutputActivity {
  tieBreakOrder: number
}

/**
 * 将权威 Task、Job 与 feedback 快照投影为运行输出。
 *
 * 轨迹严格按服务端时间排序；拓扑位置只用于“步骤 N”标签，不参与时间线排序。
 * 快照能证明开始、结束和反馈事实，但不会伪造服务端未持久化的中间转换历史。
 */
export function projectWorkflowTaskOutput({
  task,
  jobs,
  feedback
}: WorkflowTaskOutputSnapshot): WorkflowTaskOutputProjection {
  const jobByUuid = new Map(jobs.map((job) => [job.uuid, job]))
  const activity = [
    ...(task ? projectTaskActivity(task) : []),
    ...jobs.flatMap(projectJobActivity),
    ...feedback.flatMap((item) => {
      const job = jobByUuid.get(item.workflow_node_job_uuid)
      if (!job) return []
      return [projectFeedbackActivity(item, job)]
    })
  ].sort(compareActivity).map(({ tieBreakOrder: _tieBreakOrder, ...item }) => item)

  return {
    nodes: jobs.map(projectWorkflowTaskJob),
    activity
  }
}

function projectWorkflowTaskJob(job: WorkflowNodeJob): WorkflowOutputNode {
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

function projectTaskActivity(task: WorkflowTask): SortableActivity[] {
  const activity: SortableActivity[] = [{
    key: `task-${task.uuid}-created`,
    occurredAt: task.create_time,
    positionLabel: '整体运行',
    type: 'run.created',
    nodeId: null,
    detail: taskDetail(task),
    tieBreakOrder: -1
  }]
  if (task.started_at) {
    activity.push({
      key: `task-${task.uuid}-started`,
      occurredAt: task.started_at,
      positionLabel: '整体运行',
      type: 'run.started',
      nodeId: null,
      detail: taskDetail(task),
      tieBreakOrder: 0
    })
  } else if (task.status === 'running') {
    activity.push({
      key: `task-${task.uuid}-running`,
      occurredAt: task.update_time,
      positionLabel: '整体运行',
      type: 'run.started',
      nodeId: null,
      detail: taskDetail(task, 'update_time'),
      tieBreakOrder: 0
    })
  }

  if (isTerminalTaskStatus(task.status)) {
    activity.push({
      key: `task-${task.uuid}-${task.status}`,
      occurredAt: task.finished_at ?? task.update_time,
      positionLabel: '整体运行',
      type: taskTerminalActivityType(task.status),
      nodeId: null,
      detail: taskDetail(task, task.finished_at ? undefined : 'update_time'),
      tieBreakOrder: 4
    })
  } else if (task.status !== 'pending' && task.status !== 'running') {
    activity.push({
      key: `task-${task.uuid}-${task.status}`,
      occurredAt: task.update_time,
      positionLabel: '整体运行',
      type: 'run.status',
      nodeId: null,
      detail: taskDetail(task, 'update_time'),
      tieBreakOrder: 4
    })
  }
  return activity
}

function projectJobActivity(job: WorkflowNodeJob): SortableActivity[] {
  const activity: SortableActivity[] = []
  const positionLabel = jobPositionLabel(job)
  if (job.started_at) {
    activity.push({
      key: `job-${job.uuid}-${job.attempt}-started`,
      occurredAt: job.started_at,
      positionLabel,
      type: 'node.started',
      nodeId: job.workflow_node_uuid,
      detail: jobDetail(job),
      tieBreakOrder: 1
    })
  } else if (job.status === 'running') {
    activity.push({
      key: `job-${job.uuid}-${job.attempt}-running`,
      occurredAt: job.update_time,
      positionLabel,
      type: 'node.started',
      nodeId: job.workflow_node_uuid,
      detail: jobDetail(job, 'update_time'),
      tieBreakOrder: 1
    })
  }

  if (isTerminalJobStatus(job.status)) {
    activity.push({
      key: `job-${job.uuid}-${job.attempt}-${job.status}`,
      occurredAt: job.finished_at ?? job.update_time,
      positionLabel,
      type: jobTerminalActivityType(job.status),
      nodeId: job.workflow_node_uuid,
      detail: jobDetail(job, job.finished_at ? undefined : 'update_time'),
      tieBreakOrder: 3
    })
  } else if (job.status !== 'pending' && job.status !== 'running') {
    activity.push({
      key: `job-${job.uuid}-${job.attempt}-${job.status}`,
      occurredAt: job.update_time,
      positionLabel,
      type: jobCurrentActivityType(job.status),
      nodeId: job.workflow_node_uuid,
      detail: jobDetail(job, 'update_time'),
      tieBreakOrder: 3
    })
  }
  return activity
}

function projectFeedbackActivity(
  feedback: WorkflowNodeJobFeedback,
  job: WorkflowNodeJob
): SortableActivity {
  return {
    key: `feedback-${feedback.uuid}`,
    occurredAt: feedback.received_at,
    positionLabel: jobPositionLabel(job),
    type: 'node.feedback',
    nodeId: job.workflow_node_uuid,
    detail: {
      projection_kind: 'authoritative_feedback',
      workflow_node_job_uuid: feedback.workflow_node_job_uuid,
      feedback_sequence: feedback.sequence,
      feedback_type: feedback.feedback_type,
      feedback: feedback.data,
      observed_at: feedback.observed_at,
      received_at: feedback.received_at
    },
    tieBreakOrder: 2
  }
}

function jobPositionLabel(job: WorkflowNodeJob): string {
  const step = `步骤 ${job.topological_index + 1}`
  return job.attempt > 1 ? `${step} · 第 ${job.attempt} 次` : step
}

function taskDetail(
  task: WorkflowTask,
  timeBasis?: 'update_time'
): Record<string, unknown> {
  return compactDetail({
    projection_kind: 'authoritative_task_snapshot',
    status: task.status,
    run_mode: task.run_mode,
    control_status: task.control_status,
    cleanup_status: task.cleanup_status,
    input: task.input,
    output: task.output,
    error_info: task.error_info,
    create_time: task.create_time,
    update_time: task.update_time,
    started_at: task.started_at,
    finished_at: task.finished_at,
    time_basis: timeBasis
  })
}

function jobDetail(
  job: WorkflowNodeJob,
  timeBasis?: 'update_time'
): Record<string, unknown> {
  return compactDetail({
    projection_kind: 'authoritative_job_snapshot',
    workflow_node_job_uuid: job.uuid,
    status: job.status,
    executor_kind: job.executor_kind,
    attempt: job.attempt,
    param: job.param,
    feedback_data: job.feedback_data,
    return_info: job.return_info,
    error_info: job.error_info,
    create_time: job.create_time,
    update_time: job.update_time,
    started_at: job.started_at,
    finished_at: job.finished_at,
    time_basis: timeBasis
  })
}

function compactDetail(
  detail: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(detail).filter(([, value]) => value !== undefined)
  )
}

function compareActivity(
  left: SortableActivity,
  right: SortableActivity
): number {
  const chronological = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
  if (chronological !== 0) return chronological
  if (left.tieBreakOrder !== right.tieBreakOrder) {
    return left.tieBreakOrder - right.tieBreakOrder
  }
  return left.key.localeCompare(right.key)
}

function isTerminalTaskStatus(status: WorkflowTaskStatus): boolean {
  return status === 'succeeded' || status === 'failed' ||
    status === 'canceled' || status === 'timeout'
}

function taskTerminalActivityType(status: WorkflowTaskStatus): string {
  if (status === 'succeeded') return 'run.completed'
  if (status === 'canceled') return 'run.canceled'
  if (status === 'timeout') return 'run.timeout'
  return 'run.failed'
}

function isTerminalJobStatus(status: WorkflowNodeJob['status']): boolean {
  return status === 'succeeded' || status === 'failed' ||
    status === 'skipped' || status === 'canceled' || status === 'timeout'
}

function jobTerminalActivityType(status: WorkflowNodeJob['status']): string {
  if (status === 'succeeded') return 'node.result'
  if (status === 'skipped') return 'node.skipped'
  if (status === 'canceled') return 'node.canceled'
  if (status === 'timeout') return 'node.timeout'
  return 'node.exception'
}

function jobCurrentActivityType(status: WorkflowNodeJob['status']): string {
  if (status === 'dispatched') return 'node.dispatched'
  if (status === 'intervention_required') return 'node.intervention_required'
  if (status === 'cancel_requested') return 'node.cancel_requested'
  if (status === 'execution_unknown') return 'node.execution_unknown'
  return 'node.status'
}
