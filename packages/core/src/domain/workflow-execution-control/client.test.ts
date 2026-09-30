import { describe, expect, it } from 'vitest'
import { WorkflowExecutionControlClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('WorkflowExecutionControlClient', () => {
  it('keeps durable accepted separate from applied', async () => {
    let request: TransportRequest | undefined
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        request = input
        return {
          status: 201,
          headers: {},
          data: {
            uuid: 'command-1',
            workflow_task_uuid: 'task-1',
            type: 'step',
            status: 'pending',
            idempotency_key: 'idem-1',
          } as Value,
        }
      },
    }
    const receipt = await new WorkflowExecutionControlClient(transport).sendTaskCommand('task-1', {
      type: 'step',
      targetNodeUuid: 'node-2',
      idempotencyKey: 'idem-1',
    })

    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/task-1/commands',
      body: { type: 'step', target_node_uuid: 'node-2', idempotency_key: 'idem-1' },
    })
    expect(receipt).toMatchObject({
      accepted: true,
      lifecycle: 'accepted',
      commandUuid: 'command-1',
      workflowTaskUuid: 'task-1',
    })
  })
})
