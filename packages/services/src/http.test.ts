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

  it('保留 OS 库存命令的直接错误码与错误消息', async () => {
    const client = createHttpClient({
      backend: getDefaultBackend('local-python'),
      fetcher: vi.fn(async () => Response.json({
        command_id: 'attach-1',
        status: 'rejected',
        error: 'site is occupied',
        error_code: 'material_site_occupied'
      }, { status: 409 })) as typeof fetch
    })

    await expect(client.request('/api/v1/inventory/commands')).rejects
      .toMatchObject({
        code: 'material_site_occupied',
        message: 'site is occupied',
        status: 409
      })
  })
})
