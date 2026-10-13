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

  it('serializes the debug unlock command as meta_data with an idempotency key', async () => {
    let request: TransportRequest | undefined
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        request = input
        return {
          status: 201,
          headers: {},
          data: {
            uuid: 'command-2',
            workflow_task_uuid: 'task-1',
            type: 'unlock_resources',
            status: 'pending',
            idempotency_key: 'idem-unlock',
          } as Value,
        }
      },
    }
    const receipt = await new WorkflowExecutionControlClient(transport).sendTaskCommand('task-1', {
      type: 'unlock_resources',
      idempotencyKey: 'idem-unlock',
      description: '任务已进入 failed 终态，确认物理安全后整组解锁',
      metadata: { source: 'developer-web', confirmed_physical_safe: true },
    })

    // 后端门禁要求 meta_data.confirmed_physical_safe === true 且 description 非空；
    // 线协议字段名必须是 meta_data，且整组解锁不带节点级目标。
    expect(request).toMatchObject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/task-1/commands',
      body: {
        type: 'unlock_resources',
        idempotency_key: 'idem-unlock',
        description: '任务已进入 failed 终态，确认物理安全后整组解锁',
        meta_data: { source: 'developer-web', confirmed_physical_safe: true },
      },
    })
    expect((request?.body as Record<string, unknown>).target_node_uuid).toBeUndefined()
    expect(receipt.lifecycle).toBe('accepted')
  })

  it('decodes a rejected command with its result reason instead of unknown lifecycle', async () => {
    const transport: RequestTransport = {
      async request<Value>(): Promise<TransportResponse<Value>> {
        return {
          status: 200,
          headers: {},
          data: {
            uuid: 'command-3',
            workflow_task_uuid: 'task-1',
            type: 'unlock_resources',
            status: 'rejected',
            idempotency_key: 'idem-3',
            result: { reason: 'task_is_not_abnormal_terminal' },
          } as Value,
        }
      },
    }
    const receipt = await new WorkflowExecutionControlClient(transport).sendTaskCommand('task-1', {
      type: 'unlock_resources',
      idempotencyKey: 'idem-3',
    })

    // HTTP 2xx 只说明 durable accepted；任务状态不在 {failed,canceled,timeout} 时
    // 后端拒绝命令，回执必须表达成 rejected 并把原因原样带出，不能落到 unknown。
    expect(receipt).toMatchObject({
      accepted: true,
      lifecycle: 'rejected',
      type: 'unlock_resources',
      statusCode: 200,
      result: { reason: 'task_is_not_abnormal_terminal' },
    })
  })
})
