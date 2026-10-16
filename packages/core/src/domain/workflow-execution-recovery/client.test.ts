import { describe, expect, it } from 'vitest'
import { WorkflowExecutionRecoveryClient } from './client'
import type { WorkflowExecutionReadPort } from '../workflow-execution-read/port'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('WorkflowExecutionRecoveryClient.resolveUncertainJob', () => {
  it('posts only the canceled resolution with the operator reason and keeps the pending flag', async () => {
    let request: TransportRequest | undefined
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        request = input
        return {
          status: 202,
          headers: {},
          data: {
            code: 0,
            data: {
              resolution_command_uuid: 'cmd-1',
              pending_edge_confirmation: true,
              created: true,
            },
          } as Value,
        }
      },
    }
    const client = new WorkflowExecutionRecoveryClient({} as WorkflowExecutionReadPort, transport)
    const receipt = await client.resolveUncertainJob('job/1', '  现场确认未动作 ')
    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/v1/workflow-node-jobs/job%2F1/resolve-uncertain',
      body: { resolution: 'canceled', reason: '现场确认未动作' },
    })
    expect(receipt).toMatchObject({
      resolutionCommandUuid: 'cmd-1',
      pendingEdgeConfirmation: true,
      created: true,
    })
  })

  it('refuses an empty conclusion before calling the OS', async () => {
    const client = new WorkflowExecutionRecoveryClient({} as WorkflowExecutionReadPort, {
      request: async () => {
        throw new Error('不应调用')
      },
    })
    await expect(client.resolveUncertainJob('job-1', ' ')).rejects.toThrow('核对结论')
  })
})
