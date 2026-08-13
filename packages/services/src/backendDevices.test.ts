import { describe, expect, it, vi } from 'vitest'

import type { HttpClient } from './http'
import {
  loadBackendActionSchema,
  loadBackendDeviceCatalog,
  loadBackendOnlineDevices
} from './backendDevices'

describe('Backend 设备目录 adapter', () => {
  it('以设备物料 UUID 为设备身份并保留 Edge 绑定身份', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: [rawBackendDevice()]
    })

    await expect(
      loadBackendDeviceCatalog(mockHttp(request))
    ).resolves.toEqual([{
      deviceId: 'material-pump',
      materialUuid: 'material-pump',
      definition: null,
      definitionFqid: null,
      deviceTypeId: 'template-pump',
      deviceKey: 'pump-01',
      namespace: 'edge-01',
      label: '主泵',
      online: true,
      actions: [{
        actionName: 'dispense',
        actionRef: 'material-pump.dispense',
        label: 'dispense',
        typeName: 'device_action',
        inputSchema: {},
        outputSchema: {},
        riskLevel: 'normal',
        isBusy: false
      }]
    }])
    expect(request).toHaveBeenCalledWith('/api/v1/devices', {
      signal: undefined
    })
  })

  it('用 dispatchable 表达 Backend 可调度在线状态', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: [{ ...rawBackendDevice(), dispatchable: false }]
    })

    await expect(
      loadBackendOnlineDevices(mockHttp(request))
    ).resolves.toMatchObject([{
      id: 'material-pump',
      materialUuid: 'material-pump',
      online: false,
      actions: [{
        actionName: 'dispense',
        schema: { type: 'object', properties: {} },
        currentJobId: null
      }]
    }])
  })

  it('不推断 Backend 未在设备目录声明的动作输入参数', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: [rawBackendDevice()]
    })

    await expect(loadBackendActionSchema(
      mockHttp(request),
      'material-pump',
      'dispense'
    )).resolves.toEqual({
      schema: { type: 'object', properties: {} },
      goalDefault: {},
      actionType: 'device_action',
      isBusy: false,
      currentJobId: null
    })
  })

  it('拒绝缺失设备物料身份的 Backend 响应', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: [{
        ...rawBackendDevice(),
        material: { resource_template_uuid: 'template-pump' }
      }]
    })

    await expect(
      loadBackendDeviceCatalog(mockHttp(request))
    ).rejects.toMatchObject({
      code: 'INVALID_BACKEND_DEVICE_CATALOG'
    })
  })
})

/** 返回一条符合 Backend DeviceOverview 合同的测试记录。 */
function rawBackendDevice(): Record<string, unknown> {
  return {
    binding: {
      uuid: 'binding-pump',
      edge_uuid: 'edge-01',
      material_uuid: 'material-pump',
      local_id: 'pump-01',
      name: 'Pump 01'
    },
    material: {
      uuid: 'material-pump',
      resource_template_uuid: 'template-pump',
      name: '主泵'
    },
    edge_status: 'online',
    dispatchable: true,
    actions: [{ name: 'dispense', type: 'device_action' }]
  }
}

/**
 * 创建 Backend 设备 adapter 使用的 HTTP 测试替身。
 *
 * @param request Vitest 请求桩。
 * @returns 只包含 request 边界的 HttpClient。
 */
function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return { request }
}
