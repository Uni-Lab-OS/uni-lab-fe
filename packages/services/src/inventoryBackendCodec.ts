import type { HttpClient } from './http'
import { requestData } from './http'
import { ServiceError } from './errors'
import type {
  CompoundLookupResult,
  ReagentCreateInput,
  ReagentHistoryEntry,
  ReagentHistoryPage,
  ReagentInfoCreateInput,
  ReagentInfoItem,
  ReagentInfoUpdateInput,
  ReagentInventoryItem,
  ReagentMutationReceipt,
  ReagentUpdateInput
} from './inventory'

export interface ReagentInfoPage {
  items: readonly ReagentInfoItem[]
  total: number
}

/**
 * 解码 Backend 的 CAS 化合物查询结果，拒绝未知状态和错误字段类型。
 * @param value 未信任的 Backend 响应 data。
 * @returns 可直接驱动登记表单补全的类型安全结果。
 */
export function decodeCompoundLookupResult(value: unknown): CompoundLookupResult {
  const record = object(value, 'Backend CAS 化合物查询')
  const cas = requiredString(record.cas, 'Backend CAS 化合物查询.cas')
  const status = compoundLookupStatus(record.status)
  const message = optionalString(record.message)
  const compoundRecord = record.compound == null
    ? undefined
    : object(record.compound, 'Backend CAS 化合物查询.compound')
  const name = optionalString(compoundRecord?.name)
  const molecularFormula = optionalString(compoundRecord?.molecular_formula)
  const smiles = optionalString(compoundRecord?.smiles)
  const inchiKey = optionalString(compoundRecord?.inchi_key)
  const molecularWeight = optionalFiniteNumber(compoundRecord?.molecular_weight)
  const compound: CompoundLookupResult['compound'] = compoundRecord == null
    ? undefined
    : {
        ...(name ? { name } : {}),
        ...(molecularFormula ? { molecularFormula } : {}),
        ...(smiles ? { smiles } : {}),
        ...(inchiKey ? { inchiKey } : {}),
        ...(molecularWeight == null ? {} : { molecularWeight })
      }
  if (status === 'ok' && !compound) {
    throw invalidInventoryResponse('Backend CAS 化合物查询.compound 在 ok 状态下必须是对象')
  }
  return {
    cas,
    status,
    ...(message ? { message } : {}),
    ...(compound ? { compound } : {})
  }
}

/**
 * 构造 feat/workflow 手工登记化学品字典的 JSON body。
 * @param input 名称、物态以及可选的化学身份与参考属性。
 * @returns 与 Backend reagentInfoCreateRequest 对齐的普通对象。
 */
export function reagentInfoCreateBody(
  input: ReagentInfoCreateInput
): Record<string, unknown> {
  return {
    cas: input.cas ?? '',
    name: input.name,
    aliases: [...input.aliases],
    physical_state: input.physicalState,
    meta_data: input.metadata ?? {},
    ...optionalField('name_en', input.nameEn),
    ...optionalField('molecular_formula', input.molecularFormula),
    ...optionalField('smiles', input.smiles),
    ...optionalField('inchi_key', input.inchiKey),
    ...optionalField('molecular_weight', input.molecularWeight),
    ...optionalField('density_g_per_ml', input.densityGPerMl),
    ...optionalField('description', input.description)
  }
}

/**
 * 构造 Backend 化学品字典完整纠错 body；空值显式发送 null 以清除旧字段。
 * @param input 当前表单中的完整可编辑化学身份。
 * @returns 与三态 reagentInfoUpdateRequest 对齐的普通对象。
 */
export function reagentInfoUpdateBody(
  input: ReagentInfoUpdateInput
): Record<string, unknown> {
  return {
    cas: input.cas ?? null,
    name: input.name,
    name_en: input.nameEn ?? null,
    aliases: [...input.aliases],
    molecular_formula: input.molecularFormula ?? null,
    smiles: input.smiles ?? null,
    inchi_key: input.inchiKey ?? null,
    molecular_weight: input.molecularWeight ?? null,
    density_g_per_ml: input.densityGPerMl ?? null,
    physical_state: input.physicalState,
    description: input.description ?? null,
    meta_data: input.metadata ?? {}
  }
}

/**
 * 读取一页 Backend 试剂基础信息，并严格校验化学身份字段。
 * @param http 已绑定 Backend 地址的 HTTP 客户端。
 * @param pageNumber 从 1 开始的页码。
 * @param signal 可选取消信号。
 * @returns 已解码的试剂基础信息与总数。
 */
export async function loadBackendReagentInfoPage(
  http: HttpClient,
  pageNumber: number,
  signal?: AbortSignal
): Promise<ReagentInfoPage> {
  const page = await requestData<unknown>(
    http,
    `/api/v1/reagent-infos?page=${Math.max(1, Math.trunc(pageNumber))}&page_size=100`,
    { signal }
  )
  const record = object(page, 'Backend 试剂基础信息列表')
  return {
    items: array(record.items, 'Backend 试剂基础信息列表 items').map(
      (value, index) => decodeBackendReagentInfo(
        value,
        `Backend 试剂基础信息列表 items[${index}]`
      )
    ),
    total: nonNegativeInteger(record.total, 'Backend 试剂基础信息列表 total')
  }
}

/**
 * 从 Go Backend 的正式试剂资源读取容器级台账。
 * @param http 已绑定 Backend 地址的 HTTP 客户端。
 * @param signal 可选取消信号。
 * @returns Backend 可证明的试剂容器与当前数量；缺失的预留维度保持空值。
 */
export async function loadBackendReagents(
  http: HttpClient,
  signal?: AbortSignal
): Promise<ReagentInventoryItem[]> {
  const page = await requestData<unknown>(
    http,
    '/api/v1/reagents?page=1&page_size=500',
    { signal }
  )
  const record = object(page, 'Backend 试剂列表')
  const items = array(record.items, 'Backend 试剂列表 items')
  return items.map((value, index) => decodeBackendReagentItem(
    value,
    `Backend 试剂列表 items[${index}]`
  ))
}

/**
 * 构造 Backend 创建试剂的 JSON body，成对发送浓度字段且不伪造空值。
 * @param input 已由产品表单校验的创建输入。
 * @returns 与 Go Backend reagentCreateRequest 对齐的普通对象。
 */
export function reagentCreateBody(
  input: ReagentCreateInput
): Record<string, unknown> {
  return {
    material_uuid: input.materialId,
    cas: input.cas,
    physical_state: input.physicalState ?? 'unknown',
    quantity: input.quantity,
    quantity_unit: input.quantityUnit,
    meta_data: input.metadata ?? {},
    ...(input.densityGPerMl == null ? {} : { density_g_per_ml: input.densityGPerMl }),
    ...concentrationBody(input.concentrationValue, input.concentrationUnit),
    ...(input.source ? { source: input.source } : {}),
    ...(input.observedAt ? { observed_at: input.observedAt } : {}),
    ...(input.description ? { description: input.description } : {})
  }
}

/**
 * 构造携带期望修订的 Backend 试剂更新 JSON body。
 * @param input 当前权威行派生的完整可编辑字段。
 * @returns 不改变 material_uuid、CAS 或 quantity_unit 身份语义的请求对象。
 */
export function reagentUpdateBody(
  input: ReagentUpdateInput
): Record<string, unknown> {
  return {
    quantity: input.quantity,
    quantity_unit: input.quantityUnit,
    expected_revision: input.expectedRevision,
    meta_data: input.metadata ?? {},
    ...concentrationBody(input.concentrationValue, input.concentrationUnit),
    ...(input.source ? { source: input.source } : {}),
    ...(input.observedAt ? { observed_at: input.observedAt } : {}),
    ...(input.description ? { description: input.description } : {})
  }
}

/**
 * 从试剂创建或更新响应读取提交后的稳定身份和修订。
 * @param value Backend 返回的试剂实例或创建聚合。
 * @param field 用于诊断的响应名称。
 * @returns 已提交写操作的最小回执。
 */
export function mutationReceipt(
  value: unknown,
  field: string
): ReagentMutationReceipt {
  const record = object(value, field)
  return {
    id: requiredString(record.uuid, `${field}.uuid`),
    revision: nonNegativeInteger(record.revision, `${field}.revision`)
  }
}

/**
 * 解码 Backend 试剂台账页，拒绝把其他主体或未知事件冒充试剂历史。
 * @param value 未信任的分页响应主体。
 * @returns 已校验的不可变试剂历史页。
 */
export function decodeReagentHistoryPage(value: unknown): ReagentHistoryPage {
  const page = object(value, 'Backend 试剂历史')
  const entries = array(page.items, 'Backend 试剂历史 items').map(
    (raw, index): ReagentHistoryEntry => {
      const field = `Backend 试剂历史 items[${index}]`
      const entry = object(raw, field)
      if (entry.subject_type !== 'reagent') {
        throw invalidInventoryResponse(`${field}.subject_type 必须是 reagent`)
      }
      return {
        id: requiredString(entry.uuid, `${field}.uuid`),
        materialId: requiredString(entry.material_uuid, `${field}.material_uuid`),
        reagentId: requiredString(entry.subject_uuid, `${field}.subject_uuid`),
        eventType: reagentHistoryEvent(entry.event_type, `${field}.event_type`),
        operatorType: reagentHistoryOperator(entry.operator_type, `${field}.operator_type`),
        quantityDelta: optionalFiniteNumber(entry.quantity_delta),
        quantityUnit: optionalString(entry.quantity_unit),
        revision: optionalNonNegativeInteger(entry.revision, `${field}.revision`),
        workflowTaskId: optionalString(entry.workflow_task_uuid),
        workflowNodeJobId: optionalString(entry.workflow_node_job_uuid),
        traceId: optionalString(entry.trace_id),
        recordedAt: requiredString(entry.recorded_at, `${field}.recorded_at`)
      }
    }
  )
  return {
    items: entries,
    page: positiveInteger(page.page, 'Backend 试剂历史 page'),
    pageSize: positiveInteger(page.page_size, 'Backend 试剂历史 page_size'),
    hasMore: requiredBoolean(page.has_more, 'Backend 试剂历史 has_more')
  }
}

/**
 * 解码一个 Backend 试剂详情，并保留后续更新所需修订和元数据。
 * @param value 未信任的 Backend DTO。
 * @param field 错误消息中的字段路径。
 * @returns 可展示且可安全回写的试剂库存条目。
 */
function decodeBackendReagentItem(
  value: unknown,
  field: string
): ReagentInventoryItem {
  const item = object(value, field)
  const quantity = optionalFiniteNumber(item.quantity)
  return {
    id: requiredString(item.uuid, `${field}.uuid`),
    materialId: requiredString(item.material_uuid, `${field}.material_uuid`),
    reagentInfoId: requiredString(item.reagent_info_uuid, `${field}.reagent_info_uuid`),
    name: requiredString(item.name, `${field}.name`),
    cas: optionalString(item.cas),
    molecularFormula: optionalString(item.molecular_formula),
    physicalState: optionalString(item.physical_state),
    totalQuantity: quantity,
    unit: optionalString(item.quantity_unit),
    lotLabel: optionalString(item.container_barcode),
    siteLabel: optionalString(item.container_name),
    concentrationValue: optionalFiniteNumber(item.concentration_value),
    concentrationUnit: optionalString(item.concentration_unit),
    densityGPerMl: optionalFiniteNumber(item.density_g_per_ml),
    revision: nonNegativeInteger(item.revision, `${field}.revision`),
    description: optionalString(item.description),
    metadata: object(item.meta_data, `${field}.meta_data`),
    createdAt: optionalString(item.create_time),
    updatedAt: optionalString(item.update_time),
    status: quantity == null ? 'unknown' : quantity > 0 ? 'available' : 'empty'
  }
}

/** 解码一个 Backend 试剂基础信息，并拒绝非法别名或物态。 */
export function decodeBackendReagentInfo(value: unknown, field: string): ReagentInfoItem {
  const item = object(value, field)
  return {
    id: requiredString(item.uuid, `${field}.uuid`),
    name: requiredString(item.name, `${field}.name`),
    ...(optionalString(item.name_en) ? { nameEn: optionalString(item.name_en) } : {}),
    aliases: array(item.aliases, `${field}.aliases`).map(
      (alias, index) => requiredString(alias, `${field}.aliases[${index}]`)
    ),
    ...(optionalString(item.cas) ? { cas: optionalString(item.cas) } : {}),
    ...(optionalString(item.molecular_formula) ? { molecularFormula: optionalString(item.molecular_formula) } : {}),
    ...(optionalString(item.smiles) ? { smiles: optionalString(item.smiles) } : {}),
    ...(optionalString(item.inchi_key) ? { inchiKey: optionalString(item.inchi_key) } : {}),
    ...(optionalFiniteNumber(item.molecular_weight) == null ? {} : { molecularWeight: optionalFiniteNumber(item.molecular_weight) }),
    ...(optionalFiniteNumber(item.density_g_per_ml) == null ? {} : { densityGPerMl: optionalFiniteNumber(item.density_g_per_ml) }),
    physicalState: requiredString(item.physical_state, `${field}.physical_state`),
    ...(optionalString(item.description) ? { description: optionalString(item.description) } : {}),
    metadata: object(item.meta_data, `${field}.meta_data`),
    ...(optionalString(item.create_time) ? { createdAt: optionalString(item.create_time) } : {}),
    ...(optionalString(item.update_time) ? { updatedAt: optionalString(item.update_time) } : {})
  }
}

/** 仅在值存在时加入请求字段，避免把创建请求的可空字段伪造成空串。 */
function optionalField(
  key: string,
  value: string | number | undefined
): Record<string, unknown> {
  return value == null ? {} : { [key]: value }
}

/** 只在值和单位同时存在时发送浓度，避免构造 Backend 必然拒绝的半组输入。 */
function concentrationBody(
  value: number | undefined,
  unit: string | undefined
): Record<string, unknown> {
  return value == null || !unit
    ? {}
    : { concentration_value: value, concentration_unit: unit }
}

/** 读取试剂台账的闭集事件类型。 */
function reagentHistoryEvent(
  value: unknown,
  field: string
): ReagentHistoryEntry['eventType'] {
  if (value === 'add' || value === 'remove' || value === 'consume' || value === 'adjust') {
    return value
  }
  throw invalidInventoryResponse(`${field} 不是支持的试剂事件`)
}

/** 读取 Backend 已认证的台账操作通道。 */
function reagentHistoryOperator(
  value: unknown,
  field: string
): ReagentHistoryEntry['operatorType'] {
  if (value === 'frontend' || value === 'edge' || value === 'system') return value
  throw invalidInventoryResponse(`${field} 不是支持的操作通道`)
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
  if (!Array.isArray(value)) throw invalidInventoryResponse(`${field} 必须是数组`)
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

/** 读取可选有限数；缺失时保持未知。 */
function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 只接受 Backend 公布的四种 CAS 查询状态。 */
function compoundLookupStatus(value: unknown): CompoundLookupResult['status'] {
  if (
    value === 'ok' ||
    value === 'registered' ||
    value === 'not_found' ||
    value === 'unavailable'
  ) return value
  throw invalidInventoryResponse('Backend CAS 化合物查询.status 无效')
}

/** 读取必填非负整数。 */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidInventoryResponse(`${field} 必须是非负整数`)
  }
  return value
}

/** 读取可选非负整数，null 表示未提供。 */
function optionalNonNegativeInteger(
  value: unknown,
  field: string
): number | undefined {
  return value == null ? undefined : nonNegativeInteger(value, field)
}

/** 读取必填正整数。 */
function positiveInteger(value: unknown, field: string): number {
  const result = nonNegativeInteger(value, field)
  if (result === 0) throw invalidInventoryResponse(`${field} 必须大于零`)
  return result
}

/** 读取必填布尔值。 */
function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw invalidInventoryResponse(`${field} 必须是布尔值`)
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
