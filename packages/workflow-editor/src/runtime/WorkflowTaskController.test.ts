import type {
  WorkflowNodeJob,
  WorkflowNodeJobFeedback,
  WorkflowRuntimeChangedEvent,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskRuntimeEvent
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import { WorkflowTaskController } from './WorkflowTaskController'

describe('WorkflowTaskController', () => {
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

  it('increments durable Task runtime events from the last journal cursor', async () => {
    const task = workflowTask()
    let latestSequence = 1
    const eventReads: number[] = []
    const runtime = runtimePort({
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      listWorkflowTasks: vi.fn(async () => ({
        items: [task], total: 1, page: 1, page_size: 1
      })),
      getWorkflowTask: vi.fn(async () => task),
      listWorkflowTaskJobs: vi.fn(async () => [workflowJob()]),
      listWorkflowTaskEvents: vi.fn(async (_taskUuid, query = {}) => {
        const afterSequence = query.after_sequence ?? 0
        eventReads.push(afterSequence)
        return {
          items: afterSequence === 0
            ? [workflowRuntimeEvent(1, 'dispatched')]
            : [workflowRuntimeEvent(2, 'succeeded')],
          next_cursor: afterSequence === 0 ? 1 : latestSequence,
          has_more: false
        }
      })
    })
    const controller = new WorkflowTaskController(runtime, task.workflow_uuid)

    await controller.start()
    expect(controller.getSnapshot().events.map((item) => item.sequence))
      .toEqual([1])

    latestSequence = 2
    await controller.refresh()

    expect(eventReads).toEqual([0, 1])
    expect(controller.getSnapshot().events.map((item) => item.sequence))
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

    expect(runtime.createWorkflowTask).toHaveBeenCalledWith({
      workflow_uuid: task.workflow_uuid,
      run_mode: 'step'
    })
    expect(runtime.getWorkflowTask).toHaveBeenCalledWith(task.uuid)
    expect(controller.getSnapshot().task?.run_mode).toBe('step')
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
})

function runtimePort(
  value: Partial<WorkflowRuntimePort>
): WorkflowRuntimePort {
  return {
    listWorkflowTaskEvents: vi.fn(async () => ({
      items: [], next_cursor: 0, has_more: false
    })),
    ...value
  } as WorkflowRuntimePort
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

function workflowRuntimeEvent(
  sequence: number,
  toStatus: string
): WorkflowTaskRuntimeEvent {
  return {
    sequence,
    workflow_task_uuid: workflowTask().uuid,
    workflow_node_job_uuid: workflowJob().uuid,
    workflow_node_uuid: workflowJob().workflow_node_uuid,
    kind: 'job_transition',
    from_status: toStatus === 'dispatched' ? 'pending' : 'running',
    to_status: toStatus,
    data: {},
    create_time: `2026-08-01T00:00:0${sequence}Z`
  }
}
