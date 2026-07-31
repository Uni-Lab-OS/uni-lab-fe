import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import { createLaboratoryService } from './laboratory'

describe('laboratory service', () => {
  it('projects the OS-owned Edge device catalog for card authoring', async () => {
    const service = createLaboratoryService(fixtureHttp({
      '/api/v1/devices': {
        schemaVersion: 'device-catalog/v1',
        items: [{
          id: 'robot',
          deviceKey: '/cell/robot',
          namespace: '/cell',
          name: '六轴机械臂',
          online: true,
          actions: [{
            id: 'move',
            actionRef: 'robot.move',
            name: '移动',
            typeName: 'UniLabJsonCommand',
            inputSchema: { target: { type: 'string', required: true } },
            outputSchema: { position: { type: 'string' } },
            busy: false
          }]
        }]
      }
    }))

    await expect(service.getDeviceCatalog()).resolves.toEqual([{
      deviceId: 'robot',
      deviceTypeId: 'robot',
      deviceKey: '/cell/robot',
      namespace: '/cell',
      label: '六轴机械臂',
      online: true,
      actions: [{
        actionName: 'move',
        actionRef: 'robot.move',
        label: '移动',
        typeName: 'UniLabJsonCommand',
        inputSchema: { target: { type: 'string', required: true } },
        outputSchema: { position: { type: 'string' } },
        isBusy: false
      }]
    }])
  })

  it('projects Action devices and schemas from the unified node catalog', async () => {
    const http = fixtureHttp({
      '/api/v1/workflow-node-templates': {
        schemaVersion: 'workflow-node-templates/v1',
        items: [
          {
            id: 'pump-1.aspirate',
            kind: 'action',
            label: '吸液',
            inputSchema: {
              volume: { type: 'number', default: 10 }
            },
            outputSchema: {}
          },
          {
            id: 'pump-1.dispense',
            kind: 'action',
            label: '排液',
            inputSchema: {
              volume: { type: 'number', default: 2 }
            },
            outputSchema: {}
          },
          {
            id: 'os_control.branch',
            kind: 'branch',
            label: '条件分支',
            inputSchema: {}
          }
        ]
      }
    })
    const service = createLaboratoryService(http)

    await expect(service.getActionDevices()).resolves.toEqual([
      { deviceId: 'pump-1', label: 'pump-1' }
    ])
    await expect(service.getDeviceActions('pump-1')).resolves.toEqual([
      {
        actionName: 'aspirate',
        label: '吸液',
        typeName: 'pump-1.aspirate',
        isBusy: false,
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
        label: '排液',
        typeName: 'pump-1.dispense',
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
    await expect(
      service.getActionSchema('pump-1', 'aspirate')
    ).resolves.toMatchObject({
      goalDefault: { volume: 10 },
      actionType: 'pump-1.aspirate'
    })
  })

  it('runs and cancels one Action through the unified runtime contract', async () => {
    const requests: Array<{
      path: string
      method?: string
      body?: string
    }> = []
    const http = fixtureHttp({
      '/api/v1/runtime/runs': {
        id: 'run-1',
        status: 'pending'
      },
      '/api/v1/runtime/runs/run-1': {
        id: 'run-1',
        status: 'failed'
      },
      '/api/v1/runtime/runs/run-1/nodes': {
        items: [
          {
            nodeId: 'action',
            state: 'failed',
            result: {
              error: 'Traceback: pump failed',
              info: ['started', 'stopped']
            }
          }
        ]
      },
      '/api/v1/runtime/runs/run-1/events?after_seq=0': {
        events: [
          {
            seq: 1,
            type: 'node_feedback',
            payload: { progress: 0.5 }
          }
        ],
        nextSeq: 1
      },
      '/api/v1/runtime/runs/run-1/cancel': {
        id: 'run-1',
        status: 'cancel_requested'
      }
    }, requests)
    const service = createLaboratoryService(http)

    await expect(service.addJob({
      deviceId: 'pump-1',
      action: 'aspirate',
      actionArgs: { volume: 12 }
    })).resolves.toMatchObject({
      jobId: 'run-1',
      status: 'pending'
    })

    const createBody = JSON.parse(requests[0].body ?? '{}')
    expect(createBody).toMatchObject({
      source: {
        format: 'workflow_revision_v2',
        revision: {
          schema_version: '2',
          workflow_id: 'single-action:pump-1',
          invocations: [
            {
              node_id: 'action',
              action_ref: 'pump-1.aspirate',
              input_bindings: {
                volume: { kind: 'literal', value: 12 }
              }
            }
          ],
          control_edges: []
        }
      }
    })

    await expect(service.getJobStatus('run-1')).resolves.toMatchObject({
      status: 'failed',
      result: {
        nodes: [
          {
            result: {
              error: 'Traceback: pump failed',
              info: ['started', 'stopped']
            }
          }
        ]
      },
      feedback: {
        events: [
          {
            payload: { progress: 0.5 }
          }
        ]
      }
    })
    await expect(service.cancelJob('run-1')).resolves.toMatchObject({
      status: 'cancel_requested'
    })
    expect(requests.at(-1)).toMatchObject({
      path: '/api/v1/runtime/runs/run-1/cancel',
      method: 'POST'
    })
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
