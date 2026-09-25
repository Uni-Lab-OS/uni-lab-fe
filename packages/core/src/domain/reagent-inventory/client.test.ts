import { describe, expect, it } from 'vitest'
import { ReagentInventoryClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('ReagentInventoryClient', () => {
  it('uses explicit Backend reagent and Edge inventory read routes', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        const data = request.url.startsWith('/api/v1/reagent-infos?')
          ? { items: [{ uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' }], total: 1, page: 2, page_size: 10 }
          : request.url === '/api/v1/reagent-infos/info%2F1'
            ? { uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' }
            : request.url.startsWith('/api/v1/reagents?')
              ? { items: [{ uuid: 'reagent-1', material_uuid: 'material-1', reagent_info_uuid: 'info-1', name: '乙腈', meta_data: {}, revision: 1 }] }
              : request.url === '/api/v1/reagents/reagent%2F1'
                ? { uuid: 'reagent-1', material_uuid: 'material-1', reagent_info_uuid: 'info-1', name: '乙腈', meta_data: {}, revision: 1 }
                : request.url === '/api/v1/inventory/instances'
                  ? { instances: [{ edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }] }
                  : request.url === '/api/v1/inventory/instances/instance%2F1'
                    ? { edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }
                    : request.url === '/api/v1/inventory/lots'
                      ? { lots: [{ lot_id: 'lot-1', template_id: 'reagent', quantity_total: 1, quantity_available: 1, quantity_reserved: 0, version: 1 }] }
                      : request.url === '/api/v1/inventory/lots/lot%2F1'
                        ? { lot_id: 'lot-1', template_id: 'reagent', quantity_total: 1, quantity_available: 1, quantity_reserved: 0, version: 1 }
                        : { snapshot_sequence: 1 }
        return { status: 200, headers: {}, data } as TransportResponse<Value>
      }
    }

    const client = new ReagentInventoryClient(transport)
    await expect(client.listReagentInfos({ page: 2, pageSize: 10, name: '乙腈', physicalState: 'liquid' })).resolves.toMatchObject({ page: 2 })
    await expect(client.getReagentInfo('info/1')).resolves.toMatchObject({ reagentInfoUuid: 'info-1' })
    await expect(client.listReagents({ materialUuid: 'material-1', keyword: '乙腈' })).resolves.toHaveProperty('items')
    await expect(client.getReagent('reagent/1')).resolves.toMatchObject({ reagentUuid: 'reagent-1' })
    await expect(client.listInventoryInstances()).resolves.toHaveLength(1)
    await expect(client.getInventoryInstance('instance/1')).resolves.toMatchObject({ instanceUuid: 'instance-1' })
    await expect(client.listInventoryLots()).resolves.toHaveLength(1)
    await expect(client.getInventoryLot('lot/1')).resolves.toMatchObject({ lotId: 'lot-1' })
    await expect(client.getInventorySnapshot()).resolves.toMatchObject({ snapshotSequence: 1 })

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/v1/reagent-infos?page=2&page_size=10&name=%E4%B9%99%E8%85%88&physical_state=liquid' },
      { method: 'GET', url: '/api/v1/reagent-infos/info%2F1' },
      { method: 'GET', url: '/api/v1/reagents?page=1&page_size=100&material_uuid=material-1&keyword=%E4%B9%99%E8%85%88' },
      { method: 'GET', url: '/api/v1/reagents/reagent%2F1' },
      { method: 'GET', url: '/api/v1/inventory/instances' },
      { method: 'GET', url: '/api/v1/inventory/instances/instance%2F1' },
      { method: 'GET', url: '/api/v1/inventory/lots' },
      { method: 'GET', url: '/api/v1/inventory/lots/lot%2F1' },
      { method: 'GET', url: '/api/v1/inventory/snapshot' }
    ])
  })
})
