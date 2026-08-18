import { describe, expect, it, vi } from 'vitest'

import {
  catalogResponses,
  resourceTemplateUuid
} from './workflow-action-catalog.fixtures'
import type { HttpClient } from './http'
import {
  loadBackendActionSchema,
  loadBackendDeviceCatalog,
  loadBackendOnlineDevices
} from './backendDevices'

const materialUuid = '50000000-0000-4000-8000-000000000001'

describe('Backend 设备目录 adapter', () => {
  /** 证明 DeviceOverview 负责实例身份，WorkflowNodeTemplate 负责动作参数合同。 */
  it('组合设备实例、Edge 绑定与动作模板 schema', async () => {
    const { http, request } = fixture()

    await expect(loadBackendDeviceCatalog(http)).resolves.toEqual([{
      deviceId: materialUuid,
      materialUuid,
      resourceTemplateUuid,
      deviceTypeId: resourceTemplateUuid,
      deviceKey: 'pump-01',
      namespace: 'edge-01',
      label: '主泵',
      online: true,
      edgeStatus: 'online',
      dispatchable: true,
      dispatchBlockReason: null,
      executionOccupancies: null,
      actions: [{
        actionName: 'transfer.sample.v1',
        actionRef: `${materialUuid}.transfer.sample.v1`,
        label: '转移样品',
        typeName: 'UniLabJsonCommand',
        inputSchema: {
          sample: { $slot: 'ResourceSlot' },
          mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' }
        },
        outputSchema: { sample: { $slot: 'ResourceSlot' } },
        riskLevel: 'normal',
        isBusy: false
      }]
    }])
    expect(request).toHaveBeenCalledWith('/api/v1/devices', {
      signal: undefined
    })
  })

  /** 证明 Edge 在线与调度可用性是两个独立事实。 */
  it('不会把在线但派发受阻的设备误报为离线', async () => {
    const { http } = fixture({ edge_status: 'online', dispatchable: false })

    await expect(loadBackendOnlineDevices(http)).resolves.toMatchObject([{
      id: materialUuid,
      materialUuid,
      resourceTemplateUuid,
      online: true,
      edgeStatus: 'online',
      dispatchable: false,
      actions: [{
        actionName: 'transfer.sample.v1',
        displayName: '转移样品',
        schema: expect.objectContaining({ type: 'object' }),
        currentJobId: null
      }]
    }])
  })

  /** 证明 Edge 既有动作汇总会补齐动作占用，而不要求修改 OS 协议。 */
  it('在 Edge 环境兼容动作 busy 与 current_job_id 字段', async () => {
    const responses = fixtureResponses()
    responses['/api/v1/actions'] = {
      code: 0,
      data: {
        devices: {
          'pump-01': {
            actions: {
              'transfer.sample.v1': {
                is_busy: true,
                current_job_id: 'job-active-1234'
              }
            }
          }
        }
      }
    }

    await expect(loadBackendOnlineDevices(
      mockHttp(responses).http,
      undefined,
      'edge'
    )).resolves.toMatchObject([{
      online: true,
      executionOccupancies: null,
      actions: [{
        isBusy: true,
        busyStatusKnown: true,
        currentJobId: 'job-active-1234'
      }]
    }])
  })

  /** 证明 Edge 动作汇总暂不可用时，设备目录仍可展示且占用状态保持未知。 */
  it('Edge 动作状态不可用时不阻塞设备列表', async () => {
    await expect(loadBackendOnlineDevices(
      mockHttp(fixtureResponses()).http,
      undefined,
      'edge'
    )).resolves.toMatchObject([{
      executionOccupancies: null,
      actions: [{
        isBusy: false,
        busyStatusKnown: false,
        currentJobId: null
      }]
    }])
  })

  it('保留派发阻断原因与持久设备执行占用持有者', async () => {
    const responses = fixtureResponses()
    responses['/api/v1/devices'] = {
      code: 0,
      data: [{
        ...rawDevice(),
        dispatchable: false,
        binding: {
          ...rawDevice().binding as Record<string, unknown>,
          dispatch_block_reason: 'unresolved_unknown_command:workflow-node-job:old-job'
        },
        execution_occupancies: [{
          lease_uuid: '70000000-0000-4000-8000-000000000001',
          workflow_task_uuid: '80000000-0000-4000-8000-000000000001',
          workflow_node_job_uuid: '90000000-0000-4000-8000-000000000001',
          state: 'uncertain',
          acquired_at: '2026-08-16T08:00:00Z'
        }]
      }]
    }

    await expect(
      loadBackendOnlineDevices(mockHttp(responses).http)
    ).resolves.toMatchObject([{
      online: true,
      dispatchable: false,
      dispatchBlockReason: 'unresolved_unknown_command:workflow-node-job:old-job',
      executionOccupancies: [{
        leaseUuid: '70000000-0000-4000-8000-000000000001',
        workflowTaskUuid: '80000000-0000-4000-8000-000000000001',
        workflowNodeJobUuid: '90000000-0000-4000-8000-000000000001',
        state: 'uncertain'
      }]
    }])
  })

  it('从唯一匹配的节点模板读取 Action schema 与默认值', async () => {
    const { http } = fixture()

    await expect(loadBackendActionSchema(
      http,
      materialUuid,
      'transfer.sample.v1'
    )).resolves.toMatchObject({
      schema: expect.objectContaining({
        'x-unilabos-action-contract': expect.objectContaining({ version: 1 })
      }),
      goalDefault: { mode: 'safe' },
      actionType: 'UniLabJsonCommand',
      isBusy: false,
      currentJobId: null
    })
  })

  it('拒绝缺失设备物料身份的 DeviceOverview', async () => {
    const responses = fixtureResponses()
    responses['/api/v1/devices'] = {
      code: 0,
      data: [{
        ...rawDevice(),
        material: { resource_template_uuid: resourceTemplateUuid }
      }]
    }

    await expect(
      loadBackendDeviceCatalog(mockHttp(responses).http)
    ).rejects.toMatchObject({ code: 'INVALID_BACKEND_DEVICE_CATALOG' })
  })
})

/** 构造一组同 Authority 的设备与动作模板响应。 */
function fixture(overrides: Record<string, unknown> = {}): {
  http: HttpClient
  request: ReturnType<typeof vi.fn>
} {
  const responses = fixtureResponses()
  responses['/api/v1/devices'] = {
    code: 0,
    data: [{ ...rawDevice(), ...overrides }]
  }
  return mockHttp(responses)
}

function fixtureResponses(): Record<string, unknown> {
  return {
    ...catalogResponses(),
    '/api/v1/devices': { code: 0, data: [rawDevice()] }
  }
}

/** 返回一条符合 Backend DeviceOverview 合同的测试记录。 */
function rawDevice(): Record<string, unknown> {
  return {
    binding: {
      uuid: '60000000-0000-4000-8000-000000000001',
      edge_uuid: 'edge-01',
      material_uuid: materialUuid,
      local_id: 'pump-01',
      name: 'Pump 01',
      dispatch_block_reason: ''
    },
    material: {
      uuid: materialUuid,
      resource_template_uuid: resourceTemplateUuid,
      name: '主泵'
    },
    edge_status: 'online',
    dispatchable: true,
    actions: [{ name: 'transfer.sample.v1', type: 'UniLabJsonCommand' }]
  }
}

/** 创建按路径返回冻结 fixture 的 HTTP 客户端。 */
function mockHttp(responses: Record<string, unknown>): {
  http: HttpClient
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn()
  const http: HttpClient = {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> => {
      request(path, init)
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`)
      return responses[path] as ResponseValue
    }
  }
  return { http, request }
}
