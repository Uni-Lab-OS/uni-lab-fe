import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunPreparationClient } from './client'
import { createFetchTransport } from '../../adapters/fetch'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'
import type { BindingDraft, RunConfiguration } from './model'

class FakeTransport implements RequestTransport {
  readonly requests: TransportRequest[] = []
  response: unknown = {
    workflow_uuid: 'wf-1',
    workflow_revision: 2,
    status: 'runnable_now',
    can_run: true,
    checked_at: '2026-09-24T00:00:00Z',
    checks: [],
  }

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    if (request.url.endsWith('/workflow-tasks')) {
      return {
        status: 202,
        headers: {},
        data: { task_uuid: 'task-1', accepted_at: '2026-09-24T00:00:01Z' } as Value,
      }
    }
    return { status: 200, headers: {}, data: this.response as Value }
  }
}

const configuration: RunConfiguration = { runMode: 'normal', input: {} }
const binding: BindingDraft = { source: 'user', inventoryBindings: [], selectedResources: {} }

describe('run preparation client', () => {
  afterEach(() => vi.useRealTimers())

  it.each(['requestPreflight', 'submitRun'] as const)(
    'waits for a slow OS %s response beyond the normal read timeout without retrying',
    async method => {
      vi.useFakeTimers()
      let signal: AbortSignal | null | undefined
      const fetcher = vi.fn<typeof fetch>((_url, init) => {
        signal = init?.signal
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response(JSON.stringify(
            method === 'requestPreflight'
              ? new FakeTransport().response
              : { task_uuid: 'task-1', accepted_at: '2026-09-24T00:00:01Z' }
          ), { status: method === 'requestPreflight' ? 200 : 201 })), 20_000)
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('OS request was aborted'))
          }, { once: true })
        })
      })
      const client = new RunPreparationClient(createFetchTransport({
        baseUrl: 'http://os.example.test', timeoutMs: 12_000, fetcher
      }))
      const outcome = client[method]('wf-1', configuration, binding).then(
        value => ({ ok: true, value }), error => ({ ok: false, error })
      )
      await vi.advanceTimersByTimeAsync(12_000)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(8_000)
      expect(await outcome).toMatchObject({ ok: true })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )

  it('serializes preflight and submit requests through the generic transport', async () => {
    const transport = new FakeTransport()
    const client = new RunPreparationClient(transport)

    await client.requestPreflight('wf-1', configuration, binding)
    await client.submitRun('wf-1', { ...configuration, description: 'debug run' }, binding)

    expect(transport.requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', '/api/v1/workflows/wf-1/run-preflight'],
      ['POST', '/api/v1/workflow-tasks'],
    ])
    expect(transport.requests[1]?.body).toMatchObject({
      workflow_uuid: 'wf-1',
      priority: 'normal',
      description: 'debug run',
    })
  })

  it('blocks unmapped selected resources before submit', async () => {
    const client = new RunPreparationClient(new FakeTransport())
    await expect(
      client.submitRun('wf-1', configuration, {
        ...binding,
        selectedResources: { device: 'device-1' },
      }),
    ).rejects.toMatchObject({ code: 'UNMAPPED_RESOURCE_SELECTION' })
  })
})
