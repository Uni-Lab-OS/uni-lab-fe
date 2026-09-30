import type { RequestTransport } from '../../transport/request'
import {
  assertReagentEnvelopeAccepted,
  decodeCompoundLookup,
  decodeInventoryInstance,
  decodeInventoryInstances,
  decodeInventoryLot,
  decodeInventoryLots,
  decodeInventorySnapshot,
  decodeReagent,
  decodeReagentBatchResult,
  decodeReagentDispenseResult,
  decodeReagentHistoryEntry,
  decodeReagentHistoryPage,
  decodeReagentInfo,
  decodeReagentInfoBatchResult,
  decodeReagentInfoPage,
  decodeReagentPage,
  decodeReagentStructure3d,
  encodeReagentDispenseCommand,
  encodeReagentDraft,
  encodeReagentInfoDraft,
  encodeReagentInfoPatch,
  encodeReagentPatch,
} from './codec'
import type { ReagentInventoryPort } from './port'
import type {
  ReagentBatchInput,
  ReagentDispenseCommand,
  ReagentDraft,
  ReagentImportInput,
  ReagentInfoDraft,
  ReagentInfoPatch,
  ReagentPatch,
} from './model'
import type {
  EdgeInstanceListResponse,
  EdgeLotListResponse,
  EdgeSnapshotResponse,
  InventoryCommandResponse,
  ReagentBatchResponse,
  ReagentHistoryListResponse,
  ReagentInfoListResponse,
  ReagentInventoryRecord,
  ReagentListResponse,
} from './api'

export class ReagentInventoryClient implements ReagentInventoryPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async listReagentInfos(
    input: {
      readonly page?: number
      readonly pageSize?: number
      readonly name?: string
      readonly cas?: string
      readonly physicalState?: string
    } = {},
  ) {
    const params = pageParams(input.page, input.pageSize)
    add(params, 'name', input.name)
    add(params, 'cas', input.cas)
    add(params, 'physical_state', input.physicalState)
    const response = await this.transport.request<ReagentInfoListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-infos?${params.toString()}`,
    })
    return decodeReagentInfoPage(response.data)
  }

  async getReagentInfo(reagentInfoUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-infos/${encodeURIComponent(reagentInfoUuid)}`,
    })
    return decodeReagentInfo(response.data)
  }

  async createReagentInfo(draft: ReagentInfoDraft) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'POST',
      url: `${this.apiPrefix}/reagent-infos`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeReagentInfoDraft(draft),
    })
    return decodeReagentInfo(response.data)
  }

  async updateReagentInfo(reagentInfoUuid: string, patch: ReagentInfoPatch) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'PUT',
      url: `${this.apiPrefix}/reagent-infos/${encodeURIComponent(reagentInfoUuid)}`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeReagentInfoPatch(patch),
    })
    return decodeReagentInfo(response.data)
  }

  async deleteReagentInfo(reagentInfoUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'DELETE',
      url: `${this.apiPrefix}/reagent-infos/${encodeURIComponent(reagentInfoUuid)}`,
    })
    assertReagentEnvelopeAccepted(response.data)
  }

  async createReagentInfoBatch(input: ReagentBatchInput) {
    const response = await this.transport.request<ReagentBatchResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/reagent-infos/batch`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeBatch(input),
    })
    return decodeReagentInfoBatchResult(response.data)
  }

  async importReagentInfos(input: ReagentImportInput) {
    const response = await this.transport.request<ReagentBatchResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/reagent-infos/import?${importParams(input)}`,
      body: importBody(input),
    })
    return decodeReagentInfoBatchResult(response.data)
  }

  async getReagentInfoStructure3d(reagentInfoUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-infos/${encodeURIComponent(reagentInfoUuid)}/structure-3d`,
    })
    return decodeReagentStructure3d(response.data)
  }

  async lookupCompound(cas: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/compounds/${encodeURIComponent(cas)}`,
    })
    return decodeCompoundLookup(response.data)
  }

  async listReagents(
    input: {
      readonly page?: number
      readonly pageSize?: number
      readonly materialUuid?: string
      readonly reagentInfoUuid?: string
      readonly keyword?: string
      readonly cas?: string
      readonly barcode?: string
    } = {},
  ) {
    const params = pageParams(input.page, input.pageSize)
    add(params, 'material_uuid', input.materialUuid)
    add(params, 'reagent_info_uuid', input.reagentInfoUuid)
    add(params, 'keyword', input.keyword)
    add(params, 'cas', input.cas)
    add(params, 'barcode', input.barcode)
    const response = await this.transport.request<ReagentListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/reagents?${params.toString()}`,
    })
    return decodeReagentPage(response.data)
  }

  async getReagent(reagentUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagents/${encodeURIComponent(reagentUuid)}`,
    })
    return decodeReagent(response.data)
  }

  async createReagent(draft: ReagentDraft) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'POST',
      url: `${this.apiPrefix}/reagents`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeReagentDraft(draft),
    })
    return decodeReagent(response.data)
  }

  async updateReagent(reagentUuid: string, patch: ReagentPatch) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'PUT',
      url: `${this.apiPrefix}/reagents/${encodeURIComponent(reagentUuid)}`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeReagentPatch(patch),
    })
    return decodeReagent(response.data)
  }

  async deleteReagent(reagentUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'DELETE',
      url: `${this.apiPrefix}/reagents/${encodeURIComponent(reagentUuid)}`,
    })
    assertReagentEnvelopeAccepted(response.data)
  }

  async createReagentBatch(input: ReagentBatchInput) {
    const response = await this.transport.request<ReagentBatchResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/reagents/batch`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeBatch(input),
    })
    return decodeReagentBatchResult(response.data)
  }

  async importReagents(input: ReagentImportInput) {
    const response = await this.transport.request<ReagentBatchResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/reagents/import?${importParams(input)}`,
      body: importBody(input),
    })
    return decodeReagentBatchResult(response.data)
  }

  async getReagentHistory(historyUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/reagent-history/${encodeURIComponent(historyUuid)}`,
    })
    return decodeReagentHistoryEntry(response.data)
  }

  async listReagentHistory(
    materialUuid: string,
    input: { readonly page?: number; readonly pageSize?: number } = {},
  ) {
    const params = pageParams(input.page, input.pageSize)
    const response = await this.transport.request<ReagentHistoryListResponse>({
      method: 'GET',
      url:
        `${this.apiPrefix}/materials/${encodeURIComponent(materialUuid)}` +
        `/reagent-history?${params.toString()}`,
    })
    return decodeReagentHistoryPage(response.data)
  }

  async dispenseReagent(command: ReagentDispenseCommand) {
    const response = await this.transport.request<InventoryCommandResponse>({
      method: 'POST',
      url: `${this.apiPrefix}/inventory/commands`,
      headers: { 'Content-Type': 'application/json' },
      body: encodeReagentDispenseCommand(command),
    })
    return decodeReagentDispenseResult(response.data)
  }

  async listInventoryInstances() {
    const response = await this.transport.request<EdgeInstanceListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/instances`,
    })
    return decodeInventoryInstances(response.data)
  }

  async getInventoryInstance(instanceUuid: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/instances/${encodeURIComponent(instanceUuid)}`,
    })
    return decodeInventoryInstance(response.data)
  }

  async listInventoryLots() {
    const response = await this.transport.request<EdgeLotListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/lots`,
    })
    return decodeInventoryLots(response.data)
  }

  async getInventoryLot(lotId: string) {
    const response = await this.transport.request<ReagentInventoryRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/lots/${encodeURIComponent(lotId)}`,
    })
    return decodeInventoryLot(response.data)
  }

  async getInventorySnapshot() {
    const response = await this.transport.request<EdgeSnapshotResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/inventory/snapshot`,
    })
    return decodeInventorySnapshot(response.data)
  }
}

function pageParams(page: number | undefined, pageSize: number | undefined): URLSearchParams {
  return new URLSearchParams({
    page: String(page ?? 1),
    page_size: String(pageSize ?? 100),
  })
}

function add(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') params.set(key, value)
}

function encodeBatch(input: ReagentBatchInput): Readonly<Record<string, unknown>> {
  return {
    items: [...input.items],
    ...(input.atomic === undefined ? {} : { atomic: input.atomic }),
  }
}

function importParams(input: ReagentImportInput): string {
  return new URLSearchParams({
    atomic: String(input.atomic ?? true),
  }).toString()
}

function importBody(input: ReagentImportInput): FormData {
  const form = new FormData()
  // OS 按 multipart 的 file 字段读取；文件名决定 JSON/CSV/TSV/XLSX 解析分支。
  form.append('file', input.file, input.fileName)
  return form
}
