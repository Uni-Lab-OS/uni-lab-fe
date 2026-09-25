import { ReagentInventoryError } from './errors'
import type {
  EdgeInstanceListResponse,
  EdgeLotListResponse,
  EdgeSnapshotResponse,
  ReagentInfoListResponse,
  ReagentInventoryRecord,
  ReagentListResponse
} from './api'
import type {
  InventoryContent,
  InventoryInstance,
  InventoryLot,
  InventoryRelation,
  InventoryReservation,
  InventorySnapshot,
  InventoryTemplate,
  Reagent,
  ReagentInfo,
  ReagentInfoPage,
  ReagentPage
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
        ?? `OS request rejected with code ${String(root.code)}`
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

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null
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
