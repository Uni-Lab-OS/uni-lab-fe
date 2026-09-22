import { loadBackendMaterialTemplateCatalog } from './backendMaterialCatalog'
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


/** 试剂入库只需要容器模板的稳定身份和标签。 */
export interface ReagentContainerTemplateItem {
  id: string
  tags: readonly string[]
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

interface ReagentCreateBaseInput {
  materialId: string
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

/** 创建库存时必须且只能使用一种试剂身份定位方式。 */
export type ReagentCreateInput = ReagentCreateBaseInput & (
  | { reagentInfoId: string; cas?: never }
  | { cas: string; reagentInfoId?: never }
)

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

export interface ReagentDispenseTargetInput {
  materialId: string
  quantity: number
  expectedMaterialRevision?: number
}

export interface ReagentDispenseInput {
  commandId: string
  sourceReagentId: string
  expectedRevision: number
  quantityUnit: string
  targets: readonly ReagentDispenseTargetInput[]
  reason?: string
}

export interface ReagentDispenseReceipt {
  commandId: string
  replayed: boolean
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
  listReagentContainerTemplates(): Promise<ReagentContainerTemplateItem[]>
  listReagentInfos(signal?: AbortSignal): Promise<ReagentInfoItem[]>
  lookupCompoundByCAS(cas: string, signal?: AbortSignal): Promise<CompoundLookupResult>
  createReagentInfo(input: ReagentInfoCreateInput, signal?: AbortSignal): Promise<ReagentInfoItem>
  updateReagentInfo(input: ReagentInfoUpdateInput, signal?: AbortSignal): Promise<ReagentInfoItem>
  deleteReagentInfo(reagentInfoId: string, signal?: AbortSignal): Promise<void>
  createReagent(input: ReagentCreateInput, signal?: AbortSignal): Promise<ReagentMutationReceipt>
  updateReagent(input: ReagentUpdateInput, signal?: AbortSignal): Promise<ReagentMutationReceipt>
  deleteReagent(reagentId: string, signal?: AbortSignal): Promise<void>
  dispenseReagent(input: ReagentDispenseInput, signal?: AbortSignal): Promise<ReagentDispenseReceipt>
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
     * 读取当前服务端公开的试剂资源列表，并拒绝无效响应。
     * @param signal 调用方用于取消页面卸载后的请求。
     * @returns 按名称与稳定身份排序的试剂库存投影。
     */
    async listReagentInventory(signal?: AbortSignal) {
      requireReagentContract(backend)
      const items = await loadBackendReagents(http, signal)
      return items.sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN') ||
        left.id.localeCompare(right.id)
      )
    },

    /**
     * 从 OS 资源模板目录读取试剂容器候选，不开放通用物料模板能力。
     * @returns 明确带 container 标签的模板稳定身份与标签。
     */
    async listReagentContainerTemplates() {
      requireReagentContract(backend)
      const catalog = await loadBackendMaterialTemplateCatalog(http)
      return catalog.items.flatMap(template =>
        template.tags.some(tag => tag.trim().toLocaleLowerCase('en-US') === 'container')
          ? [{ id: template.uuid, tags: template.tags }]
          : []
      )
    },

    /**
     * 分页读取 Go Backend 自动采集的试剂基础信息目录。
     * @param signal 调用方用于取消页面卸载后的请求。
     * @returns 按中文名称和稳定身份排序的完整试剂基础信息。
     */
    async listReagentInfos(signal?: AbortSignal) {
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
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
      requireReagentContract(backend)
      await requestCommand(
        http,
        `/api/v1/reagents/${encodeURIComponent(reagentId)}`,
        { method: 'DELETE', signal }
      )
    },

    /**
     * 通过 OS 原子命令把一瓶试剂分装到一个或多个空容器。
     * @param input 源试剂修订、稳定命令身份及全部目标容器闭集。
     * @param signal 调用方取消信号。
     * @returns OS 完成或幂等重放的命令回执；业务拒绝直接抛出可行动错误。
     */
    async dispenseReagent(input, signal) {
      requireReagentDispenseContract(backend)
      const raw = await http.request<unknown>('/api/v1/inventory/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command_id: input.commandId,
          type: 'reagent.dispense',
          actor: 'frontend:robot-workstation',
          payload: {
            source_reagent_uuid: input.sourceReagentId,
            expected_revision: input.expectedRevision,
            quantity_unit: input.quantityUnit,
            targets: input.targets.map(target => ({
              material_uuid: target.materialId,
              quantity: target.quantity,
              ...(target.expectedMaterialRevision == null
                ? {}
                : { expected_material_revision: target.expectedMaterialRevision })
            })),
            reason: input.reason ?? '分装'
          }
        }),
        signal
      })
      return decodeReagentDispenseReceipt(raw, input.commandId)
    },

    /**
     * 读取一个容器物料上的不可变试剂台账。
     * @param materialId 承载试剂的容器物料 UUID。
     * @param page 从 1 开始的页码，默认第一页。
     * @param signal 调用方取消信号。
     * @returns Backend 倒序历史与是否存在下一页的事实。
     */
    async listReagentHistory(materialId, page = 1, signal) {
      requireReagentContract(backend)
      const raw = await requestData<unknown>(
        http,
        `/api/v1/materials/${encodeURIComponent(materialId)}/reagent-history?page=${Math.max(1, Math.trunc(page))}&page_size=100`,
        { signal }
      )
      return decodeReagentHistoryPage(raw)
    }
  }
}

/** 试剂模块只允许调用已验证同形 v1 契约的本地 OS 或 Go 服务。 */
function requireReagentContract(backend: BackendConfig): void {
  if (backend.id === 'local-python' || backend.id === 'local-go') return
  throw new ServiceError({
    code: 'UNSUPPORTED_REAGENT_CONTRACT',
    message: '当前服务配置未声明统一试剂 v1 契约。',
    retryable: false
  })
}

/** 分装只允许调用已验证 inventory command 契约的本地 OS。 */
function requireReagentDispenseContract(backend: BackendConfig): void {
  if (backend.id === 'local-python') return
  throw new ServiceError({
    code: 'UNSUPPORTED_REAGENT_DISPENSE_CONTRACT',
    message: '当前服务配置未声明试剂分装命令契约。',
    retryable: false
  })
}

/** 严格解码 OS inventory command 回执，并把 HTTP 200 业务拒绝转换为服务错误。 */
function decodeReagentDispenseReceipt(
  raw: unknown,
  expectedCommandId: string
): ReagentDispenseReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidInventoryResponse('试剂分装命令回执不是对象')
  }
  const result = raw as Record<string, unknown>
  if (result.command_id !== expectedCommandId) {
    throw invalidInventoryResponse('试剂分装命令回执身份不匹配')
  }
  if (result.status !== 'completed') {
    throw new ServiceError({
      code: typeof result.error_code === 'string'
        ? result.error_code
        : 'REAGENT_DISPENSE_REJECTED',
      message: typeof result.error === 'string' && result.error.trim()
        ? result.error
        : '试剂分装被库存权威拒绝。',
      retryable: result.error_code === 'version_conflict'
    })
  }
  return {
    commandId: expectedCommandId,
    replayed: result.replayed === true
  }
}

/** 创建可诊断的库存响应合同错误。 */
function invalidInventoryResponse(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_REAGENT_INVENTORY_RESPONSE',
    message: `试剂库存接口返回无效响应：${detail}`,
    retryable: false
  })
}
