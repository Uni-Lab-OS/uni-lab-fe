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

  it('sends manual load and unload as a site placement with the read revision', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        const data = {
          uuid: 'material-1',
          resource_template_uuid: 'template-1',
          name: 'Tray',
          revision: 8,
          sites: [],
          current_site: null,
        }
        return { status: 200, headers: {}, data: { code: 0, data } } as TransportResponse<Value>
      },
    }
    const client = new MaterialSiteClient(transport)

    await expect(
      client.updateSitePlacement({
        materialUuid: 'material/1',
        placement: { action: 'remove' },
        expectedRevision: 7,
      }),
    ).resolves.toMatchObject({ kind: 'material_detail', revision: 8 })
    await client.updateSitePlacement({
      materialUuid: 'material/1',
      placement: { action: 'place', siteUuid: 'site-2' },
      expectedRevision: null,
    })

    expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: 'PUT',
        url: '/api/v1/materials/material%2F1',
        body: { site_placement: { action: 'remove' }, expected_revision: 7 },
      },
      {
        method: 'PUT',
        url: '/api/v1/materials/material%2F1',
        body: { site_placement: { action: 'place', site_uuid: 'site-2' } },
      },
    ])
  })
})
