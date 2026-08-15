import type { ReactNode } from 'react'

export type WorkstationModule = 'debug' | 'points' | 'bench' | 'reagents'

export interface RobotWorkstationProps {
  module: WorkstationModule
  actionContent?: ReactNode
  pointSnapshot?: PointManagementSnapshot
  pointStatus?: WorkstationDataStatus
  benchSnapshot?: BenchSnapshot
  benchStatus?: WorkstationDataStatus
  reagentItems?: readonly ReagentInventoryProjection[]
  reagentStatus?: WorkstationDataStatus
  reagentInfos?: readonly ReagentInfoProjection[]
  reagentInfoStatus?: WorkstationDataStatus
  reagentManagement?: ReagentManagement
  reagentInfoManagement?: ReagentInfoManagement
}

export interface WorkstationDataStatus {
  phase: 'loading' | 'ready' | 'empty' | 'error' | 'unavailable'
  message: string
  retry?: () => void
}

export interface Pose6D {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export interface RobotActionStep {
  id: string
  label: string
  motion: 'PTP' | 'LIN' | 'IO'
  pointName: string
  speed: number | null
  pose: Pose6D
}

export interface RobotPoint {
  id: string
  label: string
  kind: 'home' | 'approach' | 'interact' | 'retreat' | 'custom'
  motion: 'PTP' | 'LIN'
  status: RobotPointStatus
  pose: Pose6D
}

export type RobotPointStatus = 'uncalibrated' | 'pending_verification' | 'verified' | 'disabled'

export interface WorkstationSite {
  id: string
  label: string
  category: '原料库位' | '缓存库位' | '工装库位'
  materialLabel?: string
  calibrated: boolean
  points: RobotPoint[]
}

export interface SiteCatalogRecord {
  id: string
  label: string
  category: WorkstationSite['category']
  materialLabel?: string
}

export interface PointConfigVersion {
  version: string
  note: string
  savedAt: string
  fileHash: string
}

export interface PointManagementSnapshot {
  sites: readonly WorkstationSite[]
  catalog: readonly SiteCatalogRecord[]
  history: readonly PointConfigVersion[]
}

export type ProjectionStatus = 'empty' | 'occupied' | 'unknown'

export interface BenchSiteProjection {
  id: string
  name: string
  device: string
  position: string
  materialType: string
  materialName: string | null
  workflowLabel: string | null
  status: ProjectionStatus
  unknownReason?: string
  x: number
  y: number
  width: number
}

export interface BenchMaterialProjection {
  id: string
  name: string
  template: string
  location: string
  status: 'idle' | 'reserved' | 'unknown'
  workflowLabel: string | null
  siteId: string
}

export interface BenchHistoryRecord {
  id: string
  objectKind: 'site' | 'material'
  objectId: string
  taskId: string | null
  action: string
  occurredAt: string
  traceId: string
}

export interface BenchSnapshot {
  sites: readonly BenchSiteProjection[]
  materials: readonly BenchMaterialProjection[]
  history: readonly BenchHistoryRecord[]
}

export interface ReagentInventoryProjection {
  id: string
  materialId?: string
  reagentInfoId?: string
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
  status: 'available' | 'reserved' | 'empty' | 'quarantined' | 'unknown'
}

/** 试剂库展示的 Backend 试剂基础信息（Reagent Info）只读投影。 */
export interface ReagentInfoProjection {
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

export type ReagentPhysicalState = 'solid' | 'liquid' | 'gas' | 'other' | 'unknown'

/** 手工登记 Backend 化学品字典身份的完整可编辑字段。 */
export interface ReagentInfoCreateCommand {
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

/** 纠错一个既有化学品身份；留空的可空字段由 Backend 清除。 */
export interface ReagentInfoUpdateCommand extends ReagentInfoCreateCommand {
  id: string
}

export interface ReagentInfoLookupCandidate {
  name?: string
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
}

export interface ReagentInfoLookupResult {
  cas: string
  status: 'ok' | 'registered' | 'not_found' | 'unavailable'
  message?: string
  compound?: ReagentInfoLookupCandidate
}

/** Backend 化学品字典 CRUD 命令端口，独立于容器级试剂实例管理。 */
export interface ReagentInfoManagement {
  lookupByCAS(cas: string, signal?: AbortSignal): Promise<ReagentInfoLookupResult>
  create(command: ReagentInfoCreateCommand): Promise<void>
  update(command: ReagentInfoUpdateCommand): Promise<void>
  delete(reagentInfoId: string): Promise<void>
}

export interface ReagentContainerOption {
  id: string
  name: string
  barcode?: string
  templateId: string
}

export interface ReagentCreateCommand {
  materialId: string
  cas: string
  physicalState: ReagentPhysicalState
  densityGPerMl?: number
  concentrationValue?: number
  concentrationUnit?: string
  quantity: number
  quantityUnit: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ReagentUpdateCommand {
  id: string
  quantity: number
  quantityUnit: string
  expectedRevision: number
  concentrationValue?: number
  concentrationUnit?: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface ReagentHistoryProjection {
  id: string
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

export interface ReagentManagement {
  containers?: readonly ReagentContainerOption[]
  containerStatus: WorkstationDataStatus
  create(command: ReagentCreateCommand): Promise<void>
  update(command: ReagentUpdateCommand): Promise<void>
  delete(reagentId: string): Promise<void>
  readHistory(materialId: string): Promise<readonly ReagentHistoryProjection[]>
}

export interface CustomParameter {
  name: string
  value: string
}

export interface ReagentDefinition {
  id: string
  code: string
  name: string
  cas: string
  formula: string
  structure: string
  molecularWeight: string
  form: '液体' | '固体' | '气体' | '液体（水溶液）'
  defaultUnit: string
  custom: CustomParameter[]
}

export interface ReagentLedgerRow {
  id: string
  internalNumber: string
  reagentId: string
  densityValue: number
  densityUnit: string
  densityCondition: string
  supplier: string
  registeredOn: string
  expiresOn: string
  remainingQuantity: number
  reservedQuantity: number
  unit: string
  siteId: string
  siteLabel: string
  workflowLabel: string | null
  displayStatus: '使用中' | '可用' | '已预留' | '状态不明' | '已归档'
  custom: CustomParameter[]
  archivedAt?: string
  archiveReason?: string
  records: ReagentRecord[]
}

export interface ReagentRecord {
  id: string
  taskId: string | null
  action: string
  quantityDelta: number | null
  fromSite: string | null
  toSite: string | null
  result: 'success' | 'failed' | 'execution_unknown' | 'local'
  trusted: boolean
  occurredAt: string
  traceId: string
}

export interface WorkstationNavigationItem {
  id: WorkstationModule
  label: string
  description: string
  icon: ReactNode
}
