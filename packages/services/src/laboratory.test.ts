import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import { createLaboratoryService } from './laboratory'
import { getDefaultBackend } from './backends'
import {
  catalogResponses,
  resourceTemplateUuid
} from './workflow-action-catalog.fixtures'

const materialUuid = '50000000-0000-4000-8000-000000000001'

describe('laboratory service', () => {
  /** 验证 Backend 与 Local Backend 都统一通过 v1 健康检查路径探测连接。 */
  it('uses the Backend v1 health route', async () => {
    const requests: Array<{ path: string; method?: string; body?: string }> = []
    const service = createLaboratoryService(
      fixtureHttp({ '/api/v1/health': { status: 'ok' } }, requests),
      getDefaultBackend('local-go')
    )

    await expect(service.ping()).resolves.toBe(true)
    expect(requests).toEqual([{
      path: '/api/v1/health',
      method: undefined,
      body: undefined
    }])
  })

  it.each(['local-python', 'local-go'])(
    'uses DeviceOverview plus WorkflowNodeTemplate for %s',
    async (backendId) => {
      const service = createLaboratoryService(
        fixtureHttp(sharedDeviceResponses()),
        getDefaultBackend(backendId)
      )

      await expect(service.getOnlineDevices()).resolves.toMatchObject([{
        id: materialUuid,
        materialUuid,
        resourceTemplateUuid,
        deviceKey: 'pump-01',
        namespace: 'edge-01',
        machineName: '主泵',
        online: true,
        actions: [{
          actionName: 'transfer.sample.v1',
          actionRef: `${materialUuid}.transfer.sample.v1`,
          displayName: '转移样品',
          typeName: 'UniLabJsonCommand',
          inputSchema: {
            sample: { $slot: 'ResourceSlot' },
            mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' }
          }
        }]
      }])
      await expect(service.getDeviceCatalog()).resolves.toMatchObject([{
        deviceId: materialUuid,
        resourceTemplateUuid,
        actions: [{
          label: '转移样品',
          outputSchema: { sample: { $slot: 'ResourceSlot' } }
        }]
      }])
      await expect(service.getActionDevices()).resolves.toEqual([
        { deviceId: materialUuid, label: '主泵' }
      ])
      await expect(service.getDeviceActions(materialUuid)).resolves.toMatchObject([
        { actionName: 'transfer.sample.v1', schema: { type: 'object' } }
      ])
      await expect(
        service.getActionSchema(materialUuid, 'transfer.sample.v1')
      ).resolves.toMatchObject({
        goalDefault: { mode: 'safe' },
        actionType: 'UniLabJsonCommand',
        isBusy: false
      })
    }
  )

  it('fails closed when Local returns a non-DeviceOverview catalog', async () => {
    const service = createLaboratoryService(
      fixtureHttp({
        ...catalogResponses(),
        '/api/v1/devices': {
          code: 0,
          data: { schemaVersion: 'device-catalog/v1', items: [] }
        }
      }),
      getDefaultBackend('local-python')
    )

    await expect(service.getDeviceCatalog()).rejects.toMatchObject({
      code: 'INVALID_BACKEND_DEVICE_CATALOG'
    })
  })

  it('does not expose the retired direct Action Run transport', () => {
    const service = createLaboratoryService(
      fixtureHttp({}),
      getDefaultBackend('local-python')
    )

    for (const retiredMethod of ['addJob', 'getJobStatus', 'cancelJob']) {
      expect(retiredMethod in service).toBe(false)
    }
  })

  it('uses the holder token for an operator-confirmed Action unlock', async () => {
    const requests: Array<{ path: string; method?: string; body?: string }> = []
    const service = createLaboratoryService(
      fixtureHttp({
        '/api/v1/devices/robot%201/actions/move%2Fsafe/commands': {
          code: 0,
          data: {
            status: 'unlocked',
            deviceId: 'robot 1',
            actionName: 'move/safe',
            releasedJobIds: ['job-active', 'job-queued'],
            cancelRequestedJobIds: ['job-active']
          }
        }
      }, requests),
      getDefaultBackend('local-python')
    )

    await expect(service.forceUnlockDeviceAction({
      deviceId: 'robot 1',
      actionName: 'move/safe',
      expectedJobId: 'job-active'
    })).resolves.toEqual({
      status: 'unlocked',
      deviceId: 'robot 1',
      actionName: 'move/safe',
      releasedJobIds: ['job-active', 'job-queued'],
      cancelRequestedJobIds: ['job-active']
    })
    expect(requests).toEqual([{
      path: '/api/v1/devices/robot%201/actions/move%2Fsafe/commands',
      method: 'POST',
      body: JSON.stringify({
        command: 'force_unlock',
        expectedJobId: 'job-active',
        reason: 'operator_confirmed_device_safe'
      })
    }])
  })

  it('forwards caller cancellation to every shared catalog read', async () => {
    const controller = new AbortController()
    const responses = sharedDeviceResponses()
    const observedSignals: Array<AbortSignal | null> = []
    const http: HttpClient = {
      request: async <ResponseValue>(
        path: string,
        init?: RequestInit
      ): Promise<ResponseValue> => {
        observedSignals.push(init?.signal ?? null)
        if (path === '/api/v1/health') return { status: 'ok' } as ResponseValue
        if (!(path in responses)) throw new Error(`Unexpected request: ${path}`)
        return responses[path] as ResponseValue
      }
    }
    const service = createLaboratoryService(
      http,
      getDefaultBackend('local-python')
    )

    await service.ping(controller.signal)
    await service.getOnlineDevices(controller.signal)

    expect(observedSignals.length).toBeGreaterThan(2)
    expect(new Set(observedSignals)).toEqual(new Set([controller.signal]))
  })
})

/** 构造与两种 Authority 共用的设备和动作模板响应。 */
function sharedDeviceResponses(): Record<string, unknown> {
  return {
    ...catalogResponses(),
    '/api/v1/devices': {
      code: 0,
      data: [{
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
      }]
    }
  }
}

function fixtureHttp(
  responses: Record<string, unknown>,
  requests: Array<{ path: string; method?: string; body?: string }> = []
): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> => {
      requests.push({
        path,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined
      })
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`)
      return responses[path] as ResponseValue
    }
  }
}
