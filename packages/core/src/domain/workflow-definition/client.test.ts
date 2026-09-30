import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowDefinitionClient } from './client'
import { createFetchTransport } from '../../adapters/fetch'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

class FakeTransport implements RequestTransport {
  readonly requests: TransportRequest[] = []

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    const data = request.url.includes('/workflows?')
      ? {
          code: 0,
          data: {
            items: [
              {
                uuid: 'wf-1',
                name: 'Published',
                revision: 2,
                workflow_type: 'workflow',
                status: 'published',
              },
            ],
          },
        }
      : request.url.endsWith('/graph')
        ? {
            workflow: { uuid: 'wf-1', revision: 2 },
            nodes: [],
            edges: [],
            node_templates: [],
            handle_templates: [],
            inventory_requirements: [],
          }
        : {
            uuid: 'wf-1',
            name: 'Published',
            revision: 2,
            workflow_type: 'workflow',
            status: 'published',
          }
    return { status: 200, headers: {}, data: data as Value }
  }
}

describe('workflow definition client', () => {
  afterEach(() => vi.useRealTimers())

  it.each(['catalog', 'graph'] as const)(
    'reads a slow OS %s beyond the normal request timeout without retrying',
    async kind => {
      vi.useFakeTimers()
      const signals: AbortSignal[] = []
      const fetcher = vi.fn<typeof fetch>((url, init) => {
        const signal = init?.signal
        if (signal) signals.push(signal)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(async () => {
            const response = await new FakeTransport().request({ method: 'GET', url: String(url) })
            resolve(new Response(JSON.stringify(response.data), { status: 200 }))
          }, 20_000)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('OS read was aborted'))
          }, { once: true })
        })
      })
      const client = new WorkflowDefinitionClient(createFetchTransport({
        baseUrl: 'http://os.example.test', timeoutMs: 12_000, fetcher
      }))
      const outcome = (kind === 'catalog'
        ? client.listPublishedRevisions()
        : client.getPublishedRevision('wf-1')).then(
        value => ({ ok: true, value }), error => ({ ok: false, error })
      )
      await vi.advanceTimersByTimeAsync(12_000)
      expect(signals.every(signal => !signal.aborted)).toBe(true)
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await outcome).toMatchObject({ ok: true })
      expect(fetcher).toHaveBeenCalledTimes(kind === 'catalog' ? 1 : 2)
    }
  )

  function pagedTransport(pages: readonly unknown[]): RequestTransport & { requests: TransportRequest[] } {
    return {
      requests: [],
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        this.requests.push(request)
        const data = pages[this.requests.length - 1]
        if (data instanceof Error) throw data
        return { status: 200, headers: {}, data: data as Value }
      }
    }
  }

  const summary = (uuid: string) => ({ uuid, name: uuid, revision: 1, workflow_type: 'normal', status: 'source' })

  it('follows has_more when OS caps the requested page size', async () => {
    const transport = pagedTransport([
      { code: 0, data: { items: [summary('one'), summary('two')], page_size: 2, has_more: true } },
      { code: 0, data: { items: [summary('three')], page_size: 2, has_more: false } }
    ])
    const result = await new WorkflowDefinitionClient(transport).listPublishedRevisions({
      status: 'all', pageSize: 200, allPages: true
    })
    expect(result.map(item => item.workflowUuid)).toEqual(['one', 'two', 'three'])
    expect(transport.requests.map(request => request.url)).toEqual([
      '/api/v1/workflows?page=1&page_size=200',
      '/api/v1/workflows?page=2&page_size=200'
    ])
  })

  it('does not return a partial catalog when a later page fails', async () => {
    const transport = pagedTransport([
      { items: [summary('one')], has_more: true }, new Error('OS disconnected')
    ])
    await expect(new WorkflowDefinitionClient(transport).listPublishedRevisions({ allPages: true }))
      .rejects.toThrow('OS disconnected')
  })

  it('rejects repeated pages instead of looping or duplicating workflow choices', async () => {
    const transport = pagedTransport([
      { items: [summary('one')], has_more: true },
      { items: [summary('one')], has_more: true }
    ])
    await expect(new WorkflowDefinitionClient(transport).listPublishedRevisions({ allPages: true }))
      .rejects.toThrow('工作流目录分页重复')
  })

  it('rejects missing pagination metadata when the caller requires the full catalog', async () => {
    await expect(new WorkflowDefinitionClient(new FakeTransport()).listPublishedRevisions({ allPages: true }))
      .rejects.toThrow('has_more')
  })

  it('reads only published workflow summaries with an explicit page contract', async () => {
    const transport = new FakeTransport()
    const client = new WorkflowDefinitionClient(transport)
    await expect(client.listPublishedRevisions({ page: 2, pageSize: 10 })).resolves.toMatchObject([
      { workflowUuid: 'wf-1', status: 'published' },
    ])
    expect(transport.requests[0]?.url).toBe(
      '/api/v1/workflows?page=2&page_size=10&status=published',
    )
  })

  it('can read the complete workflow catalog for management pages', async () => {
    const transport = new FakeTransport()
    const client = new WorkflowDefinitionClient(transport)
    await client.listPublishedRevisions({ status: 'all' })

    expect(transport.requests[0]?.url).toBe('/api/v1/workflows?page=1&page_size=100')
  })

  it('keeps routes and transport out of the scenario-facing port', async () => {
    const transport = new FakeTransport()
    const client = new WorkflowDefinitionClient(transport)
    const result = await client.getPublishedRevision('wf/1')

    expect(result.workflowUuid).toBe('wf-1')
    expect(transport.requests.map((request) => request.url)).toEqual([
      '/api/v1/workflows/wf%2F1',
      '/api/v1/workflows/wf%2F1/graph',
    ])
  })
})
