import { describe, expect, it } from 'vitest'
import { EvidenceInterventionClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('EvidenceInterventionClient', () => {
  it('reads intervention list and detail through explicit routes', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        const data = request.url.includes('?')
          ? { items: [intervention('intervention-1')] }
          : intervention('intervention/1')
        return { status: 200, headers: {}, data: { code: 0, data } } as TransportResponse<Value>
      }
    }

    const client = new EvidenceInterventionClient(transport)
    await expect(client.listInterventions({ status: 'open', limit: 20 })).resolves.toMatchObject([
      { interventionUuid: 'intervention-1' }
    ])
    await expect(client.getIntervention('intervention/1')).resolves.toMatchObject({
      interventionUuid: 'intervention/1'
    })

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/v1/workflow-interventions?status=open&limit=20' },
      { method: 'GET', url: '/api/v1/workflow-interventions/intervention%2F1' }
    ])
  })
})

function intervention(uuid: string) {
  return {
    uuid,
    create_time: '2026-09-25T00:00:00Z',
    update_time: '2026-09-25T00:00:01Z',
    meta_data: {},
    workflow_task_uuid: 'task-1',
    workflow_node_job_uuid: 'job-1',
    revision: 1,
    status: 'open',
    options: [{ id: 'retry' }],
    resume_control_status: 'active',
    selected_option: {},
    delivery_status: 'none',
    opened_at: '2026-09-25T00:00:00Z'
  }
}
