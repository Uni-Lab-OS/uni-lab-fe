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

  /** 证明两种 Authority 都只用 dispatchable 表达当前可调度状态。 */
  it('用 dispatchable 表达可调度在线状态', async () => {
    const { http } = fixture({ dispatchable: false })

    await expect(loadBackendOnlineDevices(http)).resolves.toMatchObject([{
      id: materialUuid,
      materialUuid,
      resourceTemplateUuid,
      online: false,
      actions: [{
        actionName: 'transfer.sample.v1',
        displayName: '转移样品',
        schema: expect.objectContaining({ type: 'object' }),
        currentJobId: null
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
      name: 'Pump 01'
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
