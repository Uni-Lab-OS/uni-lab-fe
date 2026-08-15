import type {
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowTask
} from '@unilab/services'
import { describe, expect, it } from 'vitest'

import { projectWorkflowTaskOutput } from './workflowTaskOutputProjection'

const task: WorkflowTask = {
  uuid: 'task-1',
  create_time: '2026-08-03T06:00:00Z',
  update_time: '2026-08-03T06:00:04Z',
  meta_data: {},
  workflow_uuid: 'workflow-1',
  status: 'succeeded',
  workflow_snapshot: {},
  execution_plan: {},
  run_mode: 'normal',
  control_status: 'active',
  cleanup_status: 'settled',
  trace_context: {},
  input: {},
  output: { completed: true },
  error_info: [],
  started_at: '2026-08-03T06:00:00Z',
  finished_at: '2026-08-03T06:00:04Z'
}

const job: WorkflowNodeJob = {
  uuid: 'job-transfer',
  create_time: '2026-08-03T06:00:00Z',
  update_time: '2026-08-03T06:00:03Z',
  meta_data: {},
  workflow_task_uuid: task.uuid,
  workflow_node_uuid: 'transfer',
  feedback_sequence: 0,
  topological_index: 1,
  executor_kind: 'action',
  execution_policy: {},
  execution_timeout_seconds: 60,
  status: 'succeeded',
  attempt: 1,
  param: { source: 'tube-a', target: 'plate-a' },
  feedback_data: {},
  return_info: { completed: true, transferred_ul: 50 },
  control_data: {},
  error_info: [],
  started_at: '2026-08-03T06:00:01Z',
  finished_at: '2026-08-03T06:00:03Z'
}

function feedback(
  uuid: string,
  observedAt: string,
  sequence: number
): WorkflowNodeJobFeedback {
  return {
    uuid,
    create_time: observedAt,
    update_time: observedAt,
    meta_data: {},
    workflow_node_job_uuid: job.uuid,
    sequence,
    feedback_type: 'progress',
    data: { sequence },
    observed_at: observedAt,
    received_at: observedAt,
    idempotency_key: uuid
  }
}

describe('工作流任务（WorkflowTask）输出投影', () => {
  it('returns node evidence and a chronological authoritative activity trace', () => {
    const projection = projectWorkflowTaskOutput({
      task,
      jobs: [job],
      feedback: []
    })

    expect(projection.nodes).toHaveLength(1)
    expect(projection.nodes[0]?.result).toMatchObject({
      param: job.param,
      return_info: job.return_info,
      started_at: job.started_at,
      finished_at: job.finished_at
    })
    expect(projection.activity.map((item) => ({
      type: item.type,
      occurredAt: item.occurredAt,
      positionLabel: item.positionLabel
    }))).toEqual([
      {
        type: 'run.created',
        occurredAt: task.create_time,
        positionLabel: '整体运行'
      },
      {
        type: 'run.started',
        occurredAt: task.started_at,
        positionLabel: '整体运行'
      },
      {
        type: 'node.started',
        occurredAt: job.started_at,
        positionLabel: '步骤 2'
      },
      {
        type: 'node.result',
        occurredAt: job.finished_at,
        positionLabel: '步骤 2'
      },
      {
        type: 'run.completed',
        occurredAt: task.finished_at,
        positionLabel: '整体运行'
      }
    ])
  })

  it('orders jobs by authoritative timestamps instead of topological position', () => {
    const earlierSecondStep: WorkflowNodeJob = {
      ...job,
      uuid: 'job-second-step',
      workflow_node_uuid: 'second-step',
      topological_index: 1,
      status: 'running',
      started_at: '2026-08-03T06:00:01Z',
      finished_at: undefined
    }
    const laterFirstStep: WorkflowNodeJob = {
      ...job,
      uuid: 'job-first-step',
      workflow_node_uuid: 'first-step',
      topological_index: 0,
      status: 'running',
      started_at: '2026-08-03T06:00:02Z',
      finished_at: undefined
    }

    const projection = projectWorkflowTaskOutput({
      task: { ...task, status: 'running', finished_at: undefined },
      jobs: [laterFirstStep, earlierSecondStep],
      feedback: []
    })

    expect(projection.activity
      .filter((item) => item.type === 'node.started')
      .map((item) => item.nodeId)
    ).toEqual(['second-step', 'first-step'])
  })

  it('orders feedback by OS receipt time when device clocks differ', () => {
    const otherJob = {
      ...job,
      uuid: 'job-other',
      workflow_node_uuid: 'other'
    }
    const receivedLater = {
      ...feedback('feedback-received-later', '2026-08-03T06:00:01Z', 1),
      received_at: '2026-08-03T06:00:03Z'
    }
    const receivedEarlier = {
      ...feedback('feedback-received-earlier', '2026-08-03T06:00:02Z', 1),
      workflow_node_job_uuid: otherJob.uuid,
      received_at: '2026-08-03T06:00:02Z'
    }

    const projection = projectWorkflowTaskOutput({
      task: null,
      jobs: [job, otherJob],
      feedback: [receivedLater, receivedEarlier]
    })

    expect(projection.activity
      .filter((item) => item.type === 'node.feedback')
      .map((item) => item.key)
    ).toEqual([
      'feedback-feedback-received-earlier',
      'feedback-feedback-received-later'
    ])
  })

  it('reports canceled jobs as canceled and never as successful', () => {
    const canceled = {
      ...job,
      status: 'canceled' as const,
      attempt: 2,
      return_info: {},
      finished_at: '2026-08-03T06:00:03Z'
    }

    const projection = projectWorkflowTaskOutput({
      task: null,
      jobs: [canceled],
      feedback: []
    })

    expect(projection.activity.at(-1)).toMatchObject({
      type: 'node.canceled',
      positionLabel: '步骤 2 · 第 2 次',
      detail: expect.objectContaining({ status: 'canceled' })
    })
    expect(projection.activity.some((item) => item.type === 'node.result'))
      .toBe(false)
  })

  it('does not invent activity for a pending job without timestamps', () => {
    const pending = {
      ...job,
      status: 'pending' as const,
      started_at: undefined,
      finished_at: undefined
    }

    expect(projectWorkflowTaskOutput({
      task: null,
      jobs: [pending],
      feedback: []
    }).activity).toEqual([])
  })
})
