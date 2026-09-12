import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import {
  createHttpClient,
  requestData,
  type HttpRequestTraceEvent
} from './http'

describe('createHttpClient tracing', () => {
  it('injects W3C context into every Edge request and reports completion', async () => {
    const events: HttpRequestTraceEvent[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const traceparent = new Headers(init?.headers).get('traceparent')
      expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
      return Response.json({ ok: true }, { status: 201 })
    }) as typeof fetch
    const client = createHttpClient({
      backend: getDefaultBackend('local-python'),
      fetcher,
      traceRequest: (event) => { events.push(event) }
    })

    await expect(client.request('/api/v1/workflows?limit=20', {
      method: 'POST'
    })).resolves.toEqual({ ok: true })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      transport: 'http',
      method: 'POST',
      path: '/api/v1/workflows',
      statusCode: 201,
      outcome: 'ok'
    })
    expect(events[0]?.traceparent).toBe(
      `00-${events[0]?.traceId}-${events[0]?.spanId}-01`
    )
  })

  it('reports failed Edge requests without allowing the reporter to break requests', async () => {
    const traceRequest = vi.fn(() => { throw new Error('ipc unavailable') })
    const client = createHttpClient({
      backend: getDefaultBackend('local-python'),
      fetcher: vi.fn(async () => new Response('bad gateway', { status: 502 })),
      traceRequest
    })

    await expect(client.request('/api/v1/materials')).rejects.toMatchObject({
      code: 'HTTP_REQUEST_FAILED',
      status: 502
    })
    expect(traceRequest).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'error',
      statusCode: 502
    }))
  })

  it('does not add Edge trace headers to non-OS backends', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('traceparent')).toBe(false)
      return Response.json({ ok: true })
    }) as typeof fetch
    const traceRequest = vi.fn()
    const client = createHttpClient({
      backend: getDefaultBackend('local-go'),
      fetcher,
      traceRequest
    })

    await client.request('/api/v1/health')

    expect(traceRequest).not.toHaveBeenCalled()
  })

  it('保留 Backend HTTP 200 error.msg 业务错误', async () => {
    const client = createHttpClient({
      backend: getDefaultBackend('local-go'),
      fetcher: vi.fn(async () => Response.json({
        code: 1007,
        error: { msg: 'workflow revision conflict', info: { revision: 2 } }
      })) as typeof fetch
    })

    await expect(requestData(client, '/api/v1/workflows')).rejects
      .toMatchObject({
        code: 'API_1007',
        message: 'workflow revision conflict'
      })
  })

  it('保留 Backend 非 2xx error.msg', async () => {
    const client = createHttpClient({
      backend: getDefaultBackend('local-go'),
      fetcher: vi.fn(async () => Response.json({
        code: 401,
        error: { msg: 'Unauthorized' }
      }, {
        status: 401,
        statusText: 'Unauthorized'
      })) as typeof fetch
    })

    await expect(client.request('/api/v1/workflows')).rejects.toMatchObject({
      message: 'Unauthorized',
      status: 401
    })
  })
})


describe('request-specific budgets', () => {
  it('keeps ordinary reads at 8 seconds while an explicit create budget lasts 30 seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        expect(init).not.toHaveProperty('timeoutMs')
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as typeof fetch
      const http = createHttpClient({ backend: getDefaultBackend('local-python'), fetcher })
      const read = http.request('/api/v1/workflow-tasks').catch(error => error)
      const create = http.request('/api/v1/workflow-tasks', { method: 'POST', timeoutMs: 30_000 }).catch(error => error)
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await read).toMatchObject({ code: 'HTTP_REQUEST_TIMEOUT' })
      expect(vi.mocked(fetcher).mock.calls[1]?.[1]?.signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(22_000)
      expect(await create).toMatchObject({ code: 'HTTP_REQUEST_TIMEOUT' })
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
})
