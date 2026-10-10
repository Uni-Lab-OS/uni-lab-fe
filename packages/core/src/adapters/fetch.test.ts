import { describe, expect, it, vi } from 'vitest'
import { createFetchTransport } from './fetch'

describe('createFetchTransport', () => {
  it('builds a JSON request from the generic transport contract', async () => {
    const calls: RequestInit[] = []
    const transport = createFetchTransport({
      baseUrl: 'https://os.example.test/',
      getAccessToken: () => 'Bearer token',
      fetcher: async (input, init) => {
        expect(input).toBe('https://os.example.test/api/v1/ping')
        calls.push(init ?? {})
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const response = await transport.request<{ ok: boolean }>({
      method: 'POST',
      url: '/api/v1/ping',
      body: { requestId: 'r-1' },
    })

    expect(response.data).toEqual({ ok: true })
    expect(calls[0]?.method).toBe('POST')
    const headers = new Headers(calls[0]?.headers)
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(calls[0]?.body).toBe(JSON.stringify({ requestId: 'r-1' }))
  })

  it('maps non-success responses to a transport error', async () => {
    const transport = createFetchTransport({
      baseUrl: 'https://os.example.test',
      fetcher: async () =>
        new Response(JSON.stringify({ error: { code: 'OS_BUSY', message: 'busy' } }), {
          status: 503,
        }),
    })

    await expect(transport.request({ method: 'GET', url: '/status' })).rejects.toMatchObject({
      name: 'TransportError',
      code: 'OS_BUSY',
      status: 503,
      retryable: true,
    })
  })

  it('supports passthrough bodies, absolute URLs and text responses', async () => {
    const calls: RequestInit[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {})
      expect(String(input)).toMatch(/^https:\/\/(other|os)\.example\.test\//)
      return new Response('plain text', { status: 200, headers: { 'x-request': 'ok' } })
    })
    const transport = createFetchTransport({ baseUrl: 'https://os.example.test', fetcher })
    await transport.request({ method: 'POST', url: 'https://other.example.test/ping', body: 'raw' })
    expect(calls[0]?.body).toBe('raw')
    const form = new FormData(); form.set('file', 'value')
    await transport.request({ method: 'POST', url: '/upload', headers: { 'content-type': 'wrong' }, body: form })
    expect(new Headers(calls[1]?.headers).get('content-type')).toBeNull()
    expect(await transport.request({ method: 'GET', url: '/text' })).toMatchObject({ headers: { 'x-request': 'ok' }, data: 'plain text' })
  })

  it('maps aborts, fetch failures and missing tokens', async () => {
    const aborted = createFetchTransport({ baseUrl: 'https://os.example.test', timeoutMs: 1, fetcher: async (_input, init) => await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }) })
    await expect(aborted.request({ method: 'GET', url: '/slow' })).rejects.toMatchObject({ code: 'HTTP_REQUEST_ABORTED', retryable: false })
    const failed = createFetchTransport({ baseUrl: 'https://os.example.test', getAccessToken: () => null, fetcher: async () => { throw new Error('offline') } })
    await expect(failed.request({ method: 'GET', url: '/offline' })).rejects.toMatchObject({ code: 'HTTP_REQUEST_FAILED', message: 'offline', retryable: true })
  })
})
