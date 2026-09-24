import { describe, expect, it } from 'vitest'
import { WorkflowDefinitionClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

class FakeTransport implements RequestTransport {
  readonly requests: TransportRequest[] = []

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    const data = request.url.endsWith('/graph')
      ? {
          workflow: { uuid: 'wf-1', revision: 2 },
          nodes: [],
          edges: [],
          node_templates: [],
          handle_templates: [],
          inventory_requirements: []
        }
      : { uuid: 'wf-1', name: 'Published', revision: 2, workflow_type: 'workflow', status: 'published' }
    return { status: 200, headers: {}, data: data as Value }
  }
}

describe('workflow definition client', () => {
  it('keeps routes and transport out of the scenario-facing port', async () => {
    const transport = new FakeTransport()
    const client = new WorkflowDefinitionClient(transport)
    const result = await client.getPublishedRevision('wf/1')

    expect(result.workflowUuid).toBe('wf-1')
    expect(transport.requests.map(request => request.url)).toEqual([
      '/api/v1/workflows/wf%2F1',
      '/api/v1/workflows/wf%2F1/graph'
    ])
  })
})
