import { describe, expect, it } from 'vitest'
import { WorkflowExecutionReadClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('WorkflowExecutionReadClient', () => {
  it('reads task detail and jobs through the generic transport', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
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
    const task = await client.getTaskDetail('task/1')
    const jobs = await client.listTaskJobs('task/1')

    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/workflow-tasks/task%2F1',
      '/api/v1/workflow-tasks/task%2F1/jobs'
    ])
    expect(task.status).toBe('running')
    expect(jobs[0]?.status).toBe('execution_unknown')
  })
})

