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
          ? {
              items: [{ uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' }],
              total: 1,
              page: 2,
              page_size: 10,
            }
          : request.url === '/api/v1/reagent-infos/info%2F1'
            ? { uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' }
            : request.url.startsWith('/api/v1/reagents?')
              ? {
                  items: [
                    {
                      uuid: 'reagent-1',
                      material_uuid: 'material-1',
                      reagent_info_uuid: 'info-1',
                      name: '乙腈',
                      meta_data: {},
                      revision: 1,
                    },
                  ],
                }
              : request.url === '/api/v1/reagents/reagent%2F1'
                ? {
                    uuid: 'reagent-1',
                    material_uuid: 'material-1',
                    reagent_info_uuid: 'info-1',
                    name: '乙腈',
                    meta_data: {},
                    revision: 1,
                  }
                : request.url === '/api/v1/inventory/instances'
                  ? {
                      instances: [
                        { edge_uuid: 'instance-1', template_id: 'vial', status: 'available' },
                      ],
                    }
                  : request.url === '/api/v1/inventory/instances/instance%2F1'
                    ? { edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }
                    : request.url === '/api/v1/inventory/lots'
                      ? {
                          lots: [
                            {
                              lot_id: 'lot-1',
                              template_id: 'reagent',
                              quantity_total: 1,
                              quantity_available: 1,
                              quantity_reserved: 0,
                              version: 1,
                            },
                          ],
                        }
                      : request.url === '/api/v1/inventory/lots/lot%2F1'
                        ? {
                            lot_id: 'lot-1',
                            template_id: 'reagent',
                            quantity_total: 1,
                            quantity_available: 1,
                            quantity_reserved: 0,
                            version: 1,
                          }
                        : { snapshot_sequence: 1 }
        return { status: 200, headers: {}, data } as TransportResponse<Value>
      },
    }

    const client = new ReagentInventoryClient(transport)
    await expect(
      client.listReagentInfos({ page: 2, pageSize: 10, name: '乙腈', physicalState: 'liquid' }),
    ).resolves.toMatchObject({ page: 2 })
    await expect(client.getReagentInfo('info/1')).resolves.toMatchObject({
      reagentInfoUuid: 'info-1',
    })
    await expect(
      client.listReagents({ materialUuid: 'material-1', keyword: '乙腈' }),
    ).resolves.toHaveProperty('items')
    await expect(client.getReagent('reagent/1')).resolves.toMatchObject({
      reagentUuid: 'reagent-1',
    })
    await expect(client.listInventoryInstances()).resolves.toHaveLength(1)
    await expect(client.getInventoryInstance('instance/1')).resolves.toMatchObject({
      instanceUuid: 'instance-1',
    })
    await expect(client.listInventoryLots()).resolves.toHaveLength(1)
    await expect(client.getInventoryLot('lot/1')).resolves.toMatchObject({ lotId: 'lot-1' })
    await expect(client.getInventorySnapshot()).resolves.toMatchObject({ snapshotSequence: 1 })

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: 'GET',
        url: '/api/v1/reagent-infos?page=2&page_size=10&name=%E4%B9%99%E8%85%88&physical_state=liquid',
      },
      { method: 'GET', url: '/api/v1/reagent-infos/info%2F1' },
      {
        method: 'GET',
        url: '/api/v1/reagents?page=1&page_size=100&material_uuid=material-1&keyword=%E4%B9%99%E8%85%88',
      },
      { method: 'GET', url: '/api/v1/reagents/reagent%2F1' },
      { method: 'GET', url: '/api/v1/inventory/instances' },
      { method: 'GET', url: '/api/v1/inventory/instances/instance%2F1' },
      { method: 'GET', url: '/api/v1/inventory/lots' },
      { method: 'GET', url: '/api/v1/inventory/lots/lot%2F1' },
      { method: 'GET', url: '/api/v1/inventory/snapshot' },
    ])
  })

  it('uses the Backend reagent write routes and the shared inventory command entry', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        const info = { uuid: 'info-1', name: '乙醇', aliases: [], physical_state: 'liquid' }
        const reagent = {
          uuid: 'reagent-1',
          material_uuid: 'material-1',
          reagent_info_uuid: 'info-1',
          name: '乙醇',
          meta_data: {},
          revision: 1,
          quantity: 500,
          quantity_unit: 'mL',
        }
        const data =
          request.url === '/api/v1/inventory/commands'
            ? {
                command_id: 'dispense-1',
                status: 'completed',
                result: {
                  source: {
                    reagent_uuid: 'reagent-1',
                    quantity: 400,
                    quantity_unit: 'mL',
                    revision: 2,
                  },
                  targets: [
                    { reagent_uuid: 'reagent-2', quantity: 100, quantity_unit: 'mL', revision: 1 },
                  ],
                },
              }
            : request.url.endsWith('/reagent-infos/batch') ||
                request.url.includes('/reagent-infos/import')
              ? {
                  code: 0,
                  data: {
                    total: 1,
                    created: 1,
                    failed: 0,
                    atomic: true,
                    items: [info],
                    errors: [],
                  },
                }
              : request.url.includes('/reagents/import')
                ? {
                    code: 0,
                    data: {
                      total: 1,
                      created: 1,
                      failed: 0,
                      atomic: false,
                      items: [reagent],
                      errors: [],
                    },
                  }
                : request.url === '/api/v1/reagents'
                  ? { code: 0, data: reagent }
                  : request.url === '/api/v1/reagents/reagent-1'
                    ? { code: 0, data: reagent }
                    : request.url === '/api/v1/compounds/64-17-5'
                      ? {
                          code: 0,
                          data: { cas: '64-17-5', status: 'ok', compound: { name: 'Ethanol' } },
                        }
                      : request.url.endsWith('/structure-3d')
                        ? {
                            code: 0,
                            data: {
                              reagent_info_uuid: 'info-1',
                              status: 'pending',
                              identity_key: '',
                              format: '',
                            },
                          }
                        : request.url.includes('/reagent-history?')
                          ? {
                              code: 0,
                              data: {
                                items: [
                                  {
                                    uuid: 'entry-1',
                                    material_uuid: 'material-1',
                                    event_type: 'increase',
                                    operator_type: 'frontend',
                                    recorded_at: '2026-09-29T06:34:58.128Z',
                                    subject_type: 'reagent',
                                    subject_uuid: 'reagent-1',
                                  },
                                ],
                                page: 1,
                                page_size: 20,
                                has_more: false,
                              },
                            }
                          : { code: 0, data: info }
        return { status: 200, headers: {}, data } as TransportResponse<Value>
      },
    }

    const client = new ReagentInventoryClient(transport)
    await expect(
      client.createReagentInfo({ name: '乙醇', cas: '64-17-5', physicalState: 'liquid' }),
    ).resolves.toMatchObject({ reagentInfoUuid: 'info-1' })
    await expect(
      client.updateReagentInfo('info-1', { description: '联调更新' }),
    ).resolves.toMatchObject({ reagentInfoUuid: 'info-1' })
    await expect(client.deleteReagentInfo('info-1')).resolves.toBeUndefined()
    await expect(
      client.createReagentInfoBatch({ items: [{ name: '乙醇' }], atomic: true }),
    ).resolves.toMatchObject({ created: 1 })
    await expect(client.getReagentInfoStructure3d('info-1')).resolves.toMatchObject({
      status: 'pending',
    })
    await expect(client.lookupCompound('64-17-5')).resolves.toMatchObject({ status: 'ok' })
    await expect(
      client.createReagent({
        materialUuid: 'material-1',
        reagentInfoUuid: 'info-1',
        quantity: 500,
        quantityUnit: 'mL',
        containerCapacity: { maxVolumeUl: 1000000 },
      }),
    ).resolves.toMatchObject({ reagentUuid: 'reagent-1' })
    await expect(
      client.updateReagent('reagent-1', { quantity: 400, quantityUnit: 'mL', expectedRevision: 1 }),
    ).resolves.toMatchObject({ reagentUuid: 'reagent-1' })
    await expect(client.deleteReagent('reagent-1')).resolves.toBeUndefined()
    await expect(
      client.listReagentHistory('material-1', { page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ hasMore: false })
    await expect(
      client.dispenseReagent({
        commandId: 'dispense-1',
        sourceReagentUuid: 'reagent-1',
        quantityUnit: 'mL',
        expectedRevision: 1,
        actor: 'developer-web',
        targets: [{ materialUuid: 'material-2', quantity: 100 }],
      }),
    ).resolves.toMatchObject({ status: 'completed', targets: [{ reagentUuid: 'reagent-2' }] })

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'POST', url: '/api/v1/reagent-infos' },
      { method: 'PUT', url: '/api/v1/reagent-infos/info-1' },
      { method: 'DELETE', url: '/api/v1/reagent-infos/info-1' },
      { method: 'POST', url: '/api/v1/reagent-infos/batch' },
      { method: 'GET', url: '/api/v1/reagent-infos/info-1/structure-3d' },
      { method: 'GET', url: '/api/v1/compounds/64-17-5' },
      { method: 'POST', url: '/api/v1/reagents' },
      { method: 'PUT', url: '/api/v1/reagents/reagent-1' },
      { method: 'DELETE', url: '/api/v1/reagents/reagent-1' },
      { method: 'GET', url: '/api/v1/materials/material-1/reagent-history?page=1&page_size=20' },
      { method: 'POST', url: '/api/v1/inventory/commands' },
    ])

    expect(requests[6]?.body).toEqual({
      material_uuid: 'material-1',
      reagent_info_uuid: 'info-1',
      quantity: 500,
      quantity_unit: 'mL',
      container_capacity: { max_volume_ul: 1000000 },
    })
    expect(requests[10]?.body).toEqual({
      command_id: 'dispense-1',
      type: 'reagent.dispense',
      actor: 'developer-web',
      payload: {
        source_reagent_uuid: 'reagent-1',
        quantity_unit: 'mL',
        expected_revision: 1,
        targets: [{ material_uuid: 'material-2', quantity: 100 }],
      },
    })
  })

  it('uploads import files as multipart so the transport cannot serialize them as JSON', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        return {
          status: 200,
          headers: {},
          data: {
            code: 0,
            data: { total: 1, created: 1, failed: 0, atomic: false, items: [], errors: [] },
          },
        } as TransportResponse<Value>
      },
    }

    const client = new ReagentInventoryClient(transport)
    await expect(
      client.importReagents({
        file: new Blob(['name,quantity\n乙醇,1'], { type: 'text/csv' }),
        fileName: 'reagents.csv',
        atomic: false,
      }),
    ).resolves.toMatchObject({ created: 1 })

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/reagents/import?atomic=false',
    })
    const body = requests[0]?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBeInstanceOf(Blob)
    // 显式 JSON content-type 会破坏 multipart boundary，这里不得设置。
    expect(requests[0]?.headers).toBeUndefined()
  })
})
