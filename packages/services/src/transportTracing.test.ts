import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HttpRequestTraceEvent } from './http'
import { connectDeviceStatus } from './realtime'
import { createWorkflowSseTransport } from './workflowSse'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Edge streaming transport tracing', () => {
  it('injects traceparent into the workflow SSE request', async () => {
    const events: HttpRequestTraceEvent[] = []
    let transport: ReturnType<typeof createWorkflowSseTransport>
    const opened = new Promise<void>((resolve) => {
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('traceparent')).toMatch(
          /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
        )
        return new Response(new ReadableStream({ start: (controller) => controller.close() }))
      }))
      transport = createWorkflowSseTransport(
        'http://127.0.0.1:18003/api/v1/events',
        (event) => { events.push(event) }
      )
      transport.subscribe({
        onOpen: () => {
          transport.dispose()
          resolve()
        },
        onFrame: () => undefined
      })
    })

    await opened

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      transport: 'sse',
      path: '/api/v1/events',
      outcome: 'open',
      statusCode: 200
    })
  })

  it('passes WebSocket trace context in the handshake query', async () => {
    const events: HttpRequestTraceEvent[] = []
    const urls: string[] = []

    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null

      constructor(url: string | URL) {
        expect(typeof url).toBe('string')
        urls.push(String(url))
        queueMicrotask(() => this.onopen?.())
      }

      close(): void {}
    }

    vi.stubGlobal('WebSocket', FakeWebSocket)
    const opened = new Promise<void>((resolve) => {
      const close = connectDeviceStatus(
        'http://127.0.0.1:18003',
        { onDeviceStatus: () => undefined, onOpen: resolve },
        (event) => { events.push(event) }
      )
      void close
    })

    await opened

    const traceparent = new URL(urls[0] ?? '').searchParams.get('traceparent')
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(events[0]).toMatchObject({
      transport: 'websocket',
      path: '/api/v1/ws/device_status',
      outcome: 'open',
      statusCode: 101,
      traceparent
    })
  })
})
