import { MaterialSiteError } from './errors'
import type {
  MaterialDetailResponse,
  MaterialGraphResponse,
  MaterialListResponse,
  MaterialSiteRecord,
} from './api'
import type {
  MaterialDetail,
  MaterialGraph,
  MaterialGraphNode,
  MaterialListPage,
  MaterialRelativePosition,
  MaterialResourceTemplateSummary,
  MaterialSummary,
  SiteSummary,
  Vector3,
} from './model'

export function decodeMaterialList(value: unknown): MaterialListPage {
  const payload = unwrapEnvelope(value)
  const root = asRecord(payload, 'material list') as MaterialListResponse
  const items = Array.isArray(root.items) ? root.items : Array.isArray(root.data) ? root.data : []
  return {
    items: items.map((item, index) =>
      decodeMaterialSummary(asRecord(item, `materials.items[${index}]`)),
    ),
    total: nullableInteger(root.total, 'materials.total'),
    page: nullablePositiveInteger(root.page, 'materials.page'),
    pageSize: nullablePositiveInteger(root.page_size, 'materials.page_size'),
    raw: root,
  }
}

export function decodeMaterialGraph(value: unknown): MaterialGraph {
  const payload = unwrapEnvelope(value)
  const root = asRecord(payload, 'material graph') as MaterialGraphResponse
  if (!Array.isArray(root.nodes)) invalid('material graph.nodes must be an array')

  const materialIds = new Set<string>()
  const sites = new Map<string, SiteSummary>()
  const nodes = root.nodes.map((item, index) => {
    const node = asRecord(item, `material graph.nodes[${index}]`)
    const material = decodeMaterialSummary(
      asRecord(node.material, `material graph.nodes[${index}].material`),
    )
    if (materialIds.has(material.materialUuid)) {
      invalid(`duplicate material uuid: ${material.materialUuid}`)
    }
    materialIds.add(material.materialUuid)
    const siteValues = node.sites
    if (!Array.isArray(siteValues)) {
      invalid(`material graph.nodes[${index}].sites must be an array`)
    }
    const nodeSites = siteValues.map((site, siteIndex) => {
      const decoded = decodeSite(
        asRecord(site, `material graph.nodes[${index}].sites[${siteIndex}]`),
      )
      if (decoded.ownerMaterialUuid !== material.materialUuid) {
        invalid(`site ${decoded.siteUuid} owner does not match material ${material.materialUuid}`)
      }
      if (sites.has(decoded.siteUuid)) invalid(`duplicate site uuid: ${decoded.siteUuid}`)
      sites.set(decoded.siteUuid, decoded)
      return decoded
    })
    const relativePosition = decodeRelativePosition(node.relative_position)
    if (
      relativePosition &&
      relativePosition.raw.material_uuid !== undefined &&
      relativePosition.raw.material_uuid !== material.materialUuid
    ) {
      invalid(`relative_position owner does not match material ${material.materialUuid}`)
    }
    return {
      material,
      resourceTemplate: decodeResourceTemplate(
        node.resource_template,
        material.resourceTemplateUuid,
      ),
      relativePosition,
      sites: nodeSites,
      currentSiteUuid: nullableString(node.current_site_uuid, 'current_site_uuid'),
      raw: node,
    } satisfies MaterialGraphNode
  })

  for (const node of nodes) {
    if (node.currentSiteUuid !== null && !sites.has(node.currentSiteUuid)) {
      invalid(`current_site_uuid does not resolve: ${node.currentSiteUuid}`)
    }
  }

  return {
    kind: 'material_graph',
    source: 'os',
    nodes,
    raw: root,
  }
}

export function decodeMaterialDetail(value: unknown): MaterialDetail {
  const payload = unwrapEnvelope(value)
  const root = asRecord(payload, 'material detail') as MaterialDetailResponse
  const material = decodeMaterialSummary(root)
  const sites =
    root.sites === undefined
      ? []
      : decodeSiteList(root.sites, 'material.sites', material.materialUuid)
  const currentSite =
    root.current_site === null || root.current_site === undefined
      ? null
      : decodeSite(asRecord(root.current_site, 'material.current_site'))
  return {
    ...material,
    kind: 'material_detail',
    relativePosition: decodeRelativePosition(root.relative_position),
    sites,
    currentSite,
  }
}

export function decodeSiteList(
  value: unknown,
  path = 'sites',
  expectedOwnerMaterialUuid?: string,
): readonly SiteSummary[] {
  const payload = unwrapEnvelope(value)
  const root = asOptionalRecord(payload)
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.sites)
        ? root.sites
        : Array.isArray(root?.data)
          ? root.data
          : []
  return items.map((item, index) => {
    const site = decodeSite(asRecord(item, `${path}[${index}]`))
    if (
      expectedOwnerMaterialUuid !== undefined &&
      site.ownerMaterialUuid !== expectedOwnerMaterialUuid
    ) {
      invalid(`site ${site.siteUuid} owner does not match material ${expectedOwnerMaterialUuid}`)
    }
    return site
  })
}

export function decodeSiteDetail(value: unknown): SiteSummary {
  const payload = unwrapEnvelope(value)
  return decodeSite(asRecord(payload, 'site'))
}

function decodeMaterialSummary(value: MaterialSiteRecord): MaterialSummary {
  return {
    kind: 'material_summary',
    source: 'os',
    materialUuid: requiredString(value.uuid, 'material.uuid'),
    resourceTemplateUuid: requiredString(
      value.resource_template_uuid,
      'material.resource_template_uuid',
    ),
    materialType: nullableString(value.type, 'material.type'),
    className: nullableString(value.class, 'material.class'),
    parentMaterialUuid: nullableString(value.parent_uuid, 'material.parent_uuid'),
    barcode: nullableString(value.barcode, 'material.barcode'),
    name: requiredString(value.name, 'material.name'),
    description: nullableString(value.description, 'material.description'),
    revision: nullablePositiveInteger(value.revision, 'material.revision'),
    config: optionalRecord(value.config, 'material.config'),
    metadata: optionalRecord(value.meta_data, 'material.meta_data'),
    createdAt: nullableString(value.create_time, 'material.create_time'),
    updatedAt: nullableString(value.update_time, 'material.update_time'),
    raw: value,
  }
}

function decodeSite(value: MaterialSiteRecord): SiteSummary {
  const metadata = optionalRecord(value.meta_data, 'site.meta_data')
  const occupiedField = Object.prototype.hasOwnProperty.call(value, 'occupied_material_uuid')
  return {
    kind: 'site',
    source: 'os',
    siteUuid: requiredString(value.uuid, 'site.uuid'),
    ownerMaterialUuid: requiredString(value.material_uuid, 'site.material_uuid'),
    key: optionalString(metadata.key) ?? requiredString(value.name, 'site.name'),
    name: requiredString(value.name, 'site.name'),
    sortOrder: nullableNumber(value.sort_order, 'site.sort_order'),
    allowedResourceTemplateUuids:
      value.allowed_resource_template_uuids === undefined
        ? null
        : stringArray(
            value.allowed_resource_template_uuids,
            'site.allowed_resource_template_uuids',
          ),
    occupancy: {
      known: occupiedField,
      occupiedMaterialUuid: nullableString(
        value.occupied_material_uuid,
        'site.occupied_material_uuid',
      ),
    },
    geometry: decodeSiteGeometry(value),
    metadata,
    raw: value,
  }
}

function decodeSiteGeometry(value: MaterialSiteRecord): SiteSummary['geometry'] {
  const hasGeometry = [
    'position_x',
    'position_y',
    'position_z',
    'width',
    'length',
    'depth',
    'rotation_x',
    'rotation_y',
    'rotation_z',
  ].some((key) => value[key] !== undefined && value[key] !== null)
  if (!hasGeometry) return null
  return {
    positionMm: requiredVector(value, ['position_x', 'position_y', 'position_z'], 'site.position'),
    sizeMm: optionalVector(value, ['width', 'depth', 'length'], 'site.size'),
    rotationDegXYZ: optionalVector(
      value,
      ['rotation_x', 'rotation_y', 'rotation_z'],
      'site.rotation',
    ),
  }
}

function decodeRelativePosition(value: unknown): MaterialRelativePosition | null {
  if (value === null || value === undefined) return null
  const raw = asRecord(value, 'material.relative_position')
  return {
    positionMm: requiredVector(
      raw,
      ['position_x', 'position_y', 'position_z'],
      'relative_position.position',
    ),
    sizeMm: optionalVector(raw, ['width', 'depth', 'length'], 'relative_position.size'),
    scale: optionalVector(raw, ['scale_x', 'scale_y', 'scale_z'], 'relative_position.scale'),
    rotationDegXYZ: optionalVector(
      raw,
      ['rotation_x', 'rotation_y', 'rotation_z'],
      'relative_position.rotation',
    ),
    raw,
  }
}

function decodeResourceTemplate(
  value: unknown,
  expectedUuid: string,
): MaterialResourceTemplateSummary | null {
  if (value === null || value === undefined) return null
  const raw = asRecord(value, 'resource_template')
  const uuid = requiredString(raw.uuid, 'resource_template.uuid')
  if (uuid !== expectedUuid) {
    invalid('resource_template.uuid does not match material.resource_template_uuid')
  }
  return {
    uuid,
    name: requiredString(raw.name, 'resource_template.name'),
    displayName: requiredString(raw.display_name, 'resource_template.display_name'),
    resourceType: requiredString(raw.resource_type, 'resource_template.resource_type'),
    ...(optionalString(raw.icon) === undefined ? {} : { icon: optionalString(raw.icon) }),
    raw,
  }
}

function unwrapEnvelope(value: unknown): unknown {
  const record = asOptionalRecord(value)
  if (!record || (!('data' in record) && record.code === undefined && record.error === undefined)) {
    return value
  }
  if (record.code !== undefined && record.code !== 0 && record.code !== '0') {
    const error = asOptionalRecord(record.error)
    throw new MaterialSiteError(
      'OS_REQUEST_REJECTED',
      optionalString(error?.message ?? error?.msg ?? record.message) ??
        `OS request rejected with code ${String(record.code)}`,
    )
  }
  return record.data
}

function asRecord(value: unknown, path: string): MaterialSiteRecord {
  const record = asOptionalRecord(value)
  if (!record) invalid(`${path} must be an object`)
  return record
}

function asOptionalRecord(value: unknown): MaterialSiteRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as MaterialSiteRecord)
    : undefined
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

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value))
    invalid(`${path} must be a finite number`)
  return value
}

function nullableInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${path} must be a non-negative safe integer`)
  }
  return value
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${path} must be a positive safe integer`)
  }
  return value
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid(`${path} must be an array of strings`)
  }
  return value
}

function requiredVector(
  value: MaterialSiteRecord,
  keys: readonly [string, string, string],
  path: string,
): Vector3 {
  const vector = optionalVector(value, keys, path)
  if (!vector) invalid(`${path} must contain three finite numbers`)
  return vector
}

function optionalVector(
  value: MaterialSiteRecord,
  keys: readonly [string, string, string],
  path: string,
): Vector3 | null {
  const values = keys.map((key) => value[key])
  if (values.every((item) => item === undefined || item === null)) return null
  if (values.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    invalid(`${path} must contain three finite numbers`)
  }
  return [values[0] as number, values[1] as number, values[2] as number]
}

function invalid(message: string): never {
  throw new MaterialSiteError('INVALID_MATERIAL_RESPONSE', message)
}
