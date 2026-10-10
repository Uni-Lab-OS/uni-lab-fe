import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowRuntimeEvents } from './workflow-runtime-events'

describe('createWorkflowRuntimeEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the core runtime SSE endpoint and emits invalidations', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://os.example.test/api/v1/events')
      const headers = new Headers(init?.headers)
      expect(headers.get('accept')).toBe('text/event-stream')
      expect(headers.get('authorization')).toBe('Bearer token')
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)

    const events: unknown[] = []
    const runtime = createWorkflowRuntimeEvents({
      baseUrl: 'https://os.example.test',
      getAccessToken: () => 'Bearer token',
    })
    const subscription = runtime.subscribe((event) => events.push(event))

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controllers[0]?.enqueue(
      new TextEncoder().encode(
        'id: event-1\nevent: workflow.runtime.changed\ndata: {"dispatch_gate":"active","workflow_task_uuid":"task-1"}\n\n',
      ),
    )
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({
      id: 'event-1',
      event: 'workflow.runtime.changed',
      workflowTaskUuid: 'task-1',
      raw: { dispatch_gate: 'active', workflow_task_uuid: 'task-1' },
    })

    subscription.dispose()
    runtime.dispose()
  })

  it('reconnects when a disposed adapter is subscribed again', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetcher = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)

    const runtime = createWorkflowRuntimeEvents({ baseUrl: 'https://os.example.test' })
    const first = runtime.subscribe(() => undefined)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    first.dispose()
    runtime.dispose()

    const second = runtime.subscribe(() => undefined)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    second.dispose()
    runtime.dispose()
    controllers.forEach((controller) => controller.close())
  })

  it('resumes with the latest event id after reconnect', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const requests: RequestInit[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)

    const runtime = createWorkflowRuntimeEvents({
      baseUrl: 'https://os.example.test',
      reconnectDelayMs: 0,
    })
    const subscription = runtime.subscribe(() => undefined)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controllers[0]?.enqueue(
      new TextEncoder().encode(
        'id: event-7\nevent: workflow.runtime.changed\ndata: {"workflow_task_uuid":"task-7"}\n\n',
      ),
    )
    controllers[0]?.close()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    expect(new Headers(requests[1]?.headers).get('last-event-id')).toBe('event-7')
    subscription.dispose()
    runtime.dispose()
  })

  it('deduplicates event ids and ignores unknown or malformed invalidations', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetcher = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)

    const events: unknown[] = []
    const runtime = createWorkflowRuntimeEvents({
      baseUrl: 'https://os.example.test',
      reconnectDelayMs: 0,
    })
    const subscription = runtime.subscribe((event) => events.push(event))
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))

    controllers[0]?.enqueue(
      new TextEncoder().encode(
        [
          'id: ignored-1',
          'event: unrelated.event',
          'data: {"workflow_task_uuid":"task-ignored"}',
          '',
          'id: malformed-1',
          'event: workflow.runtime.changed',
          'data: {"workflow_task_uuid":',
          '',
          'id: event-1',
          'event: workflow.runtime.changed',
          'data: {"workflow_task_uuid":"task-1"}',
          '',
          'id: event-1',
          'event: workflow.runtime.changed',
          'data: {"workflow_task_uuid":"task-1"}',
          '',
        ].join('\n') + '\n',
      ),
    )
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controllers[0]?.enqueue(
      new TextEncoder().encode(
        ['id: event-2', 'event: device_action_task.changed', 'data: {"task_uuid":"task-2"}', ''].join(
          '\n',
        ) + '\n',
      ),
    )
    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(events).toEqual([
      expect.objectContaining({
        id: 'event-1',
        event: 'workflow.runtime.changed',
        workflowTaskUuid: 'task-1',
      }),
      expect.objectContaining({
        id: 'event-2',
        event: 'device_action_task.changed',
        workflowTaskUuid: 'task-2',
      }),
    ])

    subscription.dispose()
    runtime.dispose()
    controllers.forEach((controller) => controller.close())
  })

  it('reports an HTTP stream failure and reconnects after a response without a body', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    let attempt = 0
    const fetcher = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return new Response('offline', { status: 503 })
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
      })
      return new Response(stream, { status: 200 })
    })
    vi.stubGlobal('fetch', fetcher)

    const errors: Error[] = []
    const opens: Array<{ lastEventId: string; reconnected: boolean }> = []
    const runtime = createWorkflowRuntimeEvents({
      baseUrl: 'https://os.example.test',
      reconnectDelayMs: 0,
    })
    const subscription = runtime.subscribe(() => undefined, {
      onError: (error) => errors.push(error),
      onOpen: (state) => opens.push(state),
    })

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(errors[0]?.message).toBe('503 ')
    expect(opens).toEqual([{ lastEventId: '', reconnected: false }])

    subscription.dispose()
    runtime.dispose()
    controllers.forEach((controller) => controller.close())
  })
})
