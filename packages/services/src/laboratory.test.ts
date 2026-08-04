import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import { createLaboratoryService } from './laboratory'
import { getDefaultBackend } from './backends'

describe('laboratory service', () => {
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
            schemaVersion: 'device-catalog/v1',
            source: 'edge',
            generatedAt: 123,
            items: [
              {
                id: 'pump-1',
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
        deviceKey: '/cell/pump-1',
        namespace: '/cell',
        machineName: '蠕动泵',
        online: false,
        actions: [
          expect.objectContaining({
            actionName: 'aspirate',
            actionRef: 'pump-1.aspirate',
            typeName: 'unilabos_msgs.action.Pump',
            isBusy: true,
            currentJobId: 'job-aspirate'
          })
        ]
      }
    ])
    await expect(service.getDeviceCatalog()).resolves.toEqual([
      {
        deviceId: 'pump-1',
        deviceTypeId: 'pump-1',
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
