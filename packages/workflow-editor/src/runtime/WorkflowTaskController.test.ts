import type {
  DebugLaunchOverride,
  DebugWorkflowTaskPreflight,
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowRuntimeChangedEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommand
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowTaskController } from './WorkflowTaskController'

/**
 * 注册工作流任务控制器（WorkflowTaskController）行为测试。
 *
 * @returns 无。
 * @throws 任一运行合同断言失败时由 Vitest 报告。
 */
function registerWorkflowTaskControllerTests(): void {
  it('subscribes before discovering and installing a coherent Task/Jobs snapshot', async () => {
    const order: string[] = []
    const task = workflowTask()
    const jobs = [workflowJob()]
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => {
        order.push('subscribe')
        return { dispose: vi.fn() }
      }),
      listWorkflowTasks: vi.fn(async () => {
        order.push('list')
        return { items: [task], total: 1, page: 1, page_size: 1 }
      }),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => jobs)
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()

    expect(order).toEqual(['subscribe', 'list'])
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      task,
      jobs,
      error: null,
      generation: 1
    })
  })

  it('keeps active task status updated when runtime SSE is unavailable', async () => {
    vi.useFakeTimers()
    const task = workflowTask()
    let status: WorkflowTask['status'] = 'running'
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => {
        throw new Error('workflow.subscribeEvents is unavailable')
      }),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => ({ ...task, status })),
      listWorkflowTaskJobs: vi.fn(async () => [])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()

    expect(runtime.listWorkflowTasks).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      task: { ...task, status: 'running' },
      realtimeStatus: 'reconnecting',
      realtimeError: expect.stringContaining('定时自动更新')
    })

    status = 'succeeded'
    await vi.advanceTimersByTimeAsync(2_000)

    expect(runtime.getWorkflowTask).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().task?.status).toBe('succeeded')

    await vi.advanceTimersByTimeAsync(4_000)
    expect(runtime.getWorkflowTask).toHaveBeenCalledTimes(2)

    controller.dispose()
    vi.useRealTimers()
  })

  it('retains the previous coherent bundle when either REST projection fails', async () => {
    const firstTask = workflowTask()
    const firstJobs = [workflowJob()]
    let failJobs = false
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [firstTask], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async (): Promise<WorkflowTask> => ({
        ...firstTask,
        control_status: failJobs ? 'paused' : 'active'
      })),
      listWorkflowTaskJobs: vi.fn(async () => {
        if (failJobs) throw new Error('jobs unavailable')
        return firstJobs
      })
    })
    const controller = new WorkflowTaskController(
      runtime,
      firstTask.workflow_uuid
    )
    await controller.start()
    failJobs = true

    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      task: firstTask,
      jobs: firstJobs,
      error: 'jobs unavailable',
      projectionStale: true,
      generation: 1
    })

    failJobs = false
    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      task: firstTask,
      jobs: firstJobs,
      error: null,
      projectionStale: false,
      generation: 2
    })
  })

  it('increments Job feedback from the last confirmed sequence without losing history', async () => {
    const task = workflowTask()
    let feedbackSequence = 1
    const feedbackReads: number[] = []
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [{
        ...workflowJob(),
        feedback_sequence: feedbackSequence
      }]),
      listWorkflowNodeJobFeedback: vi.fn(async (_jobUuid, query = {}) => {
        const afterSequence = query.after_sequence ?? 0
        feedbackReads.push(afterSequence)
        return {
          items: afterSequence === 0
            ? [workflowFeedback(1)]
            : [workflowFeedback(2)],
          next_cursor: afterSequence === 0 ? 1 : 2,
          has_more: false
        }
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()
    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1])

    feedbackSequence = 2
    await controller.refresh()

    expect(feedbackReads).toEqual([0, 1])
    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1, 2])
  })

  it('continues feedback pagination until the OS cursor is exhausted', async () => {
    const task = workflowTask()
    const reads: number[] = []
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [{
        ...workflowJob(), feedback_sequence: 2
      }]),
      listWorkflowNodeJobFeedback: vi.fn(async (_jobUuid, query = {}) => {
        const afterSequence = query.after_sequence ?? 0
        reads.push(afterSequence)
        return afterSequence === 0
          ? {
              items: [workflowFeedback(1)],
              next_cursor: 1,
              has_more: true
            }
          : {
              items: [workflowFeedback(2)],
              next_cursor: 2,
              has_more: false
            }
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()

    expect(reads).toEqual([0, 1])
    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1, 2])
  })

  it('de-duplicates replayed feedback identities before exposing them to the UI', async () => {
    const task = workflowTask()
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [{
        ...workflowJob(), feedback_sequence: 2
      }]),
      listWorkflowNodeJobFeedback: vi.fn(async (_jobUuid, query = {}) =>
        (query.after_sequence ?? 0) === 0
          ? {
              items: [workflowFeedback(1), workflowFeedback(1)],
              next_cursor: 1,
              has_more: true
            }
          : {
              items: [workflowFeedback(2), workflowFeedback(2)],
              next_cursor: 2,
              has_more: false
            }
      )
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()

    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1, 2])
  })

  it('preserves confirmed feedback when a later cursor read fails and recovers', async () => {
    const task = workflowTask()
    let feedbackSequence = 1
    let failFeedback = false
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [{
        ...workflowJob(), feedback_sequence: feedbackSequence
      }]),
      listWorkflowNodeJobFeedback: vi.fn(async (_jobUuid, query = {}) => {
        if (failFeedback) throw new Error('feedback unavailable')
        const afterSequence = query.after_sequence ?? 0
        return {
          items: [workflowFeedback(afterSequence + 1)],
          next_cursor: afterSequence + 1,
          has_more: false
        }
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()

    feedbackSequence = 2
    failFeedback = true
    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      projectionStale: false,
      feedbackStale: true,
      error: 'feedback unavailable',
      generation: 2
    })
    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1])

    failFeedback = false
    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      projectionStale: false,
      feedbackStale: false,
      error: null,
      generation: 3
    })
    expect(controller.getSnapshot().feedback.map((item) => item.sequence))
      .toEqual([1, 2])
  })

  it('installs feedback confirmed for earlier Jobs when a later Job read fails', async () => {
    const task = workflowTask()
    const firstJob = { ...workflowJob(), feedback_sequence: 1 }
    const secondJob = {
      ...workflowJob(),
      uuid: '40000000-0000-4000-8000-000000000002',
      workflow_node_uuid: '20000000-0000-4000-8000-000000000012',
      feedback_sequence: 1,
      topological_index: 1
    }
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [firstJob, secondJob]),
      listWorkflowNodeJobFeedback: vi.fn(async (jobUuid) => {
        if (jobUuid === secondJob.uuid) {
          throw new Error('second feedback unavailable')
        }
        return {
          items: [workflowFeedback(1, firstJob.uuid)],
          next_cursor: 1,
          has_more: false
        }
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()

    expect(controller.getSnapshot()).toMatchObject({
      feedbackStale: true,
      feedbackError: 'second feedback unavailable'
    })
    expect(controller.getSnapshot().feedback).toEqual([
      workflowFeedback(1, firstJob.uuid)
    ])
  })

  it('keeps command acceptance separate from SSE-confirmed Task authority', async () => {
    const initial = workflowTask()
    let authoritative = initial
    let onInvalidate: ((event: WorkflowRuntimeChangedEvent) => void) | null = null
    const accepted = workflowCommand(initial.uuid)
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn((listener) => {
        onInvalidate = listener
        return { dispose: vi.fn() }
      }),
      listWorkflowTasks: vi.fn(async () => ({
        items: [initial], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => authoritative),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()]),
      commandWorkflowTask: vi.fn(async () => accepted)
    })
    const controller = new WorkflowTaskController(
      runtime,
      initial.workflow_uuid
    )
    await controller.start()

    await controller.command('pause')

    expect(controller.getSnapshot()).toMatchObject({
      lastCommand: accepted,
      task: { control_status: 'active' }
    })
    expect(runtime.getWorkflowTask).toHaveBeenCalledTimes(2)

    authoritative = { ...initial, control_status: 'paused' }
    expect(onInvalidate).not.toBeNull()
    ;(onInvalidate as unknown as (
      event: WorkflowRuntimeChangedEvent
    ) => void)({
      id: 'runtime-2',
      event: 'workflow.runtime.changed',
      data: { workflow_task_uuid: initial.uuid }
    })

    await vi.waitFor(() => {
      expect(controller.getSnapshot().task?.control_status).toBe('paused')
    })
  })

  it('does not replace a newer Task with a delayed invalidation for an older Task', async () => {
    const olderTask = workflowTask()
    const newerTask: WorkflowTask = {
      ...olderTask,
      uuid: '30000000-0000-4000-8000-000000000002',
      create_time: '2026-08-01T00:01:00Z',
      update_time: '2026-08-01T00:01:00Z',
      status: 'admission_blocked'
    }
    let onInvalidate: ((event: WorkflowRuntimeChangedEvent) => void) | null = null
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn((listener) => {
        onInvalidate = listener
        return { dispose: vi.fn() }
      }),
      listWorkflowTasks: vi.fn(async () => ({
        items: [olderTask], total: 1, page: 1, page_size: 1
      })),
      createWorkflowTask: vi.fn(async () => newerTask),
      getWorkflowTask: vi.fn(async (taskUuid) =>
        taskUuid === newerTask.uuid ? newerTask : olderTask
      ),
      listWorkflowTaskJobs: vi.fn(async (taskUuid) => [{
        ...workflowJob(),
        workflow_task_uuid: taskUuid
      }])
    })
    const controller = new WorkflowTaskController(
      runtime,
      olderTask.workflow_uuid
    )
    await controller.start()
    await controller.create('normal')
    await vi.waitFor(() => {
      expect(controller.getSnapshot().task?.uuid).toBe(newerTask.uuid)
    })

    expect(onInvalidate).not.toBeNull()
    ;(onInvalidate as unknown as (
      event: WorkflowRuntimeChangedEvent
    ) => void)({
      id: 'runtime-stale-older-task',
      event: 'workflow.runtime.changed',
      data: { workflow_task_uuid: olderTask.uuid }
    })
    await vi.waitFor(() => {
      expect(runtime.getWorkflowTask).toHaveBeenLastCalledWith(olderTask.uuid)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(controller.getSnapshot().task).toEqual(newerTask)
  })

  it('marks Runtime realtime interruption and rehydrates when SSE reconnects', async () => {
    const task = workflowTask()
    let subscriptionOptions: Parameters<
      WorkflowRuntimePort['subscribeWorkflowRuntime']
    >[1]
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn((_listener, options) => {
        subscriptionOptions = options
        return { dispose: vi.fn() }
      }),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()

    subscriptionOptions?.onError?.(new Error('stream lost'))
    expect(controller.getSnapshot()).toMatchObject({
      realtimeStatus: 'reconnecting',
      error: 'Runtime 实时同步中断：stream lost'
    })

    subscriptionOptions?.onOpen?.({
      lastEventId: 'runtime-4',
      reconnected: true
    })

    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({
        realtimeStatus: 'live',
        error: null,
        generation: 2
      })
    })
  })

  it('does not clear a stale projection error merely because SSE reconnects', async () => {
    const task = workflowTask()
    let failJobs = false
    let subscriptionOptions: Parameters<
      WorkflowRuntimePort['subscribeWorkflowRuntime']
    >[1]
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn((_listener, options) => {
        subscriptionOptions = options
        return { dispose: vi.fn() }
      }),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => {
        if (failJobs) throw new Error('jobs unavailable')
        return [workflowJob()]
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()
    failJobs = true
    await controller.refresh()

    subscriptionOptions?.onError?.(new Error('stream lost'))
    expect(controller.getSnapshot()).toMatchObject({
      projectionError: 'jobs unavailable',
      realtimeError: 'Runtime 实时同步中断：stream lost',
      error: 'jobs unavailable'
    })

    subscriptionOptions?.onOpen?.({
      lastEventId: 'runtime-8',
      reconnected: true
    })

    expect(controller.getSnapshot()).toMatchObject({
      realtimeStatus: 'live',
      projectionError: 'jobs unavailable',
      realtimeError: null,
      error: 'jobs unavailable'
    })
  })

  it('creates the selected Task mode and rehydrates the returned identity', async () => {
    // 证明创建请求保留所选运行模式，并最终安装对应的权威任务投影。
    const task = { ...workflowTask(), run_mode: 'step' as const }
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [], total: 0, page: 1, page_size: 1
      })),
      createWorkflowTask: vi.fn(async () => task),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()

    await controller.create('step')
    await vi.waitFor(() => expect(controller.getSnapshot().task).toEqual(task))

    expect(runtime.createWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      run_mode: 'step'
    })
    expect(runtime.getWorkflowTask).toHaveBeenCalledWith(task.uuid)
    expect(controller.getSnapshot().task?.run_mode).toBe('step')
  })

  /**
   * 验证单节点调试把目标身份提交给同一工作流任务（WorkflowTask）入口。
   *
   * 参数：无。返回：控制器创建与异步投影补读完成后无值。异常：请求出现第二
   * 入口、遗漏目标或附带私有调试字段时由断言暴露。
   */
  async function submitsSingleNodeTarget(): Promise<void> {
    const targetNodeUuid = '81000000-0000-4000-8000-000000000002'
    const task = {
      ...workflowTask(),
      run_mode: 'single_node' as const,
      target_node_uuid: targetNodeUuid
    }
    const runtime = singleNodeRuntime(task)
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()

    await controller.create('single_node', {}, targetNodeUuid)

    expect(runtime.createWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      run_mode: 'single_node',
      target_node_uuid: targetNodeUuid,
      input: {}
    })
  }

  it(
    '通过规范工作流任务（WorkflowTask）创建端口提交单节点目标',
    submitsSingleNodeTarget
  )

  it('finishes Task creation without waiting for the runtime projection refresh', async () => {
    // 证明工作流任务创建的成功响应独立于后续运行投影补读，避免参数抽屉无限等待。
    const task = workflowTask()
    let resolveJobs: ((jobs: WorkflowNodeJob[]) => void) | null = null
    const pendingJobs = new Promise<WorkflowNodeJob[]>((resolve) => {
      resolveJobs = resolve
    })
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [], total: 0, page: 1, page_size: 1
      })),
      createWorkflowTask: vi.fn(async () => task),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(() => pendingJobs)
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()

    let creationSettled = false
    const creation = controller.create('normal').then((created) => {
      creationSettled = true
      return created
    })
    await vi.waitFor(() => {
      expect(runtime.listWorkflowTaskJobs).toHaveBeenCalled()
    })
    await Promise.resolve()

    expect(creationSettled).toBe(true)

    expect(resolveJobs).not.toBeNull()
    ;(resolveJobs as unknown as (jobs: WorkflowNodeJob[]) => void)([])
    await creation
  })

  it('submits the exact validated input without debugger or revision-private fields', async () => {
    const task = { ...workflowTask(), run_mode: 'step' as const }
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [], total: 0, page: 1, page_size: 1
      })),
      createWorkflowTask: vi.fn(async () => task),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    await controller.start()
    const createWithInput = controller.create.bind(controller) as unknown as (
      runMode: 'normal' | 'step',
      input: Record<string, unknown>
    ) => Promise<void>

    await createWithInput('step', {
      count: 0,
      enabled: false,
      label: '',
      note: null,
      tags: [],
      config: {}
    })

    expect(runtime.createWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      run_mode: 'step',
      input: {
        count: 0,
        enabled: false,
        label: '',
        note: null,
        tags: [],
        config: {}
      }
    })
    expect(Object.keys(vi.mocked(runtime.createWorkflowTask).mock.calls[0][0]))
      .toEqual(['workflow_uuid', 'run_mode', 'input'])
  })

  it('preflights and freezes guided launch overrides through the debugger port', async () => {
    const task = { ...workflowTask(), run_mode: 'step' as const }
    const preflight: DebugWorkflowTaskPreflight = {
      workflow_uuid: task.workflow_uuid,
      workflow_revision: 7,
      status: 'ready',
      preflight_hash: `sha256:${'a'.repeat(64)}`,
      requirements: [],
      diagnostics: [],
      launch_overrides: [{
        requirement_id: 'requirement-1',
        target_node_uuid: workflowJob().workflow_node_uuid,
        target_handle_uuid: 'handle-1',
        value: 7,
        confirmed: false
      }]
    }
    const overrides: DebugLaunchOverride[] = [{
      requirement_id: 'requirement-1',
      value: 7
    }]
    const runtime = runtimePort({
      preflightDebugWorkflowTask: vi.fn(async () => preflight),
      createDebugWorkflowTask: vi.fn(async () => task),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await expect(controller.preflightDebug(
      workflowJob().workflow_node_uuid,
      [],
      { count: 3 },
      overrides
    )).resolves.toEqual(preflight)
    await controller.createDebug(
      workflowJob().workflow_node_uuid,
      [],
      { count: 3 },
      overrides,
      preflight.preflight_hash
    )

    expect(runtime.preflightDebugWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      start_node_uuids: [workflowJob().workflow_node_uuid],
      breakpoint_node_uuids: [],
      input: { count: 3 },
      launch_overrides: overrides
    })
    expect(runtime.createDebugWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      start_node_uuids: [workflowJob().workflow_node_uuid],
      breakpoint_node_uuids: [],
      input: { count: 3 },
      launch_overrides: overrides,
      preflight_hash: preflight.preflight_hash,
      meta_data: { source: 'unilab-workbench-debugger' }
    })
  })

  it('disposes the global subscription and ignores late REST completion', async () => {
    const task = workflowTask()
    const dispose = vi.fn()
    let resolveTask: ((value: WorkflowTask) => void) | null = null
    const taskRead = new Promise<WorkflowTask>((resolve) => {
      resolveTask = resolve
    })
    const listener = vi.fn()
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(() => taskRead),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()])
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)
    controller.subscribe(listener)
    const start = controller.start()
    await vi.waitFor(() => expect(runtime.getWorkflowTask).toHaveBeenCalled())

    controller.dispose()
    expect(resolveTask).not.toBeNull()
    ;(resolveTask as unknown as (value: WorkflowTask) => void)(task)
    await start

    expect(dispose).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({
      loading: true,
      task: null,
      jobs: [],
      generation: 0
    })
  })
}

describe('WorkflowTaskController', registerWorkflowTaskControllerTests)

/**
 * 把测试关心的最小运行时能力收窄为工作流运行端口。
 *
 * @param value 当前用例提供的运行时方法。
 * @returns 仅供控制器测试使用的工作流运行端口。
 * @throws 无；缺失方法会在具体用例调用时由测试失败揭示。
 */
function runtimePort(
  value: Partial<WorkflowRuntimePort>
): WorkflowRuntimePort {
  return value as WorkflowRuntimePort
}

/**
 * 构造单节点控制器用例的可观察运行端口。
 *
 * 参数：`task` 是所有读写回调返回的固定工作流任务（WorkflowTask）。返回：
 * 创建方法保持 Vitest 调用记录的最小运行端口。异常：所有回调均为内存固定值，
 * 不抛异常、不启动定时器，也不产生外部副作用。
 */
function singleNodeRuntime(task: WorkflowTask): WorkflowRuntimePort {
  /** 参数：无。返回：释放完成后无值。异常：不抛异常。 */
  function disposeSubscription(): void {}
  /** 参数：监听器和选项仅满足端口签名。返回：可释放订阅。异常：不抛异常。 */
  function subscribeRuntime(
    _listener: Parameters<WorkflowRuntimePort['subscribeWorkflowRuntime']>[0],
    _options?: Parameters<WorkflowRuntimePort['subscribeWorkflowRuntime']>[1]
  ): ReturnType<WorkflowRuntimePort['subscribeWorkflowRuntime']> {
    return { dispose: disposeSubscription }
  }
  /** 参数：`_query` 仅满足端口签名。返回：固定空任务页。异常：不抛异常。 */
  async function listTasks(
    _query?: Parameters<WorkflowRuntimePort['listWorkflowTasks']>[0]
  ): ReturnType<WorkflowRuntimePort['listWorkflowTasks']> {
    return { items: [], total: 0, page: 1, page_size: 1 }
  }
  /** 参数：`_request` 仅满足端口签名。返回：固定权威任务。异常：不抛异常。 */
  async function createTask(
    _request: Parameters<WorkflowRuntimePort['createWorkflowTask']>[0]
  ): ReturnType<WorkflowRuntimePort['createWorkflowTask']> {
    return task
  }
  /** 参数：`_taskUuid` 仅满足端口签名。返回：固定权威任务。异常：不抛异常。 */
  async function getTask(
    _taskUuid: string
  ): ReturnType<WorkflowRuntimePort['getWorkflowTask']> {
    return task
  }
  /** 参数：`_taskUuid` 仅满足端口签名。返回：固定唯一作业。异常：不抛异常。 */
  async function listJobs(
    _taskUuid: string
  ): ReturnType<WorkflowRuntimePort['listWorkflowTaskJobs']> {
    return [workflowJob()]
  }
  return runtimePort({
    subscribeWorkflowRuntime: vi.fn(subscribeRuntime),
    listWorkflowTasks: vi.fn(listTasks),
    createWorkflowTask: vi.fn(createTask),
    getWorkflowTask: vi.fn(getTask),
    listWorkflowTaskJobs: vi.fn(listJobs)
  })
}

function workflowTask(): WorkflowTask {
  return {
    uuid: '30000000-0000-4000-8000-000000000001',
    create_time: '2026-08-01T00:00:00Z',
    update_time: '2026-08-01T00:00:00Z',
    meta_data: {},
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    status: 'pending',
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    input: {},
    output: {},
    error_info: []
  }
}

function workflowJob(): WorkflowNodeJob {
  return {
    uuid: '40000000-0000-4000-8000-000000000001',
    create_time: '2026-08-01T00:00:00Z',
    update_time: '2026-08-01T00:00:00Z',
    meta_data: {},
    workflow_task_uuid: workflowTask().uuid,
    workflow_node_uuid: '20000000-0000-4000-8000-000000000011',
    feedback_sequence: 0,
    topological_index: 0,
    executor_kind: 'action',
    execution_policy: {},
    execution_timeout_seconds: 60,
    status: 'pending',
    attempt: 0,
    param: {},
    feedback_data: {},
    return_info: {},
    control_data: {},
    error_info: []
  }
}

function workflowCommand(taskUuid: string): WorkflowTaskCommand {
  return {
    uuid: '50000000-0000-4000-8000-000000000001',
    create_time: '2026-08-01T00:00:00Z',
    update_time: '2026-08-01T00:00:00Z',
    meta_data: {},
    workflow_task_uuid: taskUuid,
    type: 'pause',
    idempotency_key: 'ui1b-pause-1',
    status: 'pending',
    result: {},
    trace_context: {}
  }
}

function workflowFeedback(
  sequence: number,
  jobUuid = workflowJob().uuid
): WorkflowNodeJobFeedback {
  return {
    uuid: `60000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    create_time: `2026-08-01T00:00:0${sequence}Z`,
    update_time: `2026-08-01T00:00:0${sequence}Z`,
    meta_data: {},
    workflow_node_job_uuid: jobUuid,
    sequence,
    feedback_type: 'progress',
    data: { percent: sequence * 25 },
    observed_at: `2026-08-01T00:00:0${sequence}Z`,
    received_at: `2026-08-01T00:00:0${sequence}Z`,
    idempotency_key: `feedback-${sequence}`
  }
}
