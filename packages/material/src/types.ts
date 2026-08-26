export type MaterialId = string
export type MaterialTemplateId = string
export type SiteId = string
export type MaterialRevision = number

export type Vector3Tuple = readonly [number, number, number]

export const MATERIAL_MEASUREMENT_UNITS = [
  'uL',
  'mL',
  'L',
  'ug',
  'mg',
  'g',
  'umol',
  'mmol',
  'mol',
  'umol/L',
  'mmol/L',
  'mol/L',
  'ug/mL',
  'mg/mL',
  'g/L',
  '%'
] as const

export type MaterialMeasurementUnit =
  (typeof MATERIAL_MEASUREMENT_UNITS)[number]

const MATERIAL_MEASUREMENT_UNIT_SET = new Set<string>(
  MATERIAL_MEASUREMENT_UNITS
)

export function isMaterialMeasurementUnit(
  value: string
): value is MaterialMeasurementUnit {
  return MATERIAL_MEASUREMENT_UNIT_SET.has(value)
}

export interface Measurement {
  value: number
  unit: MaterialMeasurementUnit
}

export interface LabPose {
  positionMm: Vector3Tuple
  rotationDegXYZ: Vector3Tuple
}

export type MaterialAnchor =
  | { kind: 'root' }
  | { kind: 'link'; linkName: string }

export type MaterialPlacement =
  | { kind: 'unplaced' }
  | { kind: 'world'; pose: LabPose }
  | {
      kind: 'parent'
      parentId: MaterialId
      anchor: MaterialAnchor
      localPose: LabPose
    }
  | {
      kind: 'site'
      parentId: MaterialId
      siteId: SiteId
      offsetPose: LabPose
    }

export type MaterialDropIntent =
  | { kind: 'unplaced' }
  | { kind: 'world'; pose: LabPose }
  | {
      kind: 'parent'
      parentId: MaterialId
      anchor: MaterialAnchor
      localPose: LabPose
    }
  | {
      kind: 'site'
      parentId: MaterialId
      siteId: SiteId
    }

export interface ManagedMaterialComponent {
  kind: 'well'
  key: string
  managedByParent: true
}

export interface Material {
  id: MaterialId
  sourceTemplateId: MaterialTemplateId
  code: string
  name: string
  description?: string
  component?: ManagedMaterialComponent
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Backend 冻结在物料位置上的 2.5D 外形稳定身份。 */
export interface MaterialShapeIdentity {
  bundle: string
  id: string
}

export interface MaterialSite {
  id: SiteId
  ownerMaterialId: MaterialId
  key: string
  name: string
  /** 公共物料图发布的业务展示顺序；旧的内存夹具缺失时由消费者使用零回退。 */
  sortOrder?: number
  anchor: MaterialAnchor
  poseInAnchor: LabPose
  sizeMm: Vector3Tuple
  capacity: number
  allowedTemplateIds: readonly MaterialTemplateId[]
  occupiedMaterialIds: readonly MaterialId[]
  kind?: 'site' | 'deck-slot' | 'well' | 'tip-spot'
  shape?: 'circle' | 'rectangle'
  visible?: boolean
  maxVolumeUl?: number
  visual?: {
    state: 'empty' | 'occupied' | 'filled' | 'tip-present'
    fillFraction: number
  }
}

export interface MaterialAggregate {
  material: Material
  placement: MaterialPlacement
  sites: readonly MaterialSite[]
  revision: MaterialRevision
  /** 精确关联 `/api/v1/material-shapes`；旧图缺失时由渲染器走分类兼容。 */
  shapeIdentity?: MaterialShapeIdentity
}

export type MaterialScope =
  | { kind: 'singleton' }
  | { kind: 'laboratory'; laboratoryId: string }

export type EdgeProvisioning =
  | { kind: 'none' }
  | { kind: 'resource-tree' }
  | { kind: 'dynamic-device' }

export type EdgeSyncState =
  | 'not-required'
  | 'pending'
  | 'synced'
  | 'failed'

export interface ReagentInfoSummary {
  id: string
  name: string
  physicalState: string
  cas?: string
  aliases: readonly string[]
  displayColor?: string
}

export interface NewReagentInfoInput {
  name: string
  physicalState: string
  cas?: string
  aliases?: readonly string[]
  molecularFormula?: string
  smiles?: string
  inchiKey?: string
  molecularWeight?: number
}

export interface NewSampleInput {
  code: string
  name: string
  sampleType?: string
  source?: string
  quantity: Measurement
  collectedAt?: string
  expiresAt?: string
}

export interface SubstanceComponent {
  name: string
  quantity?: Measurement
}

export interface ReagentContent {
  kind: 'reagent'
  contentId: string
  materialId: MaterialId
  reagentInfo: ReagentInfoSummary
  quantity: Measurement
  concentration?: Measurement
}

export interface SampleContent {
  kind: 'sample'
  contentId: string
  materialId: MaterialId
  code: string
  name: string
  sampleType?: string
  source?: string
  quantity: Measurement
  collectedAt?: string
  expiresAt?: string
}

export interface CurrentSubstanceContent {
  kind: 'current-substance'
  contentId: string
  materialId: MaterialId
  name?: string
  composition: readonly SubstanceComponent[]
  quantity: Measurement
  revision: number
  readonly: true
}

export type MaterialContent =
  | ReagentContent
  | SampleContent
  | CurrentSubstanceContent

export type MaterialContentDraftTarget =
  | { kind: 'material' }
  | { kind: 'managed-component'; componentKey: string }

export type ReagentInfoDraft =
  | { kind: 'existing'; reagentInfoId: string }
  | { kind: 'new'; input: NewReagentInfoInput }

export type InitialMaterialContentDraft =
  | {
      target: MaterialContentDraftTarget
      content: {
        kind: 'reagent'
        reagentInfo: ReagentInfoDraft
        quantity: Measurement
        concentration?: Measurement
      }
    }
  | {
      target: MaterialContentDraftTarget
      content: {
        kind: 'sample'
        input: NewSampleInput
      }
    }

export interface MaterialEdgeOperation {
  operationId: string
  materialId: MaterialId
  operation: 'provision' | 'undo-create'
  provisioning: EdgeProvisioning
  state: 'pending' | 'edge-completed' | 'committed' | 'failed'
  error?: {
    code: string
    message: string
  }
}

export interface CreateMaterialInput {
  templateId: MaterialTemplateId
  name: string
  placement: MaterialDropIntent
  initialContents: readonly InitialMaterialContentDraft[]
  config?: Record<string, unknown>
  expectedRevision?: MaterialRevision
}

export interface CreateMaterialResult {
  aggregates: readonly MaterialAggregate[]
  primaryMaterialId: MaterialId
  creationOperationId: string
  edgeSyncState: EdgeSyncState
}

export interface UpdateMaterialConfigCommand {
  materialId: MaterialId
  expectedRevision: MaterialRevision
  patch: {
    name?: string
    description?: string
    config?: Record<string, unknown>
  }
}

export interface MoveMaterialCommand {
  materialId: MaterialId
  expectedRevision: MaterialRevision
  idempotencyKey: string
  placement: MaterialPlacement
}

export interface AttachMaterialCommand {
  parentId: MaterialId
  childId: MaterialId
  siteId?: SiteId
  expectedParentRevision: MaterialRevision
  expectedChildRevision: MaterialRevision
}

export interface DetachMaterialCommand {
  parentId: MaterialId
  childId: MaterialId
  expectedParentRevision: MaterialRevision
  expectedChildRevision: MaterialRevision
}

export interface UpdateMaterialSiteCommand {
  materialId: MaterialId
  siteId: SiteId
  expectedRevision: MaterialRevision
  patch: {
    name?: string
    anchor?: MaterialAnchor
    poseInAnchor?: LabPose
    sizeMm?: Vector3Tuple
    capacity?: number
    allowedTemplateIds?: readonly MaterialTemplateId[]
  }
}

export interface UndoCreateMaterialCommand {
  materialId: MaterialId
  creationOperationId: string
  expectedRevision: MaterialRevision
  idempotencyKey: string
}

export interface MaterialMutationResult {
  aggregates: readonly MaterialAggregate[]
}

export interface MaterialMovedEvent {
  id: string
  materialId: MaterialId
  revision?: MaterialRevision
  fromParentId?: MaterialId
  fromSite?: string
  toParentId: MaterialId
  toSite?: string
}

export interface MaterialMoveSubscription {
  dispose(): void
}

export interface MaterialMoveSubscriptionOptions {
  /** SSE 重连无法证明增量连续时，要求调用方重新读取权威 Material 图。 */
  onResyncRequired?(): void
}

export interface MaterialGraphPort {
  getGraph(scope: MaterialScope): Promise<readonly MaterialAggregate[]>
  /**
   * 物料移动通知用于增量更新当前页面；只在页面初次加载时读取完整物料图。
   */
  subscribeMoves?(
    onMove: (event: MaterialMovedEvent) => void,
    options?: MaterialMoveSubscriptionOptions
  ): MaterialMoveSubscription
  /**
   * 2.5D 外形声明由设备包定义、Backend 通过 `/api/v1/material-shapes` 提供。
   * 旧服务可能没有该端点，所以接口可选；取不到时视图退回实心包围盒。
   */
  getShapeLibrary?(): Promise<
    import('./oblique/shapeSpec').MaterialShapeLibrary
  >
  createMaterial(
    scope: MaterialScope,
    input: CreateMaterialInput
  ): Promise<CreateMaterialResult>
  undoCreate(command: UndoCreateMaterialCommand): Promise<void>
  updateConfig(
    command: UpdateMaterialConfigCommand
  ): Promise<MaterialAggregate>
  move(command: MoveMaterialCommand): Promise<MaterialAggregate>
  attach(command: AttachMaterialCommand): Promise<MaterialMutationResult>
  detach(command: DetachMaterialCommand): Promise<MaterialMutationResult>
  updateSite(
    command: UpdateMaterialSiteCommand
  ): Promise<MaterialAggregate>
  getEdgeOperations(
    scope: MaterialScope,
    operationIds?: readonly string[]
  ): Promise<readonly MaterialEdgeOperation[]>
}

export type MaterialCapability =
  | 'material.readGraph'
  | 'material.subscribeMoves'
  | 'material.create'
  | 'material.updateConfig'
  | 'material.updateSite'
  | 'material.move'
  | 'material.attach'
  | 'material.detach'
  | 'material.deleteSubtrees'
  | 'material.readContents'
  | 'material.updateContents'
  | 'material.persistentUndo'
  | 'reagentInfo.read'
  | 'reagentInfo.create'
  | 'edge.undoCreate'

export interface MaterialStoreDependencies {
  scope: MaterialScope
  graph: MaterialGraphPort
  requireCapability: (capability: MaterialCapability) => void
  createIdempotencyKey?: () => string
}

export interface MaterialGraphIndex {
  childrenByParentId: Readonly<Record<MaterialId, readonly MaterialId[]>>
  siteOwnerById: Readonly<Record<SiteId, MaterialId>>
}

export interface MaterialAuthoringAggregate {
  material: Material
  placement: MaterialPlacement
  sites: readonly MaterialSite[]
}

export interface MaterialAuthoringSnapshot {
  aggregatesById: Readonly<Record<MaterialId, MaterialAuthoringAggregate>>
}
