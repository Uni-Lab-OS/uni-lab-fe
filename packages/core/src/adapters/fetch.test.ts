import { describe, expect, it } from 'vitest'
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
})
