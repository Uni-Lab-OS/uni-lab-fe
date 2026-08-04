import { describe, expect, it, vi } from 'vitest'
import type {
  DeviceCardHostActionRequest
} from '@unilab/device-card-sdk'

import type { DeviceActionTaskRuntimePort } from './deviceActionTasks'
import {
  DeviceCardActionController
} from './deviceCardActionController'
import type { DeviceCatalogItem } from './laboratory'
import type {
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort
} from './workflow'

const TASK_UUID = '10000000-0000-4000-8000-000000000001'
const JOB_UUID = '10000000-0000-4000-8000-000000000002'
const TEMPLATE_UUID = '10000000-0000-4000-8000-000000000003'
const RESOURCE_UUID = '10000000-0000-4000-8000-000000000004'
const FINGERPRINT = `sha256:${'a'.repeat(64)}`

describe('DeviceCardActionController', () => {
  it('subscribes before create and rehydrates only after matching SSE invalidation', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const invalidation = {
      current: undefined as
        | ((event: WorkflowRuntimeInvalidationEvent) => void)
        | undefined
    }
    const getTask = vi.fn()
      .mockResolvedValueOnce(task('running'))
      .mockResolvedValueOnce(task('succeeded'))
    const workflow = {
      getWorkflowActionCatalog: vi.fn(async () => catalog()),
      subscribeWorkflowRuntime: vi.fn((listener) => {
        order.push('subscribe')
        invalidation.current = listener
        return { dispose: vi.fn() }
      })
    } as unknown as WorkflowRuntimePort
    const tasks = {
      createDeviceActionTask: vi.fn(async () => {
        order.push('create')
        return task('accepted')
      }),
      getDeviceActionTask: getTask
    } satisfies DeviceActionTaskRuntimePort
    const controller = new DeviceCardActionController({
      workflow,
      tasks,
      randomUuid: () => '10000000-0000-4000-8000-000000000005'
    })

    const result = controller.execute(request(), device())
    await vi.waitFor(() => expect(getTask).toHaveBeenCalledOnce())
    expect(order).toEqual(['subscribe', 'create'])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(getTask).toHaveBeenCalledOnce()

    invalidation.current?.({
      id: '9',
      event: 'device_action_task.changed',
      data: { task_uuid: TASK_UUID }
    })

    await expect(result).resolves.toMatchObject({
      status: 'DONE',
      result: {
        taskUuid: TASK_UUID,
        jobUuid: JOB_UUID,
        status: 'succeeded',
        output: { completed: true }
      }
    })
    expect(getTask).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('fails closed before Task creation for offline or undeclared actions', async () => {
    const tasks = {
      createDeviceActionTask: vi.fn(),
      getDeviceActionTask: vi.fn()
    } as unknown as DeviceActionTaskRuntimePort
    const controller = new DeviceCardActionController({
      workflow: {
        subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() }))
      } as unknown as WorkflowRuntimePort,
      tasks
    })

    await expect(controller.execute(request(), {
      ...device(), online: false
    })).resolves.toMatchObject({ status: 'ERROR', error: expect.stringContaining('离线') })
    await expect(controller.execute({
      ...request(), action: 'undeclared'
    }, device())).resolves.toMatchObject({
      status: 'ERROR',
      error: expect.stringContaining('未声明')
    })
    expect(tasks.createDeviceActionTask).not.toHaveBeenCalled()
  })
})

function request(): DeviceCardHostActionRequest {
  return {
    requestId: 'card-request-1',
    deviceId: 'D1ADevice1',
    action: 'test_hold',
    params: { duration_seconds: 3 }
  }
}

function device(): DeviceCatalogItem {
  return {
    deviceId: 'D1ADevice1',
    deviceTypeId: 'd1a.simulator',
    deviceKey: '/devices/D1ADevice1',
    namespace: '/devices',
    label: 'D1A simulator',
    online: true,
    actions: [{
      actionName: 'test_hold',
      actionRef: 'D1ADevice1.test_hold',
      label: '单节点运行',
      typeName: 'UniLabJsonCommand',
      inputSchema: {
        duration_seconds: { type: 'integer', required: true }
      },
      outputSchema: {},
      riskLevel: 'normal',
      isBusy: false
    }]
  }
}

function task(status: string): ReturnType<DeviceActionTaskRuntimePort['getDeviceActionTask']> extends Promise<infer Value> ? Value : never {
  return {
    task_uuid: TASK_UUID,
    job_uuid: JOB_UUID,
    authority_id: 'os-local',
    template_catalog_fingerprint: FINGERPRINT,
    workflow_node_template_uuid: TEMPLATE_UUID,
    name: 'test_hold',
    display_name: '单节点运行',
    device_id: 'D1ADevice1',
    status,
    control_status: 'active',
    cleanup_status: status === 'succeeded' ? 'settled' : 'none',
    input: { duration_seconds: 3 },
    output: status === 'succeeded' ? { completed: true } : {},
    error_info: [],
    job_status: status,
    feedback_cursor: status === 'succeeded' ? 1 : 0,
    create_time: '2026-08-04T00:00:00Z',
    update_time: '2026-08-04T00:00:01Z',
    started_at: status === 'accepted' ? null : '2026-08-04T00:00:00Z',
    finished_at: status === 'succeeded' ? '2026-08-04T00:00:01Z' : null
  }
}

function catalog() {
  return {
    authorityId: 'os-local',
    authorityKind: 'local' as const,
    fingerprint: FINGERPRINT,
    actionTemplates: [{
      uuid: TEMPLATE_UUID,
      resourceTemplateUuid: RESOURCE_UUID,
      name: 'test_hold',
      displayName: '单节点运行',
      actionClass: null,
      actionType: 'UniLabJsonCommand',
      schema: { 'x-unilabos-action-contract': { version: 1 } },
      goal: {},
      goalDefault: {},
      handles: []
    }],
    workflowTemplates: []
  }
}
