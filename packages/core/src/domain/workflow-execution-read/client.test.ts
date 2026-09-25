import { describe, expect, it } from 'vitest'
import { WorkflowExecutionReadClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('WorkflowExecutionReadClient', () => {
  it('reads task detail and jobs through the generic transport', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        if (request.url.startsWith('/api/v1/workflow-tasks?')) {
          return {
            status: 200,
            headers: {},
            data: {
              items: [{
                uuid: 'task-1', workflow_uuid: 'workflow-1', execution_kind: 'workflow',
                status: 'running', run_mode: 'normal', control_status: 'active',
                cleanup_status: 'none', create_time: '2026-09-24T00:00:00Z',
                update_time: '2026-09-24T00:01:00Z'
              }],
              total: 1, page: 2, page_size: 10, has_more: false
            } as Value
          }
        }
        if (request.url.endsWith('/jobs')) {
          return {
            status: 200,
            headers: {},
            data: {
              items: [{
                uuid: 'job-1',
                workflow_node_uuid: 'node-1',
                topological_index: 0,
                executor_kind: 'device',
                status: 'execution_unknown',
                attempt: 1,
                current_attempt: true,
                control_data: {},
                error_info: [],
                wait_reason: {},
                expected_change_set: {}
              }]
            } as Value
          }
        }
        if (request.url.includes('/workflow-node-jobs/') && request.url.includes('/feedback?')) {
          return {
            status: 200,
            headers: {},
            data: {
              items: [{
                uuid: 'feedback-1',
                workflow_node_job_uuid: 'job-1',
                sequence: 1,
                feedback_type: 'progress',
                data: { percent: 50 },
                observed_at: '2026-09-24T00:02:00Z',
                received_at: '2026-09-24T00:02:01Z',
                idempotency_key: 'feedback-1'
              }],
              has_more: false,
              page: 1,
              page_size: 500
            } as Value
          }
        }
        if (request.url.includes('/workflow-node-jobs/')) {
          return {
            status: 200,
            headers: {},
            data: {
              uuid: 'job-1',
              workflow_task_uuid: 'task-1',
              workflow_node_uuid: 'node-1',
              executor_kind: 'device',
              status: 'execution_unknown',
              attempt: 1,
              uncertainty_reason: 'device acknowledgement missing',
              param: { duration: 5 },
              return_info: {},
              feedback_data: {},
              control_data: {},
              error_info: []
            } as Value
          }
        }
        return {
          status: 200,
          headers: {},
          data: {
            uuid: 'task-1',
            workflow_uuid: 'workflow-1',
            execution_kind: 'workflow',
            status: 'running',
            run_mode: 'normal',
            control_status: 'none',
            cleanup_status: 'not_started',
            create_time: '2026-09-24T00:00:00Z',
            update_time: '2026-09-24T00:01:00Z'
          } as Value
        }
      }
    }

    const client = new WorkflowExecutionReadClient(transport)
    const taskPage = await client.listTasks({
      page: 2,
      pageSize: 10,
      workflowUuid: 'workflow-1',
      status: 'running'
    })
    const task = await client.getTaskDetail('task/1')
    const jobs = await client.listTaskJobs('task/1')
    const detail = await client.getNodeJobDetail('job/1')
    const feedback = await client.listNodeJobFeedback('job-1', { afterSequence: 0, limit: 50 })

    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/workflow-tasks?page=2&page_size=10&workflow_uuid=workflow-1&status=running',
      '/api/v1/workflow-tasks/task%2F1',
      '/api/v1/workflow-tasks/task%2F1/jobs',
      '/api/v1/workflow-node-jobs/job%2F1',
      '/api/v1/workflow-node-jobs/job-1/feedback?page=1&page_size=500'
    ])
    expect(taskPage).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 10,
      hasMore: false,
      items: [{ taskUuid: 'task-1' }]
    })
    expect(task.status).toBe('running')
    expect(jobs[0]?.status).toBe('execution_unknown')
    expect(detail).toMatchObject({
      jobUuid: 'job-1',
      status: 'execution_unknown',
      uncertaintyReason: 'device acknowledgement missing',
      param: { duration: 5 }
    })
    expect(feedback).toMatchObject({
      nextCursor: 1,
      items: [{ feedbackUuid: 'feedback-1', sequence: 1 }]
    })
  })
})
