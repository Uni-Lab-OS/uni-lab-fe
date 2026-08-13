import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import { createLaboratoryService } from './laboratory'
import { getDefaultBackend } from './backends'

describe('laboratory service', () => {
  it('uses the Backend root health route', async () => {
    const requests: Array<{ path: string; method?: string; body?: string }> = []
    const service = createLaboratoryService(
      fixtureHttp({ '/health': { status: 'ok' } }, requests),
      getDefaultBackend('local-go')
    )

    await expect(service.ping()).resolves.toBe(true)
    expect(requests).toEqual([{
      path: '/health',
      method: undefined,
      body: undefined
    }])
  })

  it('preserves Edge device metadata from the unified device catalog', async () => {
    const requests: Array<{
      path: string
      method?: string
      body?: string
    }> = []
    const http = fixtureHttp(
      {
        '/api/v1/devices': {
          code: 0,
          data: {
            schemaVersion: 'device-catalog/v2',
            source: 'edge',
            generatedAt: 123,
            items: [
              {
                id: 'pump-1',
                materialUuid: '10000000-0000-4000-8000-000000000001',
                deviceTypeId: 'community.review_lab.pump',
                definition: packageDefinition(),
                deviceKey: '/cell/pump-1',
                namespace: '/cell',
                name: '蠕动泵',
                online: false,
                actions: [
                  {
                    id: 'aspirate',
                    actionRef: 'pump-1.aspirate',
                    name: '吸液',
                    typeName: 'unilabos_msgs.action.Pump',
                    riskLevel: 'dangerous',
                    inputSchema: {
                      volume: { type: 'number', default: 10 }
                    },
                    outputSchema: {},
                    busy: true,
                    currentJobId: 'job-aspirate'
                  }
                ]
              }
            ]
          }
        }
      },
      requests
    )
    const service = createLaboratoryService(
      http,
      getDefaultBackend('local-python')
    )

    await expect(service.getOnlineDevices()).resolves.toEqual([
      {
        id: 'pump-1',
        materialUuid: '10000000-0000-4000-8000-000000000001',
        deviceKey: '/cell/pump-1',
        namespace: '/cell',
        machineName: '蠕动泵',
        online: false,
        actions: [
          expect.objectContaining({
            actionName: 'aspirate',
            actionRef: 'pump-1.aspirate',
            typeName: 'unilabos_msgs.action.Pump',
            riskLevel: 'dangerous',
            isBusy: true,
            currentJobId: 'job-aspirate'
          })
        ]
      }
    ])
    await expect(service.getDeviceCatalog()).resolves.toEqual([
      {
        deviceId: 'pump-1',
        materialUuid: '10000000-0000-4000-8000-000000000001',
        definition: packageDefinition(),
        definitionFqid: 'community.review_lab.pump',
        deviceTypeId: 'community.review_lab.pump',
        deviceKey: '/cell/pump-1',
        namespace: '/cell',
        label: '蠕动泵',
        online: false,
        actions: [
          {
            actionName: 'aspirate',
            actionRef: 'pump-1.aspirate',
            label: '吸液',
            typeName: 'unilabos_msgs.action.Pump',
            riskLevel: 'dangerous',
            inputSchema: { volume: { type: 'number', default: 10 } },
            outputSchema: {},
            isBusy: true
          }
        ]
      }
    ])
    expect(requests).toEqual([
      {
        path: '/api/v1/devices',
        method: undefined,
        body: undefined
      },
      {
        path: '/api/v1/devices',
        method: undefined,
        body: undefined
      }
    ])
  })

  it('缺少定义时不再把运行时实例 ID 回退成设备定义', async () => {
    /** 证明 Core #147 的 runtime instance 与 definition identity 始终分离。 */
    const service = createLaboratoryService(
      fixtureHttp({
        '/api/v1/devices': {
          code: 0,
          data: {
            schemaVersion: 'device-catalog/v1',
            items: [{
              id: 'pump-1',
              deviceKey: '/cell/pump-1',
              namespace: '/cell',
              name: '遗留泵',
              online: false,
              actions: []
            }]
          }
        }
      }),
      getDefaultBackend('local-python')
    )

    await expect(service.getDeviceCatalog()).resolves.toEqual([
      expect.objectContaining({
        deviceId: 'pump-1',
        definition: null,
        definitionFqid: null,
        deviceTypeId: ''
      })
    ])
  })

  it('拒绝不完整的设备定义来源证据', async () => {
    /** 证明半结构化定义不会被静默接受或降级成规范领域设备包。 */
    const service = createLaboratoryService(
      fixtureHttp({
        '/api/v1/devices': {
          code: 0,
          data: {
            schemaVersion: 'device-catalog/v2',
            items: [{
              id: 'pump-1',
              deviceTypeId: 'community.review_lab.pump',
              definition: { fqid: 'community.review_lab.pump' },
              actions: []
            }]
          }
        }
      }),
      getDefaultBackend('local-python')
    )

    await expect(service.getDeviceCatalog()).rejects.toMatchObject({
      code: 'INVALID_DEVICE_DEFINITION_PROVENANCE',
      retryable: false
    })
  })

  it('projects Action devices and schemas from the unified device catalog', async () => {
    const http = fixtureHttp({
      '/api/v1/devices': {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          generatedAt: 123,
          items: [
            {
              id: 'pump-1',
              deviceKey: '/cell/pump-1',
              namespace: '/cell',
              name: '蠕动泵',
              online: true,
              actions: [
                {
                  id: 'aspirate',
                  actionRef: 'pump-1.aspirate',
                  name: '吸液',
                  typeName: 'unilabos_msgs.action.Pump',
                  inputSchema: {
                    volume: { type: 'number', default: 10 }
                  },
                  outputSchema: {},
                  busy: true
                },
                {
                  id: 'dispense',
                  actionRef: 'pump-1.dispense',
                  name: '排液',
                  typeName: 'unilabos_msgs.action.Pump',
                  inputSchema: {
                    volume: { type: 'number', default: 2 }
                  },
                  outputSchema: {},
                  busy: false
                }
              ]
            }
          ]
        }
      }
    })
    const service = createLaboratoryService(
      http,
      getDefaultBackend('local-python')
    )

    await expect(service.getActionDevices()).resolves.toEqual([
      { deviceId: 'pump-1', label: 'pump-1' }
    ])
    await expect(service.getDeviceActions('pump-1')).resolves.toMatchObject([
      {
        actionName: 'aspirate',
        actionRef: 'pump-1.aspirate',
        displayName: '吸液',
        label: '吸液',
        typeName: 'unilabos_msgs.action.Pump',
        isBusy: true,
        currentJobId: null,
        schema: {
          type: 'object',
          properties: {
            volume: { type: 'number', default: 10 }
          }
        }
      },
      {
        actionName: 'dispense',
        actionRef: 'pump-1.dispense',
        displayName: '排液',
        label: '排液',
        typeName: 'unilabos_msgs.action.Pump',
        isBusy: false,
        currentJobId: null,
        schema: {
          type: 'object',
          properties: {
            volume: { type: 'number', default: 2 }
          }
        }
      }
    ])
    await expect(service.getOnlineDevices()).resolves.toMatchObject([
      {
        id: 'pump-1',
        online: true,
        actions: [
          { actionRef: 'pump-1.aspirate' },
          { actionRef: 'pump-1.dispense' }
        ]
      }
    ])
    await expect(
      service.getActionSchema('pump-1', 'aspirate')
    ).resolves.toMatchObject({
      goalDefault: { volume: 10 },
      actionType: 'unilabos_msgs.action.Pump',
      isBusy: true
    })
  })

  it('fails closed when Edge reports an unknown Action risk level', async () => {
    const service = createLaboratoryService(
      fixtureHttp({
        '/api/v1/devices': {
          code: 0,
          data: {
            schemaVersion: 'device-catalog/v1',
            items: [{
              id: 'heater-1',
              deviceKey: '/devices/heater-1',
              namespace: '/devices',
              name: '加热器',
              online: true,
              actions: [{
                id: 'heat',
                actionRef: 'heater-1.heat',
                name: '加热',
                typeName: 'UniLabJsonCommand',
                riskLevel: 'critical',
                inputSchema: {},
                outputSchema: {}
              }]
            }]
          }
        }
      }),
      getDefaultBackend('local-python')
    )

    await expect(service.getDeviceCatalog()).rejects.toMatchObject({
      code: 'INVALID_ACTION_RISK_LEVEL'
    })
  })

  it('does not expose the retired direct Action Run transport', () => {
    const service = createLaboratoryService(
      fixtureHttp({}),
      getDefaultBackend('local-python')
    )

    for (const retiredMethod of [
      'addJob',
      'getJobStatus',
      'cancelJob'
    ]) {
      expect(retiredMethod in service).toBe(false)
    }
  })

  it('uses the holder token for an operator-confirmed Action unlock', async () => {
    const requests: Array<{
      path: string
      method?: string
      body?: string
    }> = []
    const service = createLaboratoryService(
      fixtureHttp(
        {
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
        },
        requests
      ),
      getDefaultBackend('local-python')
    )

    await expect(
      service.forceUnlockDeviceAction({
        deviceId: 'robot 1',
        actionName: 'move/safe',
        expectedJobId: 'job-active'
      })
    ).resolves.toEqual({
      status: 'unlocked',
      deviceId: 'robot 1',
      actionName: 'move/safe',
      releasedJobIds: ['job-active', 'job-queued'],
      cancelRequestedJobIds: ['job-active']
    })
    expect(requests).toEqual([
      {
        path: '/api/v1/devices/robot%201/actions/move%2Fsafe/commands',
        method: 'POST',
        body: JSON.stringify({
          command: 'force_unlock',
          expectedJobId: 'job-active',
          reason: 'operator_confirmed_device_safe'
        })
      }
    ])
  })

  it('probes the production Edge/OS through its unified v1 health route', async () => {
    const requests: Array<{
      path: string
      method?: string
      body?: string
    }> = []
    const service = createLaboratoryService(
      fixtureHttp({ '/api/v1/health': { status: 'ok' } }, requests),
      getDefaultBackend('local-python')
    )

    await expect(service.ping()).resolves.toBe(true)
    expect(requests).toEqual([
      {
        path: '/api/v1/health',
        method: undefined,
        body: undefined
      }
    ])
  })

  it('forwards caller cancellation to managed health and device reads', async () => {
    const controller = new AbortController()
    const observedSignals: Array<AbortSignal | null> = []
    const http: HttpClient = {
      request: async <ResponseValue>(
        path: string,
        init?: RequestInit
      ): Promise<ResponseValue> => {
        observedSignals.push(init?.signal ?? null)
        return (path === '/api/v1/health'
          ? { status: 'ok' }
          : {
              code: 0,
              data: { schemaVersion: 'device-catalog/v1', items: [] }
            }) as ResponseValue
      }
    }
    const service = createLaboratoryService(
      http,
      getDefaultBackend('local-python')
    )

    await service.ping(controller.signal)
    await service.getOnlineDevices(controller.signal)

    expect(observedSignals).toEqual([
      controller.signal,
      controller.signal
    ])
  })
})

/** 返回一份与 Core #147 PackageCatalog v1 一致的设备定义来源证据。 */
function packageDefinition(): Record<string, unknown> {
  return {
    fqid: 'community.review_lab.pump',
    version: '1.0.0',
    contentHash: `sha256:${'1'.repeat(64)}`,
    sourceIdentity: 'review_lab.devices.pump:Pump',
    title: '蠕动泵',
    description: '测试设备定义',
    category: ['liquid_handling'],
    manufacturer: 'Uni-Lab',
    packageCatalog: {
      schemaVersion: '1',
      distribution: {
        name: 'review-lab',
        normalizedName: 'review_lab',
        version: '0.1.0'
      },
      importPackage: 'review_lab',
      namespace: 'community.review_lab',
      contentDigest: `sha256:${'2'.repeat(64)}`,
      catalogDigest: `sha256:${'3'.repeat(64)}`
    }
  }
}

function fixtureHttp(
  responses: Record<string, unknown>,
  requests: Array<{
    path: string
    method?: string
    body?: string
  }> = []
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
