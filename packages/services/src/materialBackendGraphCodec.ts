import type {
  LabPose,
  MaterialAggregate,
  MaterialPlacement,
  MaterialSite
} from '@unilab/material'

import {
  invalidGraph,
  isRecord,
  optionalString,
  recordValue,
  requiredString,
  siteKind,
  stringArray
} from './materialCodecPrimitives'

export function mapBackendMaterialGraph(
  raw: Record<string, unknown>
): MaterialAggregate[] {
  if (!Array.isArray(raw.nodes) || raw.nodes.some((node) => !isRecord(node))) {
    throw invalidGraph('nodes must be an object array')
  }

  const nodes = raw.nodes as Record<string, unknown>[]
  const siteById = new Map<
    string,
    { ownerMaterialId: string; site: MaterialSite }
  >()
  for (const node of nodes) {
    if (!Array.isArray(node.sites)) {
      throw invalidGraph('node.sites must be an array')
    }
    for (const rawSite of node.sites) {
      const site = mapBackendSite(rawSite)
      if (siteById.has(site.id)) {
        throw invalidGraph(`Duplicate Site uuid: ${site.id}`)
      }
      siteById.set(site.id, {
        ownerMaterialId: site.ownerMaterialId,
        site
      })
    }
  }

  const parentConfigById = new Map<string, unknown>()
  for (const node of nodes) {
    const material = recordValue(node.material)
    parentConfigById.set(
      requiredString(material.uuid, 'material.uuid'),
      material.config
    )
  }

  return nodes.map((node) => {
    const material = recordValue(node.material)
    const id = requiredString(material.uuid, 'material.uuid')
    const updateTime = requiredString(
      material.update_time,
      'material.update_time'
    )
    const position = optionalRecord(node.relative_position)
    if (
      position &&
      requiredString(position.material_uuid, 'relative_position.material_uuid') !== id
    ) {
      throw invalidGraph(
        `RelativePosition owner does not match Material ${id}`
      )
    }
    const sites = (node.sites as unknown[]).map(mapBackendSite)
    for (const site of sites) {
      if (site.ownerMaterialId !== id) {
        throw invalidGraph(
          `Site ${site.id} owner ${site.ownerMaterialId} does not match ${id}`
        )
      }
    }

    const config = mapBackendMaterialConfig(
      material.config,
      position,
      material.meta_data
    )
    return {
      material: {
        id,
        sourceTemplateId: requiredString(
          material.resource_template_uuid,
          'material.resource_template_uuid'
        ),
        code: optionalString(material.barcode) ?? '',
        name: requiredString(material.name, 'material.name'),
        description: optionalString(material.description),
        config,
        createdAt: requiredString(
          material.create_time,
          'material.create_time'
        ),
        updatedAt: updateTime
      },
      placement: mapBackendPlacement(
        material,
        position,
        node.current_site_uuid,
        siteById,
        parentConfigById
      ),
      sites,
      // Backend baseline deliberately does not expose Inventory.version. This
      // adapter-local token only drives the read-only FE store.
      revision: adapterRevision(updateTime)
    }
  })
}

/**
 * 把 OS 物料（Material）配置规范化为三个视图共享的实例渲染快照。
 * @param value OS 返回的物料配置。
 * @param position 权威相对位置及物理外包尺寸；缺失时不编造尺寸。
 * @param metaData 仅用于保留资源图来源身份的物料元数据。
 * @returns 保留业务配置并补齐 `rendering.kind` 与毫米尺寸的前端配置。
 */
function mapBackendMaterialConfig(
  value: unknown,
  position: Record<string, unknown> | undefined,
  metaData: unknown
): Record<string, unknown> {
  const config = recordValue(value)
  const sourceIdentity = optionalString(
    recordValue(metaData).source_node_id
  )
  const identifiedConfig = {
    ...config,
    ...(sourceIdentity ? { sourceIdentity } : {})
  }
  const rawRendering = isRecord(config.rendering)
    ? config.rendering
    : {}
  if (!position) return identifiedConfig
  return {
    ...identifiedConfig,
    rendering: {
      ...rawRendering,
      kind:
        optionalString(rawRendering.kind) ??
        optionalString(rawRendering.type) ??
        optionalString(config.category) ??
        optionalString(config.type) ??
        'custom',
      dimensionsMm: [
        finiteGraphNumber(position.width, 'relative_position.width'),
        finiteGraphNumber(position.depth, 'relative_position.depth'),
        finiteGraphNumber(position.length, 'relative_position.length')
      ]
    }
  }
}

function mapBackendPlacement(
  material: Record<string, unknown>,
  position: Record<string, unknown> | undefined,
  currentSiteUuid: unknown,
  siteById: ReadonlyMap<
    string,
    { ownerMaterialId: string; site: MaterialSite }
  >,
  parentConfigById: ReadonlyMap<string, unknown>
): MaterialPlacement {
  const siteId = optionalString(currentSiteUuid)
  if (siteId) {
    const entry = siteById.get(siteId)
    if (!entry) {
      throw invalidGraph(`current_site_uuid does not resolve: ${siteId}`)
    }
    return {
      kind: 'site',
      parentId: entry.ownerMaterialId,
      siteId,
      offsetPose: zeroPose()
    }
  }
  if (!position) return { kind: 'unplaced' }

  const pose = mapBackendPose(position, 'relative_position')
  const parentId = optionalString(material.parent_uuid)
  const mountLink = parentMountLink(parentConfigById.get(parentId ?? ''))
  return parentId
    ? {
        kind: 'parent',
        parentId,
        anchor: mountLink
          ? { kind: 'link', linkName: mountLink }
          : { kind: 'root' },
        localPose: pose
      }
    : { kind: 'world', pose }
}

function parentMountLink(config: unknown): string | undefined {
  if (!isRecord(config) || !isRecord(config.rendering)) return undefined
  if (!isRecord(config.rendering.kinematics)) return undefined
  const mountLink = optionalString(config.rendering.kinematics.mount_link)
  return mountLink?.trim() || undefined
}

function mapBackendSite(value: unknown): MaterialSite {
  const raw = recordValue(value)
  const metaData = isRecord(raw.meta_data) ? raw.meta_data : {}
  const occupiedMaterialId = optionalString(raw.occupied_material_uuid)
  const kind = siteKind(metaData.kind) ?? 'site'
  return {
    id: requiredString(raw.uuid, 'site.uuid'),
    ownerMaterialId: requiredString(
      raw.material_uuid,
      'site.material_uuid'
    ),
    key:
      optionalString(metaData.key) ??
      requiredString(raw.name, 'site.name'),
    name: requiredString(raw.name, 'site.name'),
    sortOrder: finiteGraphNumber(raw.sort_order, 'site.sort_order'),
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [
        finiteGraphNumber(raw.position_x, 'site.position_x'),
        finiteGraphNumber(raw.position_y, 'site.position_y'),
        finiteGraphNumber(raw.position_z, 'site.position_z')
      ],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [
      finiteGraphNumber(raw.width, 'site.width'),
      finiteGraphNumber(raw.length, 'site.length'),
      finiteGraphNumber(raw.depth, 'site.depth')
    ],
    capacity: 1,
    allowedTemplateIds: stringArray(
      raw.allowed_resource_template_uuids
    ),
    occupiedMaterialIds: occupiedMaterialId
      ? [occupiedMaterialId]
      : [],
    kind,
    shape:
      metaData.shape === 'circle' || metaData.shape === 'rectangle'
        ? metaData.shape
        : kind === 'well' || kind === 'tip-spot'
          ? 'circle'
          : 'rectangle',
    visible: metaData.visible == null ? true : Boolean(metaData.visible),
    visual: {
      state: occupiedMaterialId ? 'occupied' : 'empty',
      fillFraction: occupiedMaterialId ? 1 : 0
    }
  }
}

function mapBackendPose(
  raw: Record<string, unknown>,
  field: string
): LabPose {
  return {
    positionMm: [
      finiteGraphNumber(raw.position_x, `${field}.position_x`),
      finiteGraphNumber(raw.position_y, `${field}.position_y`),
      finiteGraphNumber(raw.position_z, `${field}.position_z`)
    ],
    rotationDegXYZ: [
      finiteGraphNumber(raw.rotation_x, `${field}.rotation_x`),
      finiteGraphNumber(raw.rotation_y, `${field}.rotation_y`),
      finiteGraphNumber(raw.rotation_z, `${field}.rotation_z`)
    ]
  }
}

function zeroPose(): LabPose {
  return {
    positionMm: [0, 0, 0],
    rotationDegXYZ: [0, 0, 0]
  }
}

function adapterRevision(updateTime: string): number {
  const parsed = Date.parse(updateTime)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  let hash = 2166136261
  for (const character of updateTime) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return Math.max(1, hash >>> 0)
}

function optionalRecord(
  value: unknown
): Record<string, unknown> | undefined {
  if (value == null) return undefined
  return recordValue(value)
}

function finiteGraphNumber(value: unknown, field: string): number {
  const result = Number(value)
  if (!Number.isFinite(result)) {
    throw invalidGraph(`${field} must be finite`)
  }
  return result
}
