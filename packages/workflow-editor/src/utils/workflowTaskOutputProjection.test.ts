import type {
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowTaskRuntimeEvent
} from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  projectWorkflowTaskEvents,
  projectWorkflowTaskJob
} from './workflowTaskOutputProjection'

const job: WorkflowNodeJob = {
  uuid: 'job-transfer',
  create_time: '2026-08-03T06:00:00Z',
  update_time: '2026-08-03T06:00:03Z',
  meta_data: {},
  workflow_task_uuid: 'task-1',
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

describe('workflow Task output projection', () => {
  it('keeps complete Job dispatch, result, and timing evidence', () => {
    expect(projectWorkflowTaskJob(job).result).toMatchObject({
      param: { source: 'tube-a', target: 'plate-a' },
      return_info: { completed: true, transferred_ul: 50 },
      create_time: '2026-08-03T06:00:00Z',
      update_time: '2026-08-03T06:00:03Z',
      started_at: '2026-08-03T06:00:01Z',
      finished_at: '2026-08-03T06:00:03Z'
    })
  })

  it('projects the durable journal into readable dispatch and result events', () => {
    const events: WorkflowTaskRuntimeEvent[] = [
      {
        sequence: 42,
        workflow_task_uuid: 'task-1',
        workflow_node_job_uuid: job.uuid,
        workflow_node_uuid: job.workflow_node_uuid,
        kind: 'job_transition',
        from_status: 'pending',
        to_status: 'dispatched',
        data: { reason: 'dependencies_satisfied' },
        create_time: '2026-08-03T06:00:01Z',
        executor_kind: 'action',
        attempt: 1,
        param: job.param
      },
      {
        sequence: 44,
        workflow_task_uuid: 'task-1',
        workflow_node_job_uuid: job.uuid,
        workflow_node_uuid: job.workflow_node_uuid,
        kind: 'job_transition',
        from_status: 'running',
        to_status: 'succeeded',
        data: {},
        create_time: '2026-08-03T06:00:03Z',
        executor_kind: 'action',
        attempt: 1,
        return_info: job.return_info,
        error_info: []
      }
    ]

    expect(projectWorkflowTaskEvents(events, [], [job])).toEqual([
      expect.objectContaining({
        key: 'runtime-42',
        seq: 42,
        type: 'node.dispatched',
        nodeId: 'transfer',
        detail: expect.objectContaining({
          param: job.param,
          from_status: 'pending',
          to_status: 'dispatched'
        })
      }),
      expect.objectContaining({
        key: 'runtime-44',
        seq: 44,
        type: 'node.result',
        nodeId: 'transfer',
        detail: expect.objectContaining({
          return_info: job.return_info,
          from_status: 'running',
          to_status: 'succeeded'
        })
      })
    ])
  })

  it('retains legacy per-Job feedback that has no journal event', () => {
    const feedback: WorkflowNodeJobFeedback = {
      uuid: 'feedback-3',
      create_time: '2026-08-03T06:00:02Z',
      update_time: '2026-08-03T06:00:02Z',
      meta_data: {},
      workflow_node_job_uuid: job.uuid,
      sequence: 3,
      feedback_type: 'progress',
      data: { percent: 50 },
      observed_at: '2026-08-03T06:00:02Z',
      received_at: '2026-08-03T06:00:02Z',
      idempotency_key: 'feedback-3'
    }

    expect(projectWorkflowTaskEvents([], [feedback], [job])).toEqual([
      {
        key: 'feedback-feedback-3',
        seq: 3,
        type: 'node.feedback',
        nodeId: 'transfer',
        detail: {
          feedback_type: 'progress',
          feedback: { percent: 50 },
          observed_at: '2026-08-03T06:00:02Z',
          received_at: '2026-08-03T06:00:02Z'
        }
      }
    ])
  })
})
