import type { BackendConfig } from './backends'
import { ServiceError } from './errors'
import { requestCommand, requestData, type HttpClient } from './http'
import {
  decodeCompoundLookupResult,
  decodeReagentHistoryPage,
  decodeBackendReagentInfo,
  loadBackendReagentInfoPage,
  loadBackendReagents,
  mutationReceipt,
  reagentInfoCreateBody,
  reagentInfoUpdateBody,
  reagentCreateBody,
  reagentUpdateBody
} from './inventoryBackendCodec'

export type ReagentInventoryStatus =
  | 'available'
  | 'reserved'
  | 'empty'
  | 'quarantined'
  | 'unknown'

/**
 * 试剂库存（Reagent Inventory）的统一只读投影。
 *
 * 数量字段保持可空：不同权威接口没有提供的维度不得由前端推断为零。
 */
export interface ReagentInventoryItem {
  id: string
  materialId?: string
  reagentInfoId?: string
  templateId?: string
  name: string
  cas?: string
  molecularFormula?: string
  physicalState?: string
  totalQuantity?: number
  availableQuantity?: number
  reservedQuantity?: number
  unit?: string
  lotLabel?: string
  siteLabel?: string
  expiresAt?: string
  concentrationValue?: number
  concentrationUnit?: string
  densityGPerMl?: number
  revision?: number
  description?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
  status: ReagentInventoryStatus
}

/** Backend 持久化的试剂基础信息（Reagent Info）只读投影。 */
export interface ReagentInfoItem {
  id: string
  name: string
  nameEn?: string
  aliases: readonly string[]
  cas?: string
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
  densityGPerMl?: number
  physicalState: string
  description?: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export type CompoundLookupStatus = 'ok' | 'registered' | 'not_found' | 'unavailable'

/** Backend 按 CAS 返回的 PubChem 表单预填候选值。 */
export interface CompoundLookupCandidate {
  name?: string
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
}

/** CAS 查询结果；非 ok 状态不携带候选化学字段。 */
export interface CompoundLookupResult {
  cas: string
  status: CompoundLookupStatus
  message?: string
  compound?: CompoundLookupCandidate
}

export type ReagentPhysicalState = 'solid' | 'liquid' | 'gas' | 'other' | 'unknown'

/** 手工登记一条化学品字典身份所需的完整表单值。 */
export interface ReagentInfoCreateInput {
  name: string
  nameEn?: string
  aliases: readonly string[]
  cas?: string
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
  densityGPerMl?: number
  physicalState: ReagentPhysicalState
  description?: string
  metadata?: Record<string, unknown>
}

/** 纠错既有化学品字典身份；未提供的可空值会被明确清除。 */
export interface ReagentInfoUpdateInput extends ReagentInfoCreateInput {
  id: string
}

export interface ReagentCreateInput {
  materialId: string
  cas: string
  physicalState?: ReagentPhysicalState
  densityGPerMl?: number
  concentrationValue?: number
  concentrationUnit?: string
  quantity: number
  quantityUnit: string
  source?: string
  observedAt?: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ReagentUpdateInput {
  id: string
  quantity: number
  quantityUnit: string
  expectedRevision: number
  concentrationValue?: number
  concentrationUnit?: string
  source?: string
  observedAt?: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ReagentMutationReceipt {
  id: string
  revision: number
}

export interface ReagentHistoryEntry {
  id: string
  materialId: string
  reagentId: string
  eventType: 'add' | 'remove' | 'consume' | 'adjust'
  operatorType: 'frontend' | 'edge' | 'system'
  quantityDelta?: number
  quantityUnit?: string
  revision?: number
  workflowTaskId?: string
  workflowNodeJobId?: string
  traceId?: string
  recordedAt: string
}

export interface ReagentHistoryPage {
  items: readonly ReagentHistoryEntry[]
  page: number
  pageSize: number
  hasMore: boolean
}

export interface InventoryPort {
  listReagentInventory(signal?: AbortSignal): Promise<ReagentInventoryItem[]>
  listReagentInfos(signal?: AbortSignal): Promise<ReagentInfoItem[]>
  lookupCompoundByCAS(cas: string, signal?: AbortSignal): Promise<CompoundLookupResult>
  createReagentInfo(input: ReagentInfoCreateInput, signal?: AbortSignal): Promise<ReagentInfoItem>
  updateReagentInfo(input: ReagentInfoUpdateInput, signal?: AbortSignal): Promise<ReagentInfoItem>
  deleteReagentInfo(reagentInfoId: string, signal?: AbortSignal): Promise<void>
  createReagent(input: ReagentCreateInput, signal?: AbortSignal): Promise<ReagentMutationReceipt>
  updateReagent(input: ReagentUpdateInput, signal?: AbortSignal): Promise<ReagentMutationReceipt>
  deleteReagent(reagentId: string, signal?: AbortSignal): Promise<void>
  listReagentHistory(materialId: string, page?: number, signal?: AbortSignal): Promise<ReagentHistoryPage>
}

export type InventoryReadPort = Pick<InventoryPort, 'listReagentInventory'>

/**
 * 创建绑定当前 Backend/OS 的库存只读端口。
 * @param http 统一 HTTP 客户端，负责地址、超时和错误封装。
 * @param backend 当前服务端身份；差异只在本适配器内收敛。
 * @returns 可读取真实试剂库存投影的端口。
 */
export function createInventoryReadPort(
  http: HttpClient,
  backend: BackendConfig
): InventoryPort {
  return {
    /**
     * 读取当前服务端的真实试剂库存，并拒绝无效响应。
     * @param signal 调用方用于取消页面卸载后的请求。
     * @returns 按名称与稳定身份排序的试剂库存投影。
     */
    async listReagentInventory(signal?: AbortSignal) {
      const items = backend.serverKind === 'backend'
        ? await loadBackendReagents(http, signal)
        : await loadEdgeInventoryReagents(http, signal)
      return items.sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id.localeCompare(right.id)
      )
    },

    /**
     * 分页读取 Go Backend 自动采集的试剂基础信息目录。
     * @param signal 调用方用于取消页面卸载后的请求。
     * @returns 按中文名称和稳定身份排序的完整试剂基础信息。
     */
    async listReagentInfos(signal?: AbortSignal) {
      requireBackendReagentInfoRead(backend)
      const items: ReagentInfoItem[] = []
      for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
        const page = await loadBackendReagentInfoPage(http, pageNumber, signal)
        items.push(...page.items)
        if (items.length >= page.total) {
          return items.sort((left, right) =>
            left.name.localeCompare(right.name, 'zh-CN') ||
            left.id.localeCompare(right.id)
          )
        }
      }
      throw invalidInventoryResponse('试剂基础信息超过 100 页，请缩小服务端查询范围')
    },

    /**
     * 按 CAS 请求 Backend 的 PubChem 表单预填候选值，不直接写入化学品字典。
     * @param cas 已由表单完成格式和校验位检查的 CAS 编号。
     * @param signal 调用方用于取消输入变化后的旧查询。
     * @returns 可区分已登记、未收录和数据源不可用的查询结果。
     */
    async lookupCompoundByCAS(cas, signal) {
      requireBackendReagentInfoRead(backend)
      const result = await requestData<unknown>(
        http,
        `/api/v1/compounds/${encodeURIComponent(cas)}`,
        { signal }
      )
      return decodeCompoundLookupResult(result)
    },

    /**
     * 在 Go Backend 手工登记独立化学品身份，不创建任何容器或库存实例。
     * @param input 名称、物态及可选化学属性。
     * @param signal 调用方取消信号。
     * @returns Backend 已持久化的完整试剂基础信息。
     */
    async createReagentInfo(input, signal) {
      requireBackendReagentInfoWrite(backend)
      const result = await requestData<unknown>(http, '/api/v1/reagent-infos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reagentInfoCreateBody(input)),
        signal
      })
      return decodeBackendReagentInfo(result, 'Backend 新建试剂基础信息')
    },

    /**
     * 纠错一条 Backend 化学品身份，并显式清除表单留空的可空字段。
     * @param input 稳定 UUID 与完整可编辑化学身份。
     * @param signal 调用方取消信号。
     * @returns Backend 更新后的完整试剂基础信息。
     */
    async updateReagentInfo(input, signal) {
      requireBackendReagentInfoWrite(backend)
      const result = await requestData<unknown>(
        http,
        `/api/v1/reagent-infos/${encodeURIComponent(input.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reagentInfoUpdateBody(input)),
          signal
        }
      )
      return decodeBackendReagentInfo(result, 'Backend 更新试剂基础信息')
    },

    /**
     * 删除从未被库存、仓库或工作流历史引用的误建化学身份。
     * @param reagentInfoId 待删除试剂基础信息 UUID。
     * @param signal 调用方取消信号。
     * @returns Backend 明确接受删除后完成；历史引用冲突会拒绝。
     */
    async deleteReagentInfo(reagentInfoId, signal) {
      requireBackendReagentInfoWrite(backend)
      await requestCommand(
        http,
        `/api/v1/reagent-infos/${encodeURIComponent(reagentInfoId)}`,
        { method: 'DELETE', signal }
      )
    },

    /**
     * 在 Go Backend 创建容器级试剂实例并返回稳定身份与初始修订。
     * @param input 容器物料、CAS、数量和可选浓度等权威写入字段。
     * @param signal 调用方取消信号。
     * @returns Backend 已提交试剂实例的 UUID 与修订号。
     */
    async createReagent(input, signal) {
      requireBackendReagentWrite(backend)
      const result = await requestData<unknown>(http, '/api/v1/reagents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reagentCreateBody(input)),
        signal
      })
      return mutationReceipt(result, 'Backend 新建试剂')
    },

    /**
     * 使用乐观修订更新 Backend 试剂余量和可编辑属性。
     * @param input 试剂 UUID、当前修订和完整可编辑字段。
     * @param signal 调用方取消信号。
     * @returns Backend 提交后的新修订；冲突时直接传播结构化错误。
     */
    async updateReagent(input, signal) {
      requireBackendReagentWrite(backend)
      const result = await requestData<unknown>(
        http,
        `/api/v1/reagents/${encodeURIComponent(input.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reagentUpdateBody(input)),
          signal
        }
      )
      return mutationReceipt(result, 'Backend 更新试剂')
    },

    /**
     * 请求 Backend 软删除试剂并闭合剩余数量台账。
     * @param reagentId 需要删除的试剂实例 UUID。
     * @param signal 调用方取消信号。
     * @returns Backend 确认提交后完成；预留或修订冲突时拒绝。
     */
    async deleteReagent(reagentId, signal) {
      requireBackendReagentWrite(backend)
      await requestCommand(
        http,
        `/api/v1/reagents/${encodeURIComponent(reagentId)}`,
        { method: 'DELETE', signal }
      )
    },

    /**
     * 读取一个容器物料上的不可变试剂台账。
     * @param materialId 承载试剂的容器物料 UUID。
     * @param page 从 1 开始的页码，默认第一页。
     * @param signal 调用方取消信号。
     * @returns Backend 倒序历史与是否存在下一页的事实。
     */
    async listReagentHistory(materialId, page = 1, signal) {
      requireBackendReagentWrite(backend)
      const raw = await requestData<unknown>(
        http,
        `/api/v1/materials/${encodeURIComponent(materialId)}/reagent-history?page=${Math.max(1, Math.trunc(page))}&page_size=100`,
        { signal }
      )
      return decodeReagentHistoryPage(raw)
    }
  }
}

/**
 * 从 Uni-Lab OS 库存快照读取数量型试剂批次。
 * @param http 已绑定 OS 地址的 HTTP 客户端。
 * @param signal 可选取消信号。
 * @returns 模板明确标记为试剂的批次投影。
 */
async function loadEdgeInventoryReagents(
  http: HttpClient,
  signal?: AbortSignal
): Promise<ReagentInventoryItem[]> {
  const raw = await http.request<unknown>('/api/v1/inventory/snapshot', {
    signal
  })
  const snapshot = object(raw, 'OS 库存快照')
  const templates = new Map(array(snapshot.templates, 'templates').map(
    (value, index) => {
      const template = object(value, `templates[${index}]`)
      const id = requiredString(template.template_id, 'template_id')
      return [id, {
        name: optionalString(template.name) ?? id,
        category: optionalString(template.category) ?? ''
      }] as const
    }
  ))
  return array(snapshot.lots, 'lots').flatMap((value, index) => {
    const lot = object(value, `lots[${index}]`)
    const templateId = requiredString(lot.template_id, 'template_id')
    const template = templates.get(templateId)
    if (!template || !isReagentTemplate(templateId, template.name, template.category)) {
      return []
    }
    const total = finiteNumber(lot.quantity_total, 'quantity_total')
    const available = finiteNumber(lot.quantity_available, 'quantity_available')
    const reserved = finiteNumber(lot.quantity_reserved, 'quantity_reserved')
    const quarantined = lot.quarantined === 1
    return [{
      id: requiredString(lot.lot_id, 'lot_id'),
      templateId,
      name: template.name,
      totalQuantity: total,
      availableQuantity: available,
      reservedQuantity: reserved,
      unit: optionalString(lot.unit),
      lotLabel: optionalString(lot.batch_no),
      siteLabel: optionalString(lot.warehouse_zone_id),
      expiresAt: optionalString(lot.expiry),
      status: quarantined
        ? 'quarantined'
        : total <= 0
          ? 'empty'
          : reserved > 0 && available <= 0
            ? 'reserved'
            : 'available'
    } satisfies ReagentInventoryItem]
  })
}

/**
 * 判断库存模板是否明确声明为试剂类别。
 * @param templateId 模板稳定身份。
 * @param name 模板显示名。
 * @param category 模板权威分类。
 * @returns 任一字段含试剂语义时返回 true。
 */
function isReagentTemplate(
  templateId: string,
  name: string,
  category: string
): boolean {
  return `${templateId} ${name} ${category}`.toLocaleLowerCase('zh-CN')
    .match(/reagent|试剂/) != null
}

/** Backend-only 写接口在 Edge profile 下失败关闭。 */
function requireBackendReagentWrite(backend: BackendConfig): void {
  if (backend.serverKind === 'backend') return
  throw new ServiceError({
    code: 'UNSUPPORTED_REAGENT_WRITE',
    message: '当前 Uni-Lab OS 只提供库存快照；试剂新增、更新、删除和历史查询仅由 Go Backend 提供。',
    retryable: false
  })
}

/** 试剂基础信息目录仅在 Go Backend profile 下可读。 */
function requireBackendReagentInfoRead(backend: BackendConfig): void {
  if (backend.serverKind === 'backend') return
  throw new ServiceError({
    code: 'UNSUPPORTED_REAGENT_INFO_READ',
    message: '当前 Uni-Lab OS 尚未提供统一试剂基础信息目录；请切换到 Go Backend。',
    retryable: false
  })
}

/** 化学品字典写接口仅在 feat/workflow Go Backend profile 下开放。 */
function requireBackendReagentInfoWrite(backend: BackendConfig): void {
  if (backend.serverKind === 'backend') return
  throw new ServiceError({
    code: 'UNSUPPORTED_REAGENT_INFO_WRITE',
    message: '当前 Uni-Lab OS 尚未提供统一化学品字典写接口；请切换到 Go Backend。',
    retryable: false
  })
}

/** 读取普通对象；非法 wire 值失败关闭。 */
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInventoryResponse(`${field} 必须是对象`)
  }
  return value as Record<string, unknown>
}

/** 读取数组；非法 wire 值失败关闭。 */
function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidInventoryResponse(`${field} 必须是数组`)
  }
  return value
}

/** 读取必填非空字符串；身份缺失时拒绝整个响应。 */
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw invalidInventoryResponse(`${field} 必须是非空字符串`)
  return result
}

/** 读取可选字符串并移除空白。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() || undefined
}

/** 读取必填有限数；非法数量不能降级为零。 */
function finiteNumber(value: unknown, field: string): number {
  const result = optionalFiniteNumber(value)
  if (result == null) throw invalidInventoryResponse(`${field} 必须是有限数`)
  return result
}

/** 读取可选有限数；缺失时保持未知。 */
function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

/** 读取必填非负整数。 */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidInventoryResponse(`${field} 必须是非负整数`)
  }
  return value
}

/** 创建可诊断的库存响应合同错误。 */
function invalidInventoryResponse(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_REAGENT_INVENTORY_RESPONSE',
    message: `试剂库存接口返回无效响应：${detail}`,
    retryable: false
  })
}
