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
const MATERIAL_UUID = '10000000-0000-4000-8000-000000000006'
const FINGERPRINT = `sha256:${'a'.repeat(64)}`

describe('DeviceCardActionController', () => {
  /** 证明全局 SSE 只触发工作流任务（WorkflowTask）REST 补读，不直接覆盖任务状态。 */
  it('submits the device material and rehydrates after the standard runtime event', async () => {
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

    invalidation.current?.({
      id: '9',
      event: 'workflow.runtime.changed',
      data: { workflow_task_uuid: TASK_UUID }
    })
    expect(tasks.createDeviceActionTask).toHaveBeenCalledWith({
      material_uuid: MATERIAL_UUID,
      workflow_node_template_uuid: TEMPLATE_UUID,
      param: { duration_seconds: 3 },
      execution_policy: {},
      idempotency_key: '10000000-0000-4000-8000-000000000005',
      description: '设备卡片单动作运行',
      meta_data: {
        source: 'device-card',
        device_id: 'D1ADevice1',
        action_name: 'test_hold'
      }
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

  /** 证明 Backend 未开放完整 SSE 时，设备卡片仍以 REST 补读收敛到权威终态。 */
  it('rehydrates to a terminal task when runtime events are unavailable', async () => {
    vi.useFakeTimers()
    const subscribe = vi.fn()
    const getTask = vi.fn()
      .mockResolvedValueOnce(task('running'))
      .mockResolvedValueOnce(task('succeeded'))
    const controller = new DeviceCardActionController({
      workflow: {
        getWorkflowActionCatalog: vi.fn(async () => catalog()),
        subscribeWorkflowRuntime: subscribe
      } as unknown as WorkflowRuntimePort,
      tasks: {
        createDeviceActionTask: vi.fn(async () => task('accepted')),
        getDeviceActionTask: getTask
      },
      randomUuid: () => '10000000-0000-4000-8000-000000000005',
      runtimeEventsSupported: false
    })

    const result = controller.execute(request(), device())
    await vi.waitFor(() => expect(getTask).toHaveBeenCalledOnce())
    expect(subscribe).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(result).resolves.toMatchObject({ status: 'DONE' })
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

/** 构造设备卡片单动作请求；无参数，返回稳定请求身份与普通变量参数。 */
function request(): DeviceCardHostActionRequest {
  return {
    requestId: 'card-request-1',
    deviceId: 'D1ADevice1',
    action: 'test_hold',
    params: { duration_seconds: 3 }
  }
}

/** 构造带物料和资源模板稳定身份的在线设备；无参数，返回可执行目录项。 */
function device(): DeviceCatalogItem {
  return {
    deviceId: 'D1ADevice1',
    materialUuid: MATERIAL_UUID,
    resourceTemplateUuid: RESOURCE_UUID,
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

/** 按 Backend 状态构造任务视图；参数为任务状态，返回测试专用任务与作业投影。 */
function task(status: string): ReturnType<DeviceActionTaskRuntimePort['getDeviceActionTask']> extends Promise<infer Value> ? Value : never {
  return {
    task_uuid: TASK_UUID,
    job_uuid: JOB_UUID,
    status,
    control_status: 'active',
    cleanup_status: status === 'succeeded' ? 'settled' : 'none',
    output: status === 'succeeded' ? { completed: true } : {},
    error_info: [],
    job_status: status,
    feedback_cursor: status === 'succeeded' ? 1 : 0
  }
}

/** 构造与设备资源模板唯一匹配的动作目录；无参数，返回目录快照。 */
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
