import { ReagentInventoryError } from './errors'
import type {
  EdgeInstanceListResponse,
  EdgeLotListResponse,
  EdgeSnapshotResponse,
  InventoryCommandResponse,
  ReagentBatchResponse,
  ReagentHistoryListResponse,
  ReagentInfoListResponse,
  ReagentInventoryRecord,
  ReagentListResponse
} from './api'
import type {
  CapacityInput,
  CapacityLimits,
  CompoundLookup,
  InventoryContent,
  InventoryInstance,
  InventoryLot,
  InventoryRelation,
  InventoryReservation,
  InventorySnapshot,
  InventoryTemplate,
  Reagent,
  ReagentBatchResult,
  ReagentBatchRowError,
  ReagentDispenseCommand,
  ReagentDispenseLine,
  ReagentDispenseResult,
  ReagentDraft,
  ReagentHistoryEntry,
  ReagentHistoryPage,
  ReagentInfo,
  ReagentInfoBatchResult,
  ReagentInfoDraft,
  ReagentInfoPage,
  ReagentInfoPatch,
  ReagentPage,
  ReagentPatch,
  ReagentStructure3d
} from './model'

export function decodeReagentInfoPage(value: unknown): ReagentInfoPage {
  const root = asRecord(unwrapEnvelope(value), 'reagent info list') as ReagentInfoListResponse
  const items = listItems(root, 'reagent info list')
  return {
    items: items.map((item, index) => decodeReagentInfo(asRecord(item, `reagent_infos.items[${index}]`))),
    total: nullableNonNegativeInteger(root.total, 'reagent_infos.total'),
    page: nullablePositiveInteger(root.page, 'reagent_infos.page'),
    pageSize: nullablePositiveInteger(root.page_size ?? root.pageSize, 'reagent_infos.page_size'),
    raw: root
  }
}

export function decodeReagentInfo(value: unknown): ReagentInfo {
  const raw = asRecord(unwrapEnvelope(value), 'reagent info')
  return {
    kind: 'reagent_info',
    source: 'os',
    reagentInfoUuid: requiredString(raw.uuid, 'reagent_info.uuid'),
    name: requiredString(raw.name, 'reagent_info.name'),
    nameEn: nullableString(raw.name_en, 'reagent_info.name_en'),
    aliases: stringArray(raw.aliases ?? [], 'reagent_info.aliases'),
    cas: nullableString(raw.cas, 'reagent_info.cas'),
    molecularFormula: nullableString(raw.molecular_formula, 'reagent_info.molecular_formula'),
    smiles: nullableString(raw.smiles, 'reagent_info.smiles'),
    inchiKey: nullableString(raw.inchi_key, 'reagent_info.inchi_key'),
    molecularWeight: nullableFiniteNumber(raw.molecular_weight, 'reagent_info.molecular_weight'),
    densityGPerMl: nullableFiniteNumber(raw.density_g_per_ml, 'reagent_info.density_g_per_ml'),
    physicalState: requiredString(raw.physical_state, 'reagent_info.physical_state'),
    description: nullableString(raw.description, 'reagent_info.description'),
    metadata: optionalRecord(raw.meta_data, 'reagent_info.meta_data'),
    createdAt: nullableString(raw.create_time, 'reagent_info.create_time'),
    updatedAt: nullableString(raw.update_time, 'reagent_info.update_time'),
    raw
  }
}

export function decodeReagentPage(value: unknown): ReagentPage {
  const root = asRecord(unwrapEnvelope(value), 'reagent list') as ReagentListResponse
  const items = listItems(root, 'reagent list')
  return {
    items: items.map((item, index) => decodeReagent(asRecord(item, `reagents.items[${index}]`))),
    total: nullableNonNegativeInteger(root.total, 'reagents.total'),
    page: nullablePositiveInteger(root.page, 'reagents.page'),
    pageSize: nullablePositiveInteger(root.page_size ?? root.pageSize, 'reagents.page_size'),
    raw: root
  }
}

export function decodeReagent(value: unknown): Reagent {
  const raw = asRecord(unwrapEnvelope(value), 'reagent')
  const quantity = nullableFiniteNumber(raw.quantity, 'reagent.quantity')
  return {
    kind: 'reagent',
    source: 'os',
    densitySource: nullableString(raw.density_source, 'reagent.density_source'),
    materialRevision: nullableNonNegativeInteger(raw.material_revision, 'reagent.material_revision'),
    maximumCapacity: nullableCapacity(raw.maximum_capacity, 'reagent.maximum_capacity'),
    configuredCapacity: nullableCapacity(raw.configured_capacity, 'reagent.configured_capacity'),
    ratedCapacity: nullableCapacity(raw.rated_capacity, 'reagent.rated_capacity'),
    reagentInfo: raw.reagent_info == null
      ? null
      : decodeReagentInfo(asRecord(raw.reagent_info, 'reagent.reagent_info')),
    reagentUuid: requiredString(raw.uuid, 'reagent.uuid'),
    materialUuid: requiredString(raw.material_uuid, 'reagent.material_uuid'),
    reagentInfoUuid: requiredString(raw.reagent_info_uuid, 'reagent.reagent_info_uuid'),
    name: requiredString(raw.name, 'reagent.name'),
    nameEn: nullableString(raw.name_en, 'reagent.name_en'),
    cas: nullableString(raw.cas, 'reagent.cas'),
    molecularFormula: nullableString(raw.molecular_formula, 'reagent.molecular_formula'),
    physicalState: nullableString(raw.physical_state, 'reagent.physical_state'),
    quantity,
    quantityUnit: nullableString(raw.quantity_unit, 'reagent.quantity_unit'),
    reservedQuantity: nullableFiniteNumber(
      raw.active_workflow_reserved_quantity,
      'reagent.active_workflow_reserved_quantity'
    ),
    concentrationValue: nullableFiniteNumber(raw.concentration_value, 'reagent.concentration_value'),
    concentrationUnit: nullableString(raw.concentration_unit, 'reagent.concentration_unit'),
    densityGPerMl: nullableFiniteNumber(raw.density_g_per_ml, 'reagent.density_g_per_ml'),
    revision: nullableNonNegativeInteger(raw.revision, 'reagent.revision'),
    containerBarcode: nullableString(raw.container_barcode, 'reagent.container_barcode'),
    containerName: nullableString(raw.container_name, 'reagent.container_name'),
    description: nullableString(raw.description, 'reagent.description'),
    metadata: optionalRecord(raw.meta_data, 'reagent.meta_data'),
    createdAt: nullableString(raw.create_time, 'reagent.create_time'),
    updatedAt: nullableString(raw.update_time, 'reagent.update_time'),
    status: quantity === null ? 'unknown' : quantity > 0 ? 'available' : 'empty',
    raw
  }
}

/** 校验信封是否被 OS 接受；删除等没有返回投影的写入使用它。 */
export function assertReagentEnvelopeAccepted(value: unknown): void {
  unwrapEnvelope(value)
}

export function decodeCompoundLookup(value: unknown): CompoundLookup {
  const raw = asRecord(unwrapEnvelope(value), 'compound lookup')
  const status = requiredString(raw.status, 'compound.status')
  if (status !== 'registered' && status !== 'ok' && status !== 'not_found' && status !== 'unavailable') {
    invalid(`compound.status ${status} is not a known lookup status`)
  }
  const compound = asOptionalRecord(raw.compound)
  return {
    kind: 'compound_lookup',
    source: 'os',
    cas: requiredString(raw.cas, 'compound.cas'),
    status,
    message: nullableString(raw.message, 'compound.message'),
    compound: compound === undefined ? null : {
      name: nullableString(compound.name, 'compound.compound.name'),
      molecularFormula: nullableString(compound.molecular_formula, 'compound.compound.molecular_formula'),
      smiles: nullableString(compound.smiles, 'compound.compound.smiles'),
      inchiKey: nullableString(compound.inchi_key, 'compound.compound.inchi_key'),
      molecularWeight: nullableFiniteNumber(compound.molecular_weight, 'compound.compound.molecular_weight'),
      densityGPerMl: nullableFiniteNumber(compound.density_g_per_ml, 'compound.compound.density_g_per_ml'),
      raw: compound
    },
    raw
  }
}

export function decodeReagentStructure3d(value: unknown): ReagentStructure3d {
  const raw = asRecord(unwrapEnvelope(value), 'reagent structure')
  return {
    kind: 'reagent_structure_3d',
    source: 'os',
    reagentInfoUuid: requiredString(raw.reagent_info_uuid, 'structure.reagent_info_uuid'),
    identityKey: nullableString(raw.identity_key, 'structure.identity_key'),
    format: nullableString(raw.format, 'structure.format'),
    structureSource: nullableString(raw.source, 'structure.source'),
    sourceId: nullableString(raw.source_id, 'structure.source_id'),
    content: nullableString(raw.content, 'structure.content'),
    checksum: nullableString(raw.checksum, 'structure.checksum'),
    status: requiredString(raw.status, 'structure.status'),
    generatedAt: nullableString(raw.generated_at, 'structure.generated_at'),
    errorMessage: nullableString(raw.error_message, 'structure.error_message'),
    updatedAt: nullableString(raw.update_time, 'structure.update_time'),
    raw
  }
}

export function decodeReagentHistoryPage(value: unknown): ReagentHistoryPage {
  const root = asRecord(unwrapEnvelope(value), 'reagent history list') as ReagentHistoryListResponse
  const items = listItems(root, 'reagent history list')
  return {
    items: items.map((item, index) => decodeReagentHistoryEntry(asRecord(item, `reagent_history.items[${index}]`))),
    page: nullablePositiveInteger(root.page, 'reagent_history.page'),
    pageSize: nullablePositiveInteger(root.page_size, 'reagent_history.page_size'),
    hasMore: root.has_more === true,
    raw: root
  }
}

export function decodeReagentHistoryEntry(value: unknown): ReagentHistoryEntry {
  const raw = asRecord(unwrapEnvelope(value), 'reagent history')
  return {
    kind: 'reagent_history_entry',
    source: 'os',
    historyUuid: requiredString(raw.uuid, 'reagent_history.uuid'),
    materialUuid: requiredString(raw.material_uuid, 'reagent_history.material_uuid'),
    eventType: requiredString(raw.event_type, 'reagent_history.event_type'),
    operatorType: requiredString(raw.operator_type, 'reagent_history.operator_type'),
    causationId: nullableString(raw.causation_id, 'reagent_history.causation_id'),
    changes: optionalRecord(raw.changes, 'reagent_history.changes'),
    extension: optionalRecord(raw.extension, 'reagent_history.extension'),
    traceId: nullableString(raw.trace_id, 'reagent_history.trace_id'),
    recordedAt: requiredString(raw.recorded_at, 'reagent_history.recorded_at'),
    workflowTaskUuid: nullableString(raw.workflow_task_uuid, 'reagent_history.workflow_task_uuid'),
    workflowNodeJobUuid: nullableString(raw.workflow_node_job_uuid, 'reagent_history.workflow_node_job_uuid'),
    subjectType: requiredString(raw.subject_type, 'reagent_history.subject_type'),
    subjectUuid: requiredString(raw.subject_uuid, 'reagent_history.subject_uuid'),
    quantityDelta: nullableFiniteNumber(raw.quantity_delta, 'reagent_history.quantity_delta'),
    quantityUnit: nullableString(raw.quantity_unit, 'reagent_history.quantity_unit'),
    revision: nullableNonNegativeInteger(raw.revision, 'reagent_history.revision'),
    raw
  }
}

export function decodeReagentInfoBatchResult(value: unknown): ReagentInfoBatchResult {
  const root = batchRoot(value)
  return {
    kind: 'reagent_info_batch_result',
    source: 'os',
    ...batchOutcome(root),
    items: (root.items ?? []).map((item, index) =>
      decodeReagentInfo(asRecord(item, `reagent_info_batch.items[${index}]`))
    )
  }
}

export function decodeReagentBatchResult(value: unknown): ReagentBatchResult {
  const root = batchRoot(value)
  return {
    kind: 'reagent_batch_result',
    source: 'os',
    ...batchOutcome(root),
    items: (root.items ?? []).map((item, index) =>
      decodeReagent(asRecord(item, `reagent_batch.items[${index}]`))
    )
  }
}

/**
 * 库存命令响应没有 `{code,data}` 信封。命令被拒绝时 `status` 与 `error_code`
 * 都必须保留，由调用方判断是否可重试。
 */
export function decodeReagentDispenseResult(value: unknown): ReagentDispenseResult {
  const raw = asRecord(value, 'dispense result') as InventoryCommandResponse
  const result = asOptionalRecord(raw.result)
  return {
    kind: 'reagent_dispense_result',
    source: 'os',
    commandId: requiredString(raw.command_id, 'dispense.command_id'),
    status: requiredString(raw.status, 'dispense.status'),
    errorCode: nullableString(raw.error_code, 'dispense.error_code'),
    errorMessage: nullableString(raw.error_message, 'dispense.error_message'),
    sourceLine: result?.source == null
      ? null
      : decodeDispenseLine(asRecord(result.source, 'dispense.result.source'), 'dispense.result.source'),
    targets: decodeArray(
      result?.targets,
      (line) => decodeDispenseLine(line, 'dispense.result.targets'),
      'dispense.result.targets'
    ),
    raw
  }
}

export function encodeReagentInfoDraft(
  draft: ReagentInfoDraft
): Readonly<Record<string, unknown>> {
  return {
    name: draft.name,
    ...(draft.cas === undefined ? {} : { cas: draft.cas }),
    ...optionalField('name_en', draft.nameEn),
    ...(draft.aliases === undefined ? {} : { aliases: [...draft.aliases] }),
    ...optionalField('molecular_formula', draft.molecularFormula),
    ...optionalField('smiles', draft.smiles),
    ...optionalField('inchi_key', draft.inchiKey),
    ...optionalField('molecular_weight', draft.molecularWeight),
    ...optionalField('density_g_per_ml', draft.densityGPerMl),
    ...(draft.physicalState === undefined ? {} : { physical_state: draft.physicalState }),
    ...optionalField('description', draft.description),
    ...(draft.metadata === undefined ? {} : { meta_data: draft.metadata })
  }
}

/** 只发送显式出现的键，让 OS 的 `exclude_unset` 保持未提及字段不变。 */
export function encodeReagentInfoPatch(
  patch: ReagentInfoPatch
): Readonly<Record<string, unknown>> {
  return {
    ...optionalField('name', patch.name),
    ...optionalField('cas', patch.cas),
    ...optionalField('name_en', patch.nameEn),
    ...(patch.aliases === undefined ? {} : { aliases: [...patch.aliases] }),
    ...optionalField('molecular_formula', patch.molecularFormula),
    ...optionalField('smiles', patch.smiles),
    ...optionalField('inchi_key', patch.inchiKey),
    ...optionalField('molecular_weight', patch.molecularWeight),
    ...optionalField('density_g_per_ml', patch.densityGPerMl),
    ...optionalField('physical_state', patch.physicalState),
    ...optionalField('description', patch.description),
    ...(patch.metadata === undefined ? {} : { meta_data: patch.metadata })
  }
}

export function encodeReagentDraft(
  draft: ReagentDraft
): Readonly<Record<string, unknown>> {
  requireExactlyOneIdentity(draft)
  return {
    material_uuid: draft.materialUuid,
    ...(draft.reagentInfoUuid === undefined ? {} : { reagent_info_uuid: draft.reagentInfoUuid }),
    ...(draft.cas === undefined ? {} : { cas: draft.cas }),
    quantity: draft.quantity,
    quantity_unit: draft.quantityUnit,
    ...(draft.physicalState === undefined ? {} : { physical_state: draft.physicalState }),
    ...optionalField('density_g_per_ml', draft.densityGPerMl),
    ...optionalField('concentration_value', draft.concentrationValue),
    ...optionalField('concentration_unit', draft.concentrationUnit),
    ...optionalField('source', draft.source),
    ...optionalField('observed_at', draft.observedAt),
    ...optionalField('description', draft.description),
    ...(draft.metadata === undefined ? {} : { meta_data: draft.metadata }),
    ...encodeCapacityField(draft.containerCapacity),
    ...optionalField('expected_material_revision', draft.expectedMaterialRevision)
  }
}

export function encodeReagentPatch(
  patch: ReagentPatch
): Readonly<Record<string, unknown>> {
  return {
    quantity: patch.quantity,
    quantity_unit: patch.quantityUnit,
    ...optionalField('expected_revision', patch.expectedRevision),
    ...optionalField('concentration_value', patch.concentrationValue),
    ...optionalField('concentration_unit', patch.concentrationUnit),
    ...optionalField('source', patch.source),
    ...optionalField('observed_at', patch.observedAt),
    ...optionalField('description', patch.description),
    ...(patch.metadata === undefined ? {} : { meta_data: patch.metadata }),
    ...encodeCapacityField(patch.containerCapacity),
    ...optionalField('expected_material_revision', patch.expectedMaterialRevision)
  }
}

export function encodeReagentDispenseCommand(
  command: ReagentDispenseCommand
): Readonly<Record<string, unknown>> {
  if (command.targets.length === 0) {
    throw new ReagentInventoryError(
      'INVALID_REAGENT_WRITE_INPUT',
      '分装命令必须至少包含一个目标容器'
    )
  }
  return {
    command_id: command.commandId,
    type: 'reagent.dispense',
    ...(command.actor === undefined ? {} : { actor: command.actor }),
    ...(command.warehouseZoneId === undefined
      ? {}
      : { warehouse_zone_id: command.warehouseZoneId }),
    payload: {
      source_reagent_uuid: command.sourceReagentUuid,
      quantity_unit: command.quantityUnit,
      ...optionalField('expected_revision', command.expectedRevision),
      ...(command.reason === undefined ? {} : { reason: command.reason }),
      targets: command.targets.map((target) => ({
        material_uuid: target.materialUuid,
        quantity: target.quantity,
        ...encodeCapacityField(target.containerCapacity),
        ...optionalField('expected_material_revision', target.expectedMaterialRevision)
      }))
    }
  }
}

function requireExactlyOneIdentity(draft: ReagentDraft): void {
  const hasInfo = optionalString(draft.reagentInfoUuid) !== undefined
  const hasCas = optionalString(draft.cas) !== undefined
  if (hasInfo === hasCas) {
    throw new ReagentInventoryError(
      'INVALID_REAGENT_WRITE_INPUT',
      '登记试剂必须且只能提供 reagentInfoUuid 或 cas 之一'
    )
  }
}

function encodeCapacityField(
  capacity: CapacityInput | undefined
): Readonly<Record<string, unknown>> {
  if (capacity === undefined) return {}
  const hasVolume = capacity.maxVolumeUl !== undefined
  const hasMass = capacity.maxMassG !== undefined
  if (hasVolume === hasMass) {
    throw new ReagentInventoryError(
      'INVALID_REAGENT_WRITE_INPUT',
      '容器装料上限必须且只能提供 maxVolumeUl 或 maxMassG 之一'
    )
  }
  return {
    container_capacity: hasVolume
      ? { max_volume_ul: capacity.maxVolumeUl }
      : { max_mass_g: capacity.maxMassG }
  }
}

function optionalField(
  key: string,
  value: unknown
): Readonly<Record<string, unknown>> {
  return value === undefined ? {} : { [key]: value }
}

function decodeDispenseLine(value: unknown, path: string): ReagentDispenseLine {
  const raw = asRecord(value, path)
  return {
    reagentUuid: requiredString(raw.reagent_uuid, `${path}.reagent_uuid`),
    materialUuid: nullableString(raw.material_uuid, `${path}.material_uuid`),
    quantity: nullableFiniteNumber(raw.quantity, `${path}.quantity`),
    quantityUnit: nullableString(raw.quantity_unit, `${path}.quantity_unit`),
    revision: nullableNonNegativeInteger(raw.revision, `${path}.revision`),
    raw
  }
}

function batchRoot(value: unknown): ReagentBatchResponse {
  return asRecord(unwrapEnvelope(value), 'reagent batch') as ReagentBatchResponse
}

function batchOutcome(root: ReagentBatchResponse): {
  readonly total: number
  readonly created: number
  readonly failed: number
  readonly atomic: boolean
  readonly errors: readonly ReagentBatchRowError[]
  readonly raw: Readonly<Record<string, unknown>>
} {
  return {
    total: nullableNonNegativeInteger(root.total, 'reagent_batch.total') ?? 0,
    created: nullableNonNegativeInteger(root.created, 'reagent_batch.created') ?? 0,
    failed: nullableNonNegativeInteger(root.failed, 'reagent_batch.failed') ?? 0,
    atomic: root.atomic !== false,
    errors: decodeArray(root.errors, decodeBatchRowError, 'reagent_batch.errors'),
    raw: root
  }
}

export function decodeBatchRowError(raw: ReagentInventoryRecord): ReagentBatchRowError {
  return {
    row: nullablePositiveInteger(raw.row, 'reagent_batch.errors.row'),
    errors: decodeArray(
      raw.errors,
      (entry) => ({
        field: optionalString(entry.field) ?? 'row',
        message: requiredString(entry.message, 'reagent_batch.errors.message')
      }),
      'reagent_batch.errors.errors'
    ),
    raw
  }
}

function nullableCapacity(value: unknown, path: string): CapacityLimits | null {
  if (value === null || value === undefined) return null
  const raw = asRecord(value, path)
  const maxVolumeUl = nullableFiniteNumber(raw.max_volume_ul, `${path}.max_volume_ul`)
  const maxMassG = nullableFiniteNumber(raw.max_mass_g, `${path}.max_mass_g`)
  // OS 用空对象表示“这一层没有声明上限”，不能当成上限为 0。
  if (maxVolumeUl === null && maxMassG === null) return null
  return { maxVolumeUl, maxMassG, raw }
}

export function decodeInventoryInstances(value: unknown): readonly InventoryInstance[] {
  const root = asRecord(unwrapEnvelope(value), 'inventory instances') as EdgeInstanceListResponse
  const items = requiredArray(root.instances, 'inventory instances.instances')
  return items.map((item, index) => decodeInventoryInstance(asRecord(item, `inventory.instances[${index}]`)))
}

export function decodeInventoryInstance(value: unknown): InventoryInstance {
  const raw = asRecord(unwrapEnvelope(value), 'inventory instance')
  return decodeInventoryInstanceRecord(raw)
}

export function decodeInventoryLots(value: unknown): readonly InventoryLot[] {
  const root = asRecord(unwrapEnvelope(value), 'inventory lots') as EdgeLotListResponse
  const items = requiredArray(root.lots, 'inventory lots.lots')
  return items.map((item, index) => decodeInventoryLot(asRecord(item, `inventory.lots[${index}]`)))
}

export function decodeInventoryLot(value: unknown): InventoryLot {
  const raw = asRecord(unwrapEnvelope(value), 'inventory lot')
  return decodeInventoryLotRecord(raw)
}

export function decodeInventorySnapshot(value: unknown): InventorySnapshot {
  const root = asRecord(unwrapEnvelope(value), 'inventory snapshot') as EdgeSnapshotResponse
  return {
    kind: 'inventory_snapshot',
    source: 'os',
    snapshotSequence: nullableNonNegativeInteger(root.snapshot_sequence, 'inventory.snapshot_sequence'),
    templates: decodeArray(root.templates, decodeInventoryTemplate, 'inventory.templates'),
    lots: decodeArray(root.lots, decodeInventoryLotRecord, 'inventory.lots'),
    instances: decodeArray(root.instances, decodeInventoryInstanceRecord, 'inventory.instances'),
    relations: decodeArray(root.relations, decodeInventoryRelation, 'inventory.relations'),
    contents: decodeArray(root.contents, decodeInventoryContent, 'inventory.contents'),
    reservations: decodeArray(root.reservations, decodeInventoryReservation, 'inventory.reservations'),
    raw: root
  }
}

function decodeInventoryInstanceRecord(raw: ReagentInventoryRecord): InventoryInstance {
  return {
    instanceUuid: requiredString(raw.edge_uuid ?? raw.uuid, 'inventory.instance.edge_uuid'),
    legacyCloudId: nullableString(raw.legacy_cloud_id, 'inventory.instance.legacy_cloud_id'),
    lotId: nullableString(raw.lot_id, 'inventory.instance.lot_id'),
    templateId: requiredString(raw.template_id, 'inventory.instance.template_id'),
    barcode: nullableString(raw.barcode, 'inventory.instance.barcode'),
    status: requiredString(raw.status, 'inventory.instance.status'),
    version: nullablePositiveInteger(raw.version, 'inventory.instance.version'),
    parentUuid: nullableString(raw.parent_uuid, 'inventory.instance.parent_uuid'),
    ...(raw.relation === undefined ? {} : { relation: raw.relation === null ? null : decodeInventoryRelation(asRecord(raw.relation, 'inventory.instance.relation')) }),
    ...(raw.content === undefined ? {} : { content: raw.content === null ? null : decodeInventoryContent(asRecord(raw.content, 'inventory.instance.content')) }),
    raw
  }
}

function decodeInventoryLotRecord(raw: ReagentInventoryRecord): InventoryLot {
  const total = nullableFiniteNumber(raw.quantity_total, 'inventory.lot.quantity_total')
  const available = nullableFiniteNumber(raw.quantity_available, 'inventory.lot.quantity_available')
  const reserved = nullableFiniteNumber(raw.quantity_reserved, 'inventory.lot.quantity_reserved')
  const quarantined = nullableBooleanFlag(raw.quarantined, 'inventory.lot.quarantined')
  return {
    lotId: requiredString(raw.lot_id, 'inventory.lot.lot_id'),
    templateId: requiredString(raw.template_id, 'inventory.lot.template_id'),
    batchNo: nullableString(raw.batch_no, 'inventory.lot.batch_no'),
    unit: nullableString(raw.unit, 'inventory.lot.unit'),
    totalQuantity: total,
    availableQuantity: available,
    reservedQuantity: reserved,
    expiry: nullableString(raw.expiry, 'inventory.lot.expiry'),
    quarantined,
    warehouseZoneId: nullableString(raw.warehouse_zone_id, 'inventory.lot.warehouse_zone_id'),
    createdAt: nullableFiniteNumber(raw.created_at, 'inventory.lot.created_at'),
    version: nullablePositiveInteger(raw.version, 'inventory.lot.version'),
    status: lotStatus(total, available, reserved, quarantined),
    raw
  }
}

function decodeInventoryTemplate(raw: ReagentInventoryRecord): InventoryTemplate {
  return {
    templateId: requiredString(raw.template_id, 'inventory.template.template_id'),
    name: requiredString(raw.name, 'inventory.template.name'),
    category: requiredString(raw.category, 'inventory.template.category'),
    specJson: nullableString(raw.spec_json, 'inventory.template.spec_json'),
    version: nullablePositiveInteger(raw.version, 'inventory.template.version'),
    raw
  }
}

function decodeInventoryRelation(raw: ReagentInventoryRecord): InventoryRelation {
  return {
    parentUuid: requiredString(raw.parent_uuid, 'inventory.relation.parent_uuid'),
    slotId: nullableString(raw.slot_id, 'inventory.relation.slot_id'),
    childUuid: requiredString(raw.child_uuid, 'inventory.relation.child_uuid'),
    version: nullablePositiveInteger(raw.version, 'inventory.relation.version'),
    raw
  }
}

function decodeInventoryContent(raw: ReagentInventoryRecord): InventoryContent {
  return {
    instanceUuid: requiredString(raw.instance_uuid, 'inventory.content.instance_uuid'),
    stateJson: nullableString(raw.state_json, 'inventory.content.state_json'),
    version: nullablePositiveInteger(raw.version, 'inventory.content.version'),
    raw
  }
}

function decodeInventoryReservation(raw: ReagentInventoryRecord): InventoryReservation {
  return {
    reservationId: requiredString(raw.reservation_id, 'inventory.reservation.reservation_id'),
    workflowId: requiredString(raw.workflow_id, 'inventory.reservation.workflow_id'),
    nodeId: nullableString(raw.node_id, 'inventory.reservation.node_id'),
    attempt: nullableNonNegativeInteger(raw.attempt, 'inventory.reservation.attempt'),
    status: requiredString(raw.status, 'inventory.reservation.status'),
    amountsJson: nullableString(raw.amounts_json, 'inventory.reservation.amounts_json'),
    createdAt: nullableFiniteNumber(raw.created_at, 'inventory.reservation.created_at'),
    version: nullablePositiveInteger(raw.version, 'inventory.reservation.version'),
    raw
  }
}

function listItems(root: ReagentInventoryRecord, path: string): readonly ReagentInventoryRecord[] {
  const items = root.items ?? root.data
  if (!Array.isArray(items)) invalid(`${path}.items must be an array`)
  return items as readonly ReagentInventoryRecord[]
}

function decodeArray<T>(value: unknown, decoder: (raw: ReagentInventoryRecord) => T, path: string): readonly T[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) invalid(`${path} must be an array`)
  return value.map((item, index) => decoder(asRecord(item, `${path}[${index}]`)))
}

function unwrapEnvelope(value: unknown): unknown {
  const root = asOptionalRecord(value)
  if (!root || (!('data' in root) && root.code === undefined && root.error === undefined)) return value
  if (root.code !== undefined && root.code !== 0 && root.code !== '0') {
    const error = asOptionalRecord(root.error)
    throw new ReagentInventoryError(
      'OS_REQUEST_REJECTED',
      optionalString(error?.message ?? error?.msg ?? root.message)
        ?? `OS request rejected with code ${String(root.code)}`,
      {
        osCode: root.code as number | string,
        // 批量导入把逐行错误放在 details 里；丢掉它就无法定位失败的那一行。
        ...(asOptionalRecord(error?.details) === undefined
          ? {}
          : { details: asOptionalRecord(error?.details) })
      }
    )
  }
  return root.data
}

function asRecord(value: unknown, path: string): ReagentInventoryRecord {
  const record = asOptionalRecord(value)
  if (!record) invalid(`${path} must be an object`)
  return record
}

function asOptionalRecord(value: unknown): ReagentInventoryRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as ReagentInventoryRecord
    : undefined
}

function requiredArray(value: unknown, path: string): readonly ReagentInventoryRecord[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`)
  return value as readonly ReagentInventoryRecord[]
}

function optionalRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) return {}
  return asRecord(value, path)
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) invalid(`${path} must be a non-empty string`)
  return result
}

/**
 * OS 用空字符串表示“该字段没有值”，例如 instance 的 `lot_id` 与 3D 结构的
 * `identity_key`。空白一律收敛为 `null`，非字符串类型仍然按非法响应拒绝。
 */
function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return optionalString(value) ?? null
  return requiredString(value, path)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function nullableFiniteNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${path} must be a finite number`)
  return value
}

function nullableNonNegativeInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${path} must be a non-negative safe integer`)
  return value
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(`${path} must be a positive safe integer`)
  return value
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(`${path} must be an array of strings`)
  return value.map((item, index) => {
    const result = optionalString(item)
    if (result === undefined) invalid(`${path}[${index}] must be a non-empty string`)
    return result
  })
}

function nullableBooleanFlag(value: unknown, path: string): boolean | null {
  if (value === null || value === undefined) return null
  if (value === true || value === false) return value
  if (value === 0 || value === 1) return value === 1
  invalid(`${path} must be a boolean or 0/1`)
}

function lotStatus(total: number | null, available: number | null, reserved: number | null, quarantined: boolean | null): string {
  if (quarantined === true) return 'quarantined'
  if (total !== null && total <= 0) return 'empty'
  if (reserved !== null && reserved > 0 && available !== null && available <= 0) return 'reserved'
  if (total !== null || available !== null || reserved !== null) return 'available'
  return 'unknown'
}

function invalid(message: string): never {
  throw new ReagentInventoryError('INVALID_REAGENT_INVENTORY_RESPONSE', message)
}
