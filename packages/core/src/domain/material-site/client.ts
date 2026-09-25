import type { RequestTransport } from '../../transport/request'
import type {
  MaterialDetailResponse,
  MaterialGraphResponse,
  MaterialListResponse,
  SiteListResponse,
  MaterialSiteRecord
} from './api'
import {
  decodeMaterialDetail,
  decodeMaterialGraph,
  decodeMaterialList,
  decodeSiteDetail,
  decodeSiteList
} from './codec'
import type { MaterialSitePort } from './port'

export class MaterialSiteClient implements MaterialSitePort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async listMaterials(input: {
    readonly page?: number
    readonly pageSize?: number
    readonly name?: string
    readonly barcode?: string
    readonly resourceTemplateUuid?: string
  } = {}) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 100)
    })
    if (input.name) params.set('name', input.name)
    if (input.barcode) params.set('barcode', input.barcode)
    if (input.resourceTemplateUuid) {
      params.set('resource_template_uuid', input.resourceTemplateUuid)
    }
    const response = await this.transport.request<MaterialListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/materials?${params.toString()}`
    })
    return decodeMaterialList(response.data)
  }

  async getGraph() {
    const response = await this.transport.request<MaterialGraphResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/materials/graph`
    })
    return decodeMaterialGraph(response.data)
  }

  async getMaterial(materialUuid: string) {
    const response = await this.transport.request<MaterialDetailResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/materials/${encodeURIComponent(materialUuid)}`
    })
    return decodeMaterialDetail(response.data)
  }

  async listSites(materialUuid: string) {
    const response = await this.transport.request<SiteListResponse | readonly MaterialSiteRecord[]>({
      method: 'GET',
      url: `${this.apiPrefix}/materials/${encodeURIComponent(materialUuid)}/sites`
    })
    return decodeSiteList(response.data, 'sites', materialUuid)
  }

  async getSite(siteUuid: string) {
    const response = await this.transport.request<MaterialSiteRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/sites/${encodeURIComponent(siteUuid)}`
    })
    return decodeSiteDetail(response.data)
  }
}
