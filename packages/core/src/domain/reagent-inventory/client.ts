import type { RequestTransport } from '../../transport/request'
import {
  decodeInventoryInstance,
  decodeInventoryInstances,
  decodeInventoryLot,
  decodeInventoryLots,
  decodeInventorySnapshot,
  decodeReagent,
  decodeReagentInfo,
  decodeReagentInfoPage,
  decodeReagentPage
} from './codec'
import type { ReagentInventoryPort } from './port'
import type {
  EdgeInstanceListResponse,
  EdgeLotListResponse,
  EdgeSnapshotResponse,
  ReagentInfoListResponse,
  ReagentListResponse,
  ReagentInventoryRecord
} from './api'

export class ReagentInventoryClient implements ReagentInventoryPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async listReagentInfos(input: {
    readonly page?: number
    readonly pageSize?: number
    readonly name?: string
    readonly cas?: string
    readonly physicalState?: string
  } = {}) {
    const params = pageParams(input.page, input.pageSize)
    add(params, 'name', input.name)
    add(params, 'cas', input.cas)
    add(params, 'physical_state', input.physicalState)
    const response = await this.transport.request<ReagentInfoListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-infos?${params.toString()}`
    })
    return decodeReagentInfoPage(response.data)
  }

  async getReagentInfo(reagentInfoUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-infos/${encodeURIComponent(reagentInfoUuid)}`
    })
    return decodeReagentInfo(response.data)
  }

  async listReagents(input: {
    readonly page?: number
    readonly pageSize?: number
    readonly materialUuid?: string
    readonly reagentInfoUuid?: string
    readonly keyword?: string
    readonly cas?: string
    readonly barcode?: string
  } = {}) {
    const params = pageParams(input.page, input.pageSize)
    add(params, 'material_uuid', input.materialUuid)
    add(params, 'reagent_info_uuid', input.reagentInfoUuid)
    add(params, 'keyword', input.keyword)
    add(params, 'cas', input.cas)
    add(params, 'barcode', input.barcode)
    const response = await this.transport.request<ReagentListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/reagents?${params.toString()}`
    })
    return decodeReagentPage(response.data)
  }

  async getReagent(reagentUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagents/${encodeURIComponent(reagentUuid)}`
    })
    return decodeReagent(response.data)
  }

  async listInventoryInstances() {
    const response = await this.transport.request<EdgeInstanceListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/instances`
    })
    return decodeInventoryInstances(response.data)
  }

  async getInventoryInstance(instanceUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/instances/${encodeURIComponent(instanceUuid)}`
    })
    return decodeInventoryInstance(response.data)
  }

  async listInventoryLots() {
    const response = await this.transport.request<EdgeLotListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/lots`
    })
    return decodeInventoryLots(response.data)
  }

  async getInventoryLot(lotId: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/lots/${encodeURIComponent(lotId)}`
    })
    return decodeInventoryLot(response.data)
  }

  async getInventorySnapshot() {
    const response = await this.transport.request<EdgeSnapshotResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/snapshot`
    })
    return decodeInventorySnapshot(response.data)
  }
}

function pageParams(page: number | undefined, pageSize: number | undefined): URLSearchParams {
  return new URLSearchParams({
    page: String(page ?? 1),
    page_size: String(pageSize ?? 100)
  })
}

function add(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') params.set(key, value)
}
