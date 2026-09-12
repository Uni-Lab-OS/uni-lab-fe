import type {
  WorkflowExecutionTask,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import {
  createWorkflowTaskPageLoader,
  mergeWorkflowTaskPage,
  subscribeWorkflowTaskListUpdates
} from './workflowTaskListRuntime'

const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000001'
const TASK_UUID = '20000000-0000-4000-8000-000000000002'

describe('工作流任务列表实时状态', () => {
  /** 全局失效事件通过整页摘要交付 Backend 权威运行状态。 */
  it('refreshes authoritative page summaries after an SSE invalidation', async () => {
    let invalidate: (event: WorkflowRuntimeInvalidationEvent) => void =
      () => undefined
    const dispose = vi.fn()
    const task = workflowTask('running')
    const runtime = {
      listWorkflowTaskPresentations: vi.fn(async () => ({ items: [task], total: 1, page: 1, page_size: 100 })),
      subscribeWorkflowRuntime: vi.fn((listener) => {
        invalidate = listener
        return { dispose }
      })
    } as unknown as WorkflowRuntimePort
    const received: WorkflowTask[] = []

    const subscription = subscribeWorkflowTaskListUpdates(runtime, {
      onPage: (page) => received.push(...page.items),
      onError: vi.fn()
    })
    invalidate(runtimeChanged(TASK_UUID))

    await vi.waitFor(() => expect(received).toEqual([task]))
    expect(runtime.listWorkflowTaskPresentations).toHaveBeenCalledWith({ page: 1, page_size: 100, execution_kind: 'workflow' })
    subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('coalesces multiple tasks and in-flight invalidations into one trailing page read', async () => {
    const pending: Array<(value: WorkflowTaskPage) => void> = []
    let invalidate!: (event: WorkflowRuntimeInvalidationEvent) => void
    const read = vi.fn(() => new Promise<WorkflowTaskPage>((resolve) => pending.push(resolve)))
    const runtime = { listWorkflowTaskPresentations: read,
      getWorkflowTask: vi.fn(),
      subscribeWorkflowRuntime: (listener: typeof invalidate) => { invalidate = listener; return { dispose: vi.fn() } }
    } as unknown as WorkflowRuntimePort
    const onPage = vi.fn()
    const subscription = subscribeWorkflowTaskListUpdates(runtime, { onPage, onError: vi.fn() })
    invalidate(runtimeChanged(TASK_UUID))
    for (let i = 0; i < 100; i++) invalidate(runtimeChanged(`task-${i}`))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const page = { items: [workflowTask('running')], total: 1, page: 1, page_size: 100 }
    pending.shift()!(page)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    pending.shift()!({ ...page, items: [workflowTask('succeeded')] })
    await vi.waitFor(() => expect(onPage).toHaveBeenLastCalledWith(expect.objectContaining({ items: [workflowTask('succeeded')] })))
    expect(runtime.getWorkflowTask).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(2)
    subscription.dispose()
  })

  it('retains page errors until a successful page and ignores disposed queued work and late results', async () => {
    let invalidate!: (event: WorkflowRuntimeInvalidationEvent) => void
    let options!: { onOpen: () => void }
    let resolve!: (value: WorkflowTaskPage) => void
    const page = { items: [workflowTask('running')], total: 1, page: 1, page_size: 100 }
    const read = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(page)
      .mockImplementation(() => new Promise<WorkflowTaskPage>((done) => { resolve = done }))
    const runtime = { listWorkflowTaskPresentations: read,
      subscribeWorkflowRuntime: (listener: typeof invalidate, nextOptions: typeof options) => {
        invalidate = listener; options = nextOptions; return { dispose: vi.fn() }
      }
    } as unknown as WorkflowRuntimePort
    const onPage = vi.fn(), onError = vi.fn(), onRecovered = vi.fn()
    const subscription = subscribeWorkflowTaskListUpdates(runtime, { onPage, onError, onRecovered })
    invalidate(runtimeChanged(TASK_UUID))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining('timeout')))
    expect(onRecovered).not.toHaveBeenCalled()
    options.onOpen()
    await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledOnce())
    expect(onPage).toHaveBeenCalledOnce()
    invalidate(runtimeChanged(TASK_UUID))
    invalidate(runtimeChanged('another'))
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3))
    subscription.dispose()
    invalidate(runtimeChanged('after-dispose'))
    resolve(page)
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(3)
    expect(onPage).toHaveBeenCalledOnce()
  })

  it('does not reinstall an initial page delayed by the workflow catalogue after a newer SSE page', async () => {
    const initialPage = { items: [workflowTask('running')], total: 1, page: 1, page_size: 100 }
    const newerPage = { ...initialPage, items: [workflowTask('succeeded')] }
    let invalidate!: (event: WorkflowRuntimeInvalidationEvent) => void
    let finishCatalogue!: () => void
    const catalogue = new Promise<void>((resolve) => { finishCatalogue = resolve })
    const runtime = {
      listWorkflowTaskPresentations: vi.fn().mockResolvedValueOnce(initialPage).mockResolvedValueOnce(newerPage),
      subscribeWorkflowRuntime: (listener: typeof invalidate) => {
        invalidate = listener
        return { dispose: vi.fn() }
      }
    } as unknown as WorkflowRuntimePort
    const loader = createWorkflowTaskPageLoader(runtime)
    let installed: WorkflowTaskPage | null = null
    const initial = Promise.all([loader.read({ page: 1 }), catalogue]).then(([page]) => {
      if (loader.isCurrent(page)) installed = page
    })
    const subscription = subscribeWorkflowTaskListUpdates(runtime, {
      onPage: (page) => { installed = page }, onError: vi.fn()
    }, undefined, loader)
    invalidate(runtimeChanged(TASK_UUID))
    await vi.waitFor(() => expect(installed).toBe(newerPage))
    finishCatalogue()
    await initial
    expect(installed).toBe(newerPage)
    expect(loader.isCurrent(initialPage)).toBe(false)
    expect(loader.isCurrent(newerPage)).toBe(true)
    subscription.dispose()
    loader.dispose()
    expect(loader.isCurrent(newerPage)).toBe(false)
  })

  it('shares one request lane for initial load and events, and cancels queued reads on disposal', async () => {
    let resolve!: (value: WorkflowTaskPage) => void
    const read = vi.fn(() => new Promise<WorkflowTaskPage>((done) => { resolve = done }))
    const loader = createWorkflowTaskPageLoader({ listWorkflowTaskPresentations: read } as unknown as WorkflowRuntimePort)
    const first = loader.read({ page: 1 })
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    const queued = loader.read({ page: 1 })
    const rejected = expect(queued).rejects.toThrow('任务列表已关闭')
    loader.dispose()
    loader.activate() // React StrictMode 重建也不能复活旧世代排队请求。
    resolve({ items: [], total: 0, page: 1, page_size: 100 })
    await first
    await rejected
    expect(read).toHaveBeenCalledOnce()
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
