import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import {
  createWorkflowRuntime,
  type WorkflowRuntimeChangedEvent,
  type WorkflowRuntimePort
} from './workflow'

const WORKFLOW_UUID = '11111111-1111-4111-8111-111111111111'
const TASK_UUID = '22222222-2222-4222-8222-222222222222'
const JOB_UUID = '33333333-3333-4333-8333-333333333333'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('WorkflowTask runtime port', () => {
  it('preflights debugger launch requirements before creating a task', async () => {
    const preflight = {
      workflow_uuid: WORKFLOW_UUID,
      workflow_revision: 7,
      status: 'needs_input',
      preflight_hash: `sha256:${'a'.repeat(64)}`,
      requirements: [{ id: 'requirement-1', kind: 'value' }],
      diagnostics: [],
      launch_overrides: []
    }
    const request = vi.fn().mockResolvedValue({ code: 0, data: preflight })
    const runtime = taskPort(request)

    await expect(runtime.preflightDebugWorkflowTask({
      workflow_uuid: WORKFLOW_UUID,
      start_node_uuids: [JOB_UUID],
      breakpoint_node_uuids: [],
      input: {},
      launch_overrides: []
    })).resolves.toEqual(preflight)

    expect(request).toHaveBeenCalledWith(
      '/api/v1/debug/workflow-tasks:preflight',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"start_node_uuids"')
      })
    )
  })

  it('launches and controls a debugger through the dedicated Hold-scoped API', async () => {
    const task = { uuid: TASK_UUID, workflow_uuid: WORKFLOW_UUID }
    const projection = {
      task,
      jobs: [],
      configuration: {
        start_node_uuids: [JOB_UUID],
        breakpoint_node_uuids: [JOB_UUID]
      },
      holds: [{ uuid: JOB_UUID, status: 'open' }]
    }
    const command = { uuid: JOB_UUID, type: 'step', status: 'succeeded' }
    const request = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: task })
      .mockResolvedValueOnce({ code: 0, data: projection })
      .mockResolvedValueOnce({ code: 0, data: command })
    const runtime = taskPort(request)

    await runtime.createDebugWorkflowTask({
      workflow_uuid: WORKFLOW_UUID,
      start_node_uuids: [JOB_UUID],
      breakpoint_node_uuids: [JOB_UUID],
      input: {}
    })
    await runtime.getDebugWorkflowTask(TASK_UUID)
    await runtime.commandDebugWorkflowTask(TASK_UUID, {
      type: 'step',
      scope: { type: 'hold', hold_uuid: JOB_UUID },
      idempotency_key: 'debug-step-1'
    })

    expect(request).toHaveBeenNthCalledWith(
      1,
      '/api/v1/debug/workflow-tasks',
      expect.objectContaining({ method: 'POST' })
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/debug/workflow-tasks/${TASK_UUID}`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      3,
      `/api/v1/debug/workflow-tasks/${TASK_UUID}/commands`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'step',
          scope: { type: 'hold', hold_uuid: JOB_UUID },
          idempotency_key: 'debug-step-1'
        })
      })
    )
  })

  it('creates a Backend-shaped Task without inventing Run identity', async () => {
    const task = {
      uuid: TASK_UUID,
      workflow_uuid: WORKFLOW_UUID,
      status: 'pending',
      run_mode: 'step',
      control_status: 'paused'
    }
    const request = vi.fn().mockResolvedValue({ code: 0, data: task })
    const runtime = taskPort(request)

    await expect(runtime.createWorkflowTask({
      workflow_uuid: WORKFLOW_UUID,
      run_mode: 'step',
      target_node_uuid: null,
      input: { sample_count: 3 },
      description: 'operator launch',
      meta_data: { source: 'workflow-panel' }
    })).resolves.toEqual(task)

    expect(request).toHaveBeenCalledWith(
      '/api/v1/workflow-tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workflow_uuid: WORKFLOW_UUID,
          run_mode: 'step',
          target_node_uuid: null,
          input: { sample_count: 3 },
          description: 'operator launch',
          meta_data: { source: 'workflow-panel' }
        })
      })
    )
  })

  it('rejects an ambiguous Runtime envelope that mixes success data and error', async () => {
    const runtime = taskPort(vi.fn().mockResolvedValue({
      code: 0,
      data: { uuid: TASK_UUID },
      error: { code: 'conflict', message: 'ambiguous response' }
    }))

    await expect(runtime.createWorkflowTask({
      workflow_uuid: WORKFLOW_UUID
    })).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' })
  })

  it('lists Tasks with only explicit Backend query values', async () => {
    const page = { items: [], total: 0, page: 2, page_size: 5 }
    const request = vi.fn().mockResolvedValue({ code: 0, data: page })
    const runtime = taskPort(request)

    await expect(runtime.listWorkflowTasks({
      page: 2,
      page_size: 5,
      execution_kind: 'workflow',
      workflow_uuid: WORKFLOW_UUID,
      status: 'running',
      cleanup_status: 'requires_attention'
    })).resolves.toEqual(page)

    expect(request).toHaveBeenCalledWith(
      `/api/v1/workflow-tasks?${new URLSearchParams({
        page: '2',
        page_size: '5',
        execution_kind: 'workflow',
        workflow_uuid: WORKFLOW_UUID,
        status: 'running',
        cleanup_status: 'requires_attention'
      })}`,
      undefined
    )
  })

  it('reads one Task and its ordered Jobs through UUID routes', async () => {
    const task = { uuid: TASK_UUID, status: 'running' }
    const jobs = [{
      uuid: JOB_UUID,
      workflow_task_uuid: TASK_UUID,
      topological_index: 0,
      status: 'running'
    }]
    const request = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: task })
      .mockResolvedValueOnce({ code: 0, data: jobs })
    const runtime = taskPort(request)

    await expect(runtime.getWorkflowTask(TASK_UUID)).resolves.toEqual(task)
    await expect(runtime.listWorkflowTaskJobs(TASK_UUID)).resolves.toEqual(jobs)

    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/workflow-tasks/${TASK_UUID}`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/workflow-tasks/${TASK_UUID}/jobs`,
      undefined
    )
  })

  it('returns only the durable command record without optimistic Task refresh', async () => {
    const command = {
      uuid: '44444444-4444-4444-8444-444444444444',
      workflow_task_uuid: TASK_UUID,
      type: 'pause',
      idempotency_key: 'panel-pause-1',
      status: 'pending',
      result: {}
    }
    const request = vi.fn().mockResolvedValue({ code: 0, data: command })
    const runtime = taskPort(request)

    await expect(runtime.commandWorkflowTask(TASK_UUID, {
      type: 'pause',
      idempotency_key: 'panel-pause-1',
      description: 'operator pause',
      meta_data: { source: 'workflow-panel' }
    })).resolves.toEqual(command)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      `/api/v1/workflow-tasks/${TASK_UUID}/commands`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'pause',
          idempotency_key: 'panel-pause-1',
          description: 'operator pause',
          meta_data: { source: 'workflow-panel' }
        })
      })
    )
  })

  it('reads one Job and its sequence-cursor feedback page', async () => {
    const job = {
      uuid: JOB_UUID,
      workflow_task_uuid: TASK_UUID,
      feedback_sequence: 8,
      feedback_data: { progress: 80 }
    }
    const page = {
      items: [{
        workflow_node_job_uuid: JOB_UUID,
        sequence: 8,
        feedback_type: 'progress',
        data: { progress: 80 },
        idempotency_key: 'feedback-8'
      }],
      next_cursor: 8,
      has_more: false
    }
    const request = vi.fn()
      .mockResolvedValueOnce({ code: 0, data: job })
      .mockResolvedValueOnce({ code: 0, data: page })
    const runtime = taskPort(request)

    await expect(runtime.getWorkflowNodeJob(JOB_UUID)).resolves.toEqual(job)
    await expect(runtime.listWorkflowNodeJobFeedback(JOB_UUID, {
      after_sequence: 7,
      limit: 50
    })).resolves.toEqual(page)

    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/workflow-node-jobs/${JOB_UUID}`,
      undefined
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/workflow-node-jobs/${JOB_UUID}/feedback?after_sequence=7&limit=50`,
      undefined
    )
  })

  it('resumes the global SSE and de-duplicates Runtime invalidations by event ID', async () => {
    const streamController: {
      current?: ReadableStreamDefaultController<Uint8Array>
    } = {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController.current = controller
      }
    })
    const fetcher = vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }))
    vi.stubGlobal('fetch', fetcher)
    const invalidations: Array<{
      id: string
      event: string
      data: Record<string, unknown>
    }> = []
    const errors: Error[] = []
    const runtime = taskPort(vi.fn())

    const subscription = runtime.subscribeWorkflowRuntime(
      (event) => invalidations.push(event),
      {
        lastEventId: '40',
        onError: (error) => errors.push(error)
      }
    )

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:18003/api/v1/events')
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream')
    expect(new Headers(init.headers).get('Last-Event-ID')).toBe('40')

    streamController.current?.enqueue(new TextEncoder().encode([
      'id: 41',
      'event: workflow.authoring.changed',
      'data: {"workflow_uuid":"ignored"}',
      '',
      'id: 42',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({ workflow_task_uuid: TASK_UUID })}`,
      '',
      'id: 42',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({ workflow_task_uuid: TASK_UUID })}`,
      '',
      'id: 43',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({
        workflow_task_uuid: '55555555-5555-4555-8555-555555555555'
      })}`,
      '',
      'id: 44',
      'event: device_action_task.changed',
      `data: ${JSON.stringify({ task_uuid: TASK_UUID })}`,
      '',
      'id: 45',
      'event: device.catalog.changed',
      'data: {"catalog_revision":7}',
      '',
      'id: 46',
      'event: workflow.definition.changed',
      `data: ${JSON.stringify({
        workflow_uuid: WORKFLOW_UUID,
        workflow_revision: 9
      })}`,
      '',
      ''
    ].join('\n')))

    await vi.waitFor(() => expect(invalidations).toHaveLength(5))
    expect(invalidations).toEqual([
      {
        id: '42',
        event: 'workflow.runtime.changed',
        data: { workflow_task_uuid: TASK_UUID }
      },
      {
        id: '43',
        event: 'workflow.runtime.changed',
        data: { workflow_task_uuid: '55555555-5555-4555-8555-555555555555' }
      },
      {
        id: '44',
        event: 'device_action_task.changed',
        data: { task_uuid: TASK_UUID }
      },
      {
        id: '45',
        event: 'device.catalog.changed',
        data: { catalog_revision: 7 }
      },
      {
        id: '46',
        event: 'workflow.definition.changed',
        data: { workflow_uuid: WORKFLOW_UUID, workflow_revision: 9 }
      }
    ])
    expect(errors).toEqual([])

    subscription.dispose()
    expect((init.signal as AbortSignal).aborted).toBe(true)
    runtime.dispose()
  })

  it('rejects Runtime SSE payloads that smuggle a state patch', async () => {
    const streamController: {
      current?: ReadableStreamDefaultController<Uint8Array>
    } = {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController.current = controller
      }
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })))
    const invalidations: WorkflowRuntimeChangedEvent[] = []
    const errors: Error[] = []
    const runtime = taskPort(vi.fn())
    const subscription = runtime.subscribeWorkflowRuntime(
      (event) => {
        if (event.event === 'workflow.runtime.changed') {
          invalidations.push(event)
        }
      },
      { onError: (error) => errors.push(error) }
    )

    streamController.current?.enqueue(new TextEncoder().encode([
      'id: 51',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({
        workflow_task_uuid: TASK_UUID,
        status: 'running'
      })}`,
      '',
      'id: 51',
      'event: workflow.runtime.changed',
      `data: ${JSON.stringify({
        workflow_task_uuid: TASK_UUID,
        status: 'running'
      })}`,
      '',
      ''
    ].join('\n')))

    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(invalidations).toEqual([])
    expect(errors[0]?.message).toContain('Workflow Runtime SSE')

    subscription.dispose()
    runtime.dispose()
  })

  it('reconnects from the latest global SSE ID even when the frame has no data', async () => {
    const firstController: {
      current?: ReadableStreamDefaultController<Uint8Array>
    } = {}
    const firstStream = new ReadableStream<Uint8Array>({
      start(controller) {
        firstController.current = controller
      }
    })
    const secondStream = new ReadableStream<Uint8Array>()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(firstStream, { status: 200 }))
      .mockResolvedValueOnce(new Response(secondStream, { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const runtime = taskPort(vi.fn())
    const opens: Array<{ lastEventId: string; reconnected: boolean }> = []
    const errors: Error[] = []
    const subscription = runtime.subscribeWorkflowRuntime(
      () => undefined,
      {
        lastEventId: '70',
        onOpen: (state) => opens.push(state),
        onError: (error) => errors.push(error)
      }
    )

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(opens).toEqual([{ lastEventId: '70', reconnected: false }])
    vi.useFakeTimers()
    firstController.current?.enqueue(new TextEncoder().encode('id: 77\n\n'))
    firstController.current?.close()
    await Promise.resolve()
    await Promise.resolve()
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]?.message).toContain('连接已断开')
    await vi.advanceTimersByTimeAsync(3000)

    expect(fetcher).toHaveBeenCalledTimes(2)
    const [, reconnectInit] = fetcher.mock.calls[1] as [string, RequestInit]
    expect(new Headers(reconnectInit.headers).get('Last-Event-ID')).toBe('77')
    expect(opens).toEqual([
      { lastEventId: '70', reconnected: false },
      { lastEventId: '77', reconnected: true }
    ])

    subscription.dispose()
    runtime.dispose()
  })

  it('does not expose the retired Run transport through the public runtime port', () => {
    const runtime = taskPort(vi.fn())

    for (const retiredMethod of [
      'createRun',
      'getRun',
      'listRunNodes',
      'listRunEvents',
      'command',
      'cancelRun',
      'subscribeRunEvents'
    ]) {
      expect(retiredMethod in runtime).toBe(false)
    }

    runtime.dispose()
  })
})

function taskPort(request: ReturnType<typeof vi.fn>): WorkflowRuntimePort {
  return createWorkflowRuntime(
    mockHttp(request),
    getDefaultBackend('local-python')
  )
}

function mockHttp(request: ReturnType<typeof vi.fn>): HttpClient {
  return {
    request: async <ResponseValue>(
      path: string,
      init?: RequestInit
    ): Promise<ResponseValue> =>
      request(path, init) as Promise<ResponseValue>
  }
}
