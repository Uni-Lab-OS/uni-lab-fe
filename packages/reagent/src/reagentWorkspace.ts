import type {
  MaterialWorkspaceProjection,
  MaterialWorkspaceRow,
  MaterialId,
  MaterialMeasurementUnit,
  MaterialTemplateSummary,
  Measurement,
  NewReagentInfoInput
} from '@unilab/material'

export interface CapabilityStatus {
  available: boolean
  reason?: string
}

/**
 * 识别由目录元数据明确标注为试剂的资源模板，供一级模块做展示分区。
 * @param template 资源模板（ResourceTemplate）的只读目录摘要。
 * @returns 仅当稳定目录分区为 `reagent` 时返回 `true`；该结果不改变 Material 权威分类。
 * @remarks 未声明分区的旧模板失败关闭到普通物料目录，避免根据名称或标签误判试剂身份。
 */
export function isReagentResourceTemplate(
  template: MaterialTemplateSummary
): boolean {
  return template.catalogSection === 'reagent'
}

/**
 * 判定资源模板是否应保留在普通物料模块的目录中。
 * @param template 资源模板（ResourceTemplate）的只读目录摘要。
 * @returns 未明确标注为试剂模板时返回 `true`；只控制页面分区，不改变模板或 Material 事实。
 */
export function isNonReagentResourceTemplate(
  template: MaterialTemplateSummary
): boolean {
  return !isReagentResourceTemplate(template)
}

export type ReagentWorkspaceSection =
  | 'ledger'
  | 'create'

export type ReagentQualityState =
  | 'released'
  | 'pending'
  | 'quarantined'
  | 'rejected'

export type ReagentContainerState =
  | 'sealed'
  | 'opened'
  | 'quarantined'
  | 'empty'

/** 用户在单个试剂信息上维护的稳定名称—值扩展字段。 */
export interface ReagentCustomField {
  key: string
  label: string
  value: string
  unit?: string
}

export interface ReagentInfoProjection {
  id: string
  name: string
  aliases: readonly string[]
  physicalState: string
  cas?: string
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
  manufacturer?: string
  catalogNumber?: string
  defaultStorageCondition?: string
  hazardLabels: readonly string[]
  customFields?: readonly ReagentCustomField[]
  description?: string
}

export interface ReagentLotProjection {
  id: string
  reagentInfoId: string
  code: string
  supplierLot?: string
  receivedAt?: string
  expiresAt?: string
  qualityState: ReagentQualityState
}

export interface ReagentContainerInventory {
  materialId: MaterialId
  reagentInfoId: string
  lotId: string
  quantity: Measurement
  initialQuantity: Measurement
  concentration?: Measurement
  storageCondition?: string
  openedAt?: string
  expiresAt?: string
  state: ReagentContainerState
}

export interface ReagentHistoryEvent {
  id: string
  materialId: MaterialId
  materialName: string
  reagentInfoId: string
  lotId?: string
  occurredAt: string
  eventType:
    | 'registered'
    | 'received'
    | 'opened'
    | 'transferred'
    | 'consumed'
    | 'adjusted'
    | 'disposed'
  quantityDelta?: Measurement
  operator: string
  workflowName?: string
  detail: string
}

export interface ReagentWorkspaceSnapshot {
  revision: string
  reagentInfos: readonly ReagentInfoProjection[]
  lots: readonly ReagentLotProjection[]
  containers: readonly ReagentContainerInventory[]
  history: readonly ReagentHistoryEvent[]
}

export interface ReagentWorkspaceCapabilities {
  readCatalog: CapabilityStatus
  create: CapabilityStatus
  updateInfo: CapabilityStatus
  readInventory: CapabilityStatus
  readHistory: CapabilityStatus
}

export interface NewReagentWorkspaceInput {
  reagentInfo: NewReagentInfoInput & {
    manufacturer?: string
    catalogNumber?: string
    defaultStorageCondition?: string
    hazardLabels?: readonly string[]
    customFields?: readonly ReagentCustomField[]
  }
  lot: {
    code: string
    supplierLot?: string
    receivedAt?: string
    expiresAt?: string
  }
  container: {
    name: string
    code: string
    quantity: Measurement
    concentration?: Measurement
    storageCondition?: string
  }
}

export interface ReagentWorkspaceIntegration {
  snapshot?: ReagentWorkspaceSnapshot
  capabilities?: Partial<ReagentWorkspaceCapabilities>
  onCreate?: (input: NewReagentWorkspaceInput) => Promise<void>
  onUpdateInfo?: (input: ReagentInfoProjection) => Promise<void>
}

export interface ReagentContainerRow extends ReagentContainerInventory {
  material: MaterialWorkspaceRow
  reagentInfo: ReagentInfoProjection
  lot: ReagentLotProjection
  remainingRatio: number
}

export interface ReagentCatalogGroup {
  reagentInfo: ReagentInfoProjection
  lots: readonly ReagentLotProjection[]
  containers: readonly ReagentContainerRow[]
  totalRemaining: Measurement | null
}

export const DEFAULT_REAGENT_WORKSPACE_CAPABILITIES:
Readonly<ReagentWorkspaceCapabilities> = {
  readCatalog: {
    available: false,
    reason: '试剂信息与批次目录投影尚未接入'
  },
  create: {
    available: false,
    reason: '试剂信息、批次与容器实例的原子创建接口尚未接入'
  },
  updateInfo: {
    available: false,
    reason: '试剂信息维护接口尚未接入'
  },
  readInventory: {
    available: false,
    reason: '试剂数量库存投影尚未接入，不能根据物料配置推断剩余量'
  },
  readHistory: {
    available: false,
    reason: '试剂接收、转移、消耗与调整履历服务尚未接入'
  }
}

/**
 * 合并宿主声明的试剂能力与失败关闭默认值。
 * @param capabilities 宿主已接入的部分试剂能力。
 * @returns 所有入口都有明确可用性和缺口原因的能力集合。
 */
export function resolveReagentCapabilities(
  capabilities?: Partial<ReagentWorkspaceCapabilities>
): ReagentWorkspaceCapabilities {
  return {
    readCatalog: capabilities?.readCatalog ??
      DEFAULT_REAGENT_WORKSPACE_CAPABILITIES.readCatalog,
    create: capabilities?.create ?? DEFAULT_REAGENT_WORKSPACE_CAPABILITIES.create,
    updateInfo: capabilities?.updateInfo ??
      DEFAULT_REAGENT_WORKSPACE_CAPABILITIES.updateInfo,
    readInventory: capabilities?.readInventory ??
      DEFAULT_REAGENT_WORKSPACE_CAPABILITIES.readInventory,
    readHistory: capabilities?.readHistory ??
      DEFAULT_REAGENT_WORKSPACE_CAPABILITIES.readHistory
  }
}

/**
 * 按稳定试剂信息身份取得该试剂跨批次、跨容器的完整履历。
 * @param events 履历服务返回的只读事件集合。
 * @param reagentInfoId 当前试剂信息的稳定身份。
 * @returns 仅属于该试剂的信息事件，并按发生时间从新到旧排序。
 * @remarks 关联只使用 `reagentInfoId`，不从名称、容器数量或库位推断。
 */
export function reagentHistoryForInfo(
  events: readonly ReagentHistoryEvent[],
  reagentInfoId: string
): readonly ReagentHistoryEvent[] {
  return [...events]
    .filter((event) => event.reagentInfoId === reagentInfoId)
    .sort((left, right) => (
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    ))
}

export interface ReagentCatalogProjectionOptions {
  includeInventory?: boolean
}

/**
 * 将专属试剂投影与唯一物料实例、当前位置投影连接起来。
 * @param projection 当前 ResourceTemplate—Lot—Material 物料工作区投影。
 * @param snapshot 试剂信息、数量库存和履历的专属只读投影。
 * @param options 是否允许读取容器数量库存；未声明时失败关闭容器投影。
 * @returns 仅包含能够解析到稳定 Material 身份的试剂目录分组。
 */
export function projectReagentCatalog(
  projection: MaterialWorkspaceProjection,
  snapshot?: ReagentWorkspaceSnapshot,
  options: ReagentCatalogProjectionOptions = {}
): readonly ReagentCatalogGroup[] {
  if (!snapshot) return []
  const materialById = new Map(
    projection.rows.map((row) => [row.id, row])
  )
  const infoById = new Map(
    snapshot.reagentInfos.map((info) => [info.id, info])
  )
  const lotById = new Map(snapshot.lots.map((lot) => [lot.id, lot]))
  const containers = options.includeInventory
    ? snapshot.containers.flatMap((container) => {
    const material = materialById.get(container.materialId)
    const reagentInfo = infoById.get(container.reagentInfoId)
    const lot = lotById.get(container.lotId)
    if (!material || !reagentInfo || !lot) return []
    const initial = container.initialQuantity.value
    return [{
      ...container,
      material,
      reagentInfo,
      lot,
      remainingRatio: initial > 0
        ? Math.max(0, Math.min(1, container.quantity.value / initial))
        : 0
    }]
      })
    : []

  return snapshot.reagentInfos.map((reagentInfo) => {
    const reagentLots = snapshot.lots.filter(
      (lot) => lot.reagentInfoId === reagentInfo.id
    )
    const reagentContainers = containers.filter(
      (container) => container.reagentInfoId === reagentInfo.id
    )
    return {
      reagentInfo,
      lots: reagentLots,
      containers: reagentContainers,
      totalRemaining: sumCompatibleMeasurements(
        reagentContainers.map((container) => container.quantity)
      )
    }
  }).sort((left, right) => (
    right.containers.length - left.containers.length ||
    left.reagentInfo.name.localeCompare(right.reagentInfo.name, 'zh-CN')
  ))
}

/**
 * 汇总使用相同单位的试剂容器剩余量；混合单位时拒绝制造总数。
 * @param measurements 当前试剂的各容器数量库存。
 * @returns 可安全相加的总量，或在空集合、混合单位时返回 null。
 */
function sumCompatibleMeasurements(
  measurements: readonly Measurement[]
): Measurement | null {
  const first = measurements[0]
  if (!first || measurements.some((item) => item.unit !== first.unit)) {
    return null
  }
  return {
    value: measurements.reduce((total, item) => total + item.value, 0),
    unit: first.unit as MaterialMeasurementUnit
  }
}

/**
 * 将数值与实验室单位组合为稳定、可扫描的界面文本。
 * @param measurement 已由权威试剂投影返回的数量或浓度。
 * @returns 格式化数值；缺失值返回破折号，不推断默认单位或数量。
 */
export function formatReagentMeasurement(
  measurement: Measurement | null | undefined
): string {
  if (!measurement) return '—'
  return `${measurement.value.toLocaleString('zh-CN')} ${measurement.unit}`
}

/**
 * 将 ISO 时间或日期格式化为试剂台账使用的本地日期。
 * @param value 服务端返回的 ISO 时间、日期或待兼容文本。
 * @returns 本地日期文本；缺失值为破折号，非法日期保留原文以便排查。
 */
export function formatReagentDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export type ReagentExpiryState =
  | 'unknown'
  | 'valid'
  | 'expiring'
  | 'expired'

/**
 * 根据记录的有效期判断容器是否过期或在三十天内临期。
 * @param value 容器或批次投影返回的有效期。
 * @param referenceTime 用于测试和页面判断的参考时间戳，默认当前时间。
 * @returns 有效期提示状态；无效日期保持 unknown，不推断可用性。
 */
export function resolveReagentExpiryState(
  value?: string,
  referenceTime = Date.now()
): ReagentExpiryState {
  if (!value) return 'unknown'
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const reference = new Date(referenceTime)
    const expiryDay = Date.UTC(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3])
    )
    const referenceDay = Date.UTC(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate()
    )
    const dayDifference = Math.round(
      (expiryDay - referenceDay) / (24 * 60 * 60 * 1000)
    )
    if (dayDifference < 0) return 'expired'
    return dayDifference <= 30 ? 'expiring' : 'valid'
  }
  const expiryTime = new Date(value).valueOf()
  if (Number.isNaN(expiryTime)) return 'unknown'
  if (expiryTime < referenceTime) return 'expired'
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return expiryTime - referenceTime <= thirtyDaysMs ? 'expiring' : 'valid'
}

/**
 * 汇总容器记录中需要实验室人员复核的非可用性提示。
 * @param container 已连接 Material、批次和数量库存的试剂容器行。
 * @param referenceTime 用于判断过期和临期的参考时间戳。
 * @returns 低余量、位置、容器、批次质量和有效期提示；不等同任务可用性。
 */
export function reagentContainerAttentionReasons(
  container: ReagentContainerRow,
  referenceTime = Date.now()
): readonly string[] {
  const reasons: string[] = []
  if (container.remainingRatio <= 0.2) reasons.push('低余量')
  if (!container.material.placed) reasons.push('未放置')
  if (container.state === 'quarantined') reasons.push('容器隔离')
  if (container.state === 'empty') reasons.push('容器已用尽')
  if (container.lot.qualityState !== 'released') {
    reasons.push(`批次${formatReagentQualityState(container.lot.qualityState)}`)
  }
  const expiryState = resolveReagentExpiryState(
    container.expiresAt ?? container.lot.expiresAt,
    referenceTime
  )
  if (expiryState === 'expired') reasons.push('已过期')
  if (expiryState === 'expiring') reasons.push('三十天内到期')
  return reasons
}

/**
 * 将批次质量状态翻译为稳定的中文业务标签。
 * @param value 试剂批次投影中的质量状态闭集。
 * @returns 只表达批次质量流程、不承诺任务可用性的中文标签。
 */
export function formatReagentQualityState(
  value: ReagentQualityState
): string {
  return ({
    released: '已放行',
    pending: '待质检',
    quarantined: '隔离',
    rejected: '已拒收'
  })[value]
}
