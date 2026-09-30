import { describe, expect, it } from 'vitest'
import { MaterialSiteClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('MaterialSiteClient', () => {
  it('uses the material and Site read routes', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        const data = request.url.startsWith('/api/v1/materials?')
          ? {
              items: [
                {
                  uuid: 'material-1',
                  resource_template_uuid: 'template-1',
                  name: 'Vial',
                },
              ],
              total: 1,
              page: 2,
              page_size: 10,
            }
          : request.url === '/api/v1/materials/graph'
            ? { nodes: [] }
            : request.url === '/api/v1/materials/material%2F1'
              ? {
                  uuid: 'material-1',
                  resource_template_uuid: 'template-1',
                  name: 'Vial',
                  sites: [],
                  current_site: null,
                }
              : request.url === '/api/v1/materials/material%2F1/sites'
                ? [{ uuid: 'site-1', material_uuid: 'material/1', name: 'A1' }]
                : { uuid: 'site-1', material_uuid: 'material/1', name: 'A1' }
        return { status: 200, headers: {}, data: { code: 0, data } } as TransportResponse<Value>
      },
    }

    const client = new MaterialSiteClient(transport)
    await expect(
      client.listMaterials({ page: 2, pageSize: 10, name: 'Vial' }),
    ).resolves.toMatchObject({
      page: 2,
      pageSize: 10,
      items: [{ materialUuid: 'material-1' }],
    })
    await expect(client.getGraph()).resolves.toMatchObject({ kind: 'material_graph', nodes: [] })
    await expect(client.getMaterial('material/1')).resolves.toMatchObject({
      kind: 'material_detail',
    })
    await expect(client.listSites('material/1')).resolves.toMatchObject([{ siteUuid: 'site-1' }])
    await expect(client.getSite('site/1')).resolves.toMatchObject({ siteUuid: 'site-1' })

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: '/api/v1/materials?page=2&page_size=10&name=Vial' },
      { method: 'GET', url: '/api/v1/materials/graph' },
      { method: 'GET', url: '/api/v1/materials/material%2F1' },
      { method: 'GET', url: '/api/v1/materials/material%2F1/sites' },
      { method: 'GET', url: '/api/v1/sites/site%2F1' },
    ])
  })
})
