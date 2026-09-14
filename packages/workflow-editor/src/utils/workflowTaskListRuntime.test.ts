import type {
  WorkflowExecutionTask,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import {
  mergeWorkflowTaskPage,
  subscribeWorkflowTaskListUpdates
} from './workflowTaskListRuntime'

const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000001'
const TASK_UUID = '20000000-0000-4000-8000-000000000002'

describe('工作流任务列表实时状态', () => {
  /** 全局失效事件必须精确补读对应任务，并交付 Backend 权威运行状态。 */
  it('rehydrates the changed task status after an SSE invalidation', async () => {
    let invalidate: (event: WorkflowRuntimeInvalidationEvent) => void =
      () => undefined
    const dispose = vi.fn()
    const task = workflowTask('running')
    const runtime = {
      getWorkflowTask: vi.fn(async () => task),
      subscribeWorkflowRuntime: vi.fn((listener) => {
        invalidate = listener
        return { dispose }
      })
    } as unknown as WorkflowRuntimePort
    const received: WorkflowTask[] = []

    const subscription = subscribeWorkflowTaskListUpdates(runtime, {
      onTask: (nextTask) => received.push(nextTask),
      onError: vi.fn()
    })
    invalidate(runtimeChanged(TASK_UUID))

    await vi.waitFor(() => expect(received).toEqual([task]))
    expect(runtime.getWorkflowTask).toHaveBeenCalledWith(TASK_UUID)
    subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  /** 补读结果必须更新原任务，不能因并行运行覆盖其他工作流任务。 */
  it('merges one authoritative status without dropping sibling tasks', () => {
    const sibling = workflowTask('pending', '20000000-0000-4000-8000-000000000003')
    const page: WorkflowTaskPage = {
      items: [workflowTask('pending'), sibling],
      total: 2,
      page: 1,
      page_size: 100
    }

    const next = mergeWorkflowTaskPage(page, workflowTask('running'))

    expect(next.items).toHaveLength(2)
    expect(next.items.find((task) => task.uuid === TASK_UUID)?.status)
      .toBe('running')
    expect(next.items).toContain(sibling)
    expect(next.total).toBe(2)
  })
})

/**
 * 构造指定状态和身份的 Backend 工作流任务事实。
 *
 * @param status Backend 权威业务状态。
 * @param uuid 工作流任务稳定身份。
 * @returns 可参与任务列表合并的完整任务投影。
 */
function workflowTask(
  status: WorkflowTask['status'],
  uuid = TASK_UUID
): WorkflowExecutionTask {
  return {
    uuid,
    create_time: '2026-08-20T08:00:00Z',
    update_time: '2026-08-20T08:00:00Z',
    meta_data: {},
    execution_kind: 'workflow',
    workflow_uuid: WORKFLOW_UUID,
    status,
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    error_info: []
  }
}

/**
 * 构造工作流运行时失效事件。
 *
 * @param taskUuid 需要重新读取的工作流任务身份。
 * @returns 只携带失效身份、不伪造状态的 SSE 事件。
 */
function runtimeChanged(taskUuid: string): WorkflowRuntimeInvalidationEvent {
  return {
    id: `event:${taskUuid}`,
    event: 'workflow.runtime.changed',
    data: { workflow_task_uuid: taskUuid }
  }
}
