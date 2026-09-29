/**
 * 容器装料上限。OS 只用体积或质量之一表达同一个容器，未观测到的维度保持
 * `null`，不折叠成 0。
 */
export interface CapacityLimits {
  readonly maxVolumeUl: number | null
  readonly maxMassG: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

interface ReagentIdentity {
  readonly source: 'os' | 'fixture'
  readonly reagentUuid: string
  readonly materialUuid: string
  readonly reagentInfoUuid: string
  readonly name: string
  readonly nameEn: string | null
  readonly cas: string | null
  readonly molecularFormula: string | null
  readonly physicalState: string | null
  readonly quantity: number | null
  readonly quantityUnit: string | null
  readonly reservedQuantity: number | null
  readonly concentrationValue: number | null
  readonly concentrationUnit: string | null
  readonly densityGPerMl: number | null
  readonly densitySource: string | null
  readonly revision: number | null
  readonly materialRevision: number | null
  readonly containerBarcode: string | null
  readonly containerName: string | null
  /** 该容器当前生效的装料上限，由 OS 合并额定规格与手工配置后给出。 */
  readonly maximumCapacity: CapacityLimits | null
  readonly configuredCapacity: CapacityLimits | null
  readonly ratedCapacity: CapacityLimits | null
  readonly reagentInfo: ReagentInfo | null
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface Reagent extends ReagentIdentity {
  readonly kind: 'reagent'
  readonly status: string
}

export interface ReagentInfo {
  readonly kind: 'reagent_info'
  readonly source: 'os' | 'fixture'
  readonly reagentInfoUuid: string
  readonly name: string
  readonly nameEn: string | null
  readonly aliases: readonly string[]
  readonly cas: string | null
  readonly molecularFormula: string | null
  readonly smiles: string | null
  readonly inchiKey: string | null
  readonly molecularWeight: number | null
  readonly densityGPerMl: number | null
  readonly physicalState: string
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentPage {
  readonly items: readonly Reagent[]
  readonly total: number | null
  readonly page: number | null
  readonly pageSize: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentInfoPage {
  readonly items: readonly ReagentInfo[]
  readonly total: number | null
  readonly page: number | null
  readonly pageSize: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryTemplate {
  readonly templateId: string
  readonly name: string
  readonly category: string
  readonly specJson: string | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryLot {
  readonly lotId: string
  readonly templateId: string
  readonly batchNo: string | null
  readonly unit: string | null
  readonly totalQuantity: number | null
  readonly availableQuantity: number | null
  readonly reservedQuantity: number | null
  readonly expiry: string | null
  readonly quarantined: boolean | null
  readonly warehouseZoneId: string | null
  readonly createdAt: number | null
  readonly version: number | null
  readonly status: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryInstance {
  readonly instanceUuid: string
  readonly legacyCloudId: string | null
  readonly lotId: string | null
  readonly templateId: string
  readonly barcode: string | null
  readonly status: string
  readonly version: number | null
  readonly parentUuid: string | null
  readonly relation?: InventoryRelation | null
  readonly content?: InventoryContent | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryRelation {
  readonly parentUuid: string
  readonly slotId: string | null
  readonly childUuid: string
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryContent {
  readonly instanceUuid: string
  readonly stateJson: string | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryReservation {
  readonly reservationId: string
  readonly workflowId: string
  readonly nodeId: string | null
  readonly attempt: number | null
  readonly status: string
  readonly amountsJson: string | null
  readonly createdAt: number | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

/** 创建试剂身份的草稿。`cas` 留空时由 OS 按纯手工身份登记。 */
export interface ReagentInfoDraft {
  readonly name: string
  readonly cas?: string
  readonly nameEn?: string | null
  readonly aliases?: readonly string[]
  readonly molecularFormula?: string | null
  readonly smiles?: string | null
  readonly inchiKey?: string | null
  readonly molecularWeight?: number | null
  readonly densityGPerMl?: number | null
  readonly physicalState?: string
  readonly description?: string | null
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * 更新试剂身份。只发送显式出现的键：未给出的字段保持 OS 原值，给出 `null`
 * 表示清空。
 */
export type ReagentInfoPatch = Partial<ReagentInfoDraft>

/** 手工设置的容器装料上限。体积与质量只能给其中一个维度。 */
export interface CapacityInput {
  readonly maxVolumeUl?: number
  readonly maxMassG?: number
}

/**
 * 在已存在的容器上登记试剂。`reagentInfoUuid` 与 `cas` 必须二选一；容器没有
 * 额定或已配置上限时必须同时提交 `containerCapacity`。
 */
export interface ReagentDraft {
  readonly materialUuid: string
  readonly reagentInfoUuid?: string
  readonly cas?: string
  readonly quantity: number
  readonly quantityUnit: string
  readonly physicalState?: string
  readonly densityGPerMl?: number | null
  readonly concentrationValue?: number | null
  readonly concentrationUnit?: string | null
  readonly source?: string | null
  readonly observedAt?: string | null
  readonly description?: string | null
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly containerCapacity?: CapacityInput
  readonly expectedMaterialRevision?: number
}

/** 修正一瓶试剂的数量与可编辑属性；`expectedRevision` 做乐观并发校验。 */
export interface ReagentPatch {
  readonly quantity: number
  readonly quantityUnit: string
  readonly expectedRevision?: number
  readonly concentrationValue?: number | null
  readonly concentrationUnit?: string | null
  readonly source?: string | null
  readonly observedAt?: string | null
  readonly description?: string | null
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly containerCapacity?: CapacityInput
  readonly expectedMaterialRevision?: number
}

export type CompoundLookupStatus =
  | 'registered'
  | 'ok'
  | 'not_found'
  | 'unavailable'

export interface CompoundCandidate {
  readonly name: string | null
  readonly molecularFormula: string | null
  readonly smiles: string | null
  readonly inchiKey: string | null
  readonly molecularWeight: number | null
  readonly densityGPerMl: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 按 CAS 查询化合物。`registered` 表示本地已登记，`not_found` 与
 * `unavailable` 都不是错误，调用方应转为手工填写而不是阻断录入。
 */
export interface CompoundLookup {
  readonly kind: 'compound_lookup'
  readonly source: 'os'
  readonly cas: string
  readonly status: CompoundLookupStatus
  readonly message: string | null
  readonly compound: CompoundCandidate | null
  readonly raw: Readonly<Record<string, unknown>>
}

/** 三维结构缓存投影；尚未生成时 `status` 为 `pending`，内容为 `null`。 */
export interface ReagentStructure3d {
  readonly kind: 'reagent_structure_3d'
  readonly source: 'os'
  readonly reagentInfoUuid: string
  readonly identityKey: string | null
  readonly format: string | null
  readonly structureSource: string | null
  readonly sourceId: string | null
  readonly content: string | null
  readonly checksum: string | null
  readonly status: string
  readonly generatedAt: string | null
  readonly errorMessage: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 不可变库存台账的一条记录。分装等复合操作按 `causationId` 聚合同一次动作产生
 * 的多条记录。
 */
export interface ReagentHistoryEntry {
  readonly kind: 'reagent_history_entry'
  readonly source: 'os'
  readonly historyUuid: string
  readonly materialUuid: string
  readonly eventType: string
  readonly operatorType: string
  readonly causationId: string | null
  readonly changes: Readonly<Record<string, unknown>>
  readonly extension: Readonly<Record<string, unknown>>
  readonly traceId: string | null
  readonly recordedAt: string
  readonly workflowTaskUuid: string | null
  readonly workflowNodeJobUuid: string | null
  readonly subjectType: string
  readonly subjectUuid: string
  readonly quantityDelta: number | null
  readonly quantityUnit: string | null
  readonly revision: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentHistoryPage {
  readonly items: readonly ReagentHistoryEntry[]
  readonly page: number | null
  readonly pageSize: number | null
  readonly hasMore: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentBatchFieldError {
  readonly field: string
  readonly message: string
}

/** 批量导入的行级失败。整批错误没有行号，`row` 保持 `null`。 */
export interface ReagentBatchRowError {
  readonly row: number | null
  readonly errors: readonly ReagentBatchFieldError[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentBatchInput {
  readonly items: readonly Readonly<Record<string, unknown>>[]
  readonly atomic?: boolean
}

export interface ReagentImportInput {
  readonly file: File | Blob
  readonly fileName?: string
  readonly atomic?: boolean
}

interface ReagentBatchOutcome {
  readonly total: number
  readonly created: number
  readonly failed: number
  readonly atomic: boolean
  readonly errors: readonly ReagentBatchRowError[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentInfoBatchResult extends ReagentBatchOutcome {
  readonly kind: 'reagent_info_batch_result'
  readonly source: 'os'
  readonly items: readonly ReagentInfo[]
}

export interface ReagentBatchResult extends ReagentBatchOutcome {
  readonly kind: 'reagent_batch_result'
  readonly source: 'os'
  readonly items: readonly Reagent[]
}

export interface ReagentDispenseTarget {
  readonly materialUuid: string
  readonly quantity: number
  readonly containerCapacity?: CapacityInput
  readonly expectedMaterialRevision?: number
}

/**
 * 试剂分装命令。`commandId` 是幂等键：同一个 id 重放不会重复扣减。OS 在一次
 * 事务内从源瓶扣减并写入全部目标容器。
 */
export interface ReagentDispenseCommand {
  readonly commandId: string
  readonly sourceReagentUuid: string
  readonly quantityUnit: string
  readonly targets: readonly ReagentDispenseTarget[]
  readonly expectedRevision?: number
  readonly reason?: string
  readonly actor?: string
  readonly warehouseZoneId?: string
}

export interface ReagentDispenseLine {
  readonly reagentUuid: string
  readonly materialUuid: string | null
  readonly quantity: number | null
  readonly quantityUnit: string | null
  readonly revision: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 分装命令的执行结果。`status` 由 OS 给出；`version_conflict` 等失败原因保留在
 * `errorCode`，不折叠成通用失败。
 */
export interface ReagentDispenseResult {
  readonly kind: 'reagent_dispense_result'
  readonly source: 'os'
  readonly commandId: string
  readonly status: string
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly sourceLine: ReagentDispenseLine | null
  readonly targets: readonly ReagentDispenseLine[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventorySnapshot {
  readonly kind: 'inventory_snapshot'
  readonly source: 'os' | 'fixture'
  readonly snapshotSequence: number | null
  readonly templates: readonly InventoryTemplate[]
  readonly lots: readonly InventoryLot[]
  readonly instances: readonly InventoryInstance[]
  readonly relations: readonly InventoryRelation[]
  readonly contents: readonly InventoryContent[]
  readonly reservations: readonly InventoryReservation[]
  readonly raw: Readonly<Record<string, unknown>>
}
