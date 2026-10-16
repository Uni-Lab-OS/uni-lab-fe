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

describe('WorkflowExecutionRecoveryClient task resource unlock', () => {
  const transportReturning = (data: unknown, seen: TransportRequest[]): RequestTransport => ({
    async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
      seen.push(input)
      return { status: 200, headers: {}, data: { code: 0, data } as Value }
    },
  })

  it('reads locks with the OS release eligibility', async () => {
    const seen: TransportRequest[] = []
    const client = new WorkflowExecutionRecoveryClient(
      {} as WorkflowExecutionReadPort,
      transportReturning(
        {
          task_status: 'canceled',
          active_device_tenancy_count: 0,
          locks: [
            {
              uuid: 'l1',
              lock_key: '/devices/a',
              scope: 'device',
              state: 'running',
              workflow_node_job_uuid: 'j1',
              job_status: 'failed',
              can_release: false,
              release_block_reason: '连续区间锁必须通过任务级人工解锁整组释放',
            },
          ],
        },
        seen,
      ),
    )
    const locks = await client.listTaskExecutionLocks('t1')
    expect(seen[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/workflow-tasks/t1/execution-locks',
    })
    expect(locks.locks[0]).toMatchObject({
      uuid: 'l1',
      scope: 'device',
      canRelease: false,
      jobStatus: 'failed',
    })
  })

  it('sends unlock_resources with physical-safe confirmation and surfaces OS rejection', async () => {
    const seen: TransportRequest[] = []
    const client = new WorkflowExecutionRecoveryClient(
      {} as WorkflowExecutionReadPort,
      transportReturning(
        { uuid: 'c1', status: 'rejected', result: { reason: '任务仍有已派发或运行中的作业' } },
        seen,
      ),
    )
    const receipt = await client.unlockTaskResources('t1', ' 板已取下 ', 'k1')
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/workflow-tasks/t1/commands',
      body: {
        type: 'unlock_resources',
        idempotency_key: 'k1',
        description: '板已取下',
        meta_data: { confirmed_physical_safe: true },
      },
    })
    expect(receipt).toMatchObject({
      status: 'rejected',
      rejectReason: '任务仍有已派发或运行中的作业',
    })
    await expect(client.unlockTaskResources('t1', '  ', 'k2')).rejects.toThrow('现场处置说明')
  })
})
