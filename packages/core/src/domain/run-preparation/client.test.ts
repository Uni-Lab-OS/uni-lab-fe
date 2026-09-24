import { describe, expect, it } from 'vitest'
import { RunPreparationClient } from './client'
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
    checks: []
  }

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    if (request.url.endsWith('/workflow-tasks')) {
      return {
        status: 202,
        headers: {},
        data: { task_uuid: 'task-1', accepted_at: '2026-09-24T00:00:01Z' } as Value
      }
    }
    return { status: 200, headers: {}, data: this.response as Value }
  }
}

const configuration: RunConfiguration = { runMode: 'normal', input: {} }
const binding: BindingDraft = { source: 'user', inventoryBindings: [], selectedResources: {} }

describe('run preparation client', () => {
  it('serializes preflight and submit requests through the generic transport', async () => {
    const transport = new FakeTransport()
    const client = new RunPreparationClient(transport)

    await client.requestPreflight('wf-1', configuration, binding)
    await client.submitRun('wf-1', { ...configuration, description: 'debug run' }, binding)

    expect(transport.requests.map(request => [request.method, request.url])).toEqual([
      ['POST', '/api/v1/workflows/wf-1/run-preflight'],
      ['POST', '/api/v1/workflow-tasks']
    ])
    expect(transport.requests[1]?.body).toMatchObject({
      workflow_uuid: 'wf-1',
      priority: 'normal',
      description: 'debug run'
    })
  })

  it('blocks unmapped selected resources before submit', async () => {
    const client = new RunPreparationClient(new FakeTransport())
    await expect(client.submitRun('wf-1', configuration, {
      ...binding,
      selectedResources: { device: 'device-1' }
    })).rejects.toMatchObject({ code: 'UNMAPPED_RESOURCE_SELECTION' })
  })
})
