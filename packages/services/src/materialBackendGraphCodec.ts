import type {
  LabPose,
  MaterialAggregate,
  MaterialPlacement,
  MaterialShapeIdentity,
  MaterialSite
} from '@unilab/material'

import {
  invalidGraph,
  isRecord,
  optionalString,
  parseTuple,
  recordValue,
  requiredString,
  siteKind,
  stringArray
} from './materialCodecPrimitives'

/**
 * 把 Backend/OS 公共物料图解码为共享物料聚合。
 *
 * @param raw 未信任的公共物料图响应主体。
 * @returns 已校验身份、库位占用、展示投影和修订号的物料聚合。
 */
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

  return nodes.map((node) => {
    const material = recordValue(node.material)
    const id = requiredString(material.uuid, 'material.uuid')
    const sourceTemplateId = requiredString(
      material.resource_template_uuid,
      'material.resource_template_uuid'
    )
    const materialType = requiredString(material.type, 'material.type')
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
      materialType,
      position,
      material.meta_data,
      mapBackendResourceTemplateDisplay(
        node.resource_template,
        sourceTemplateId
      )
    )
    const shapeIdentity = mapBackendShapeIdentity(position)
    return {
      material: {
        id,
        sourceTemplateId,
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
        siteById
      ),
      sites,
      revision: materialRevision(material.revision),
      ...(shapeIdentity ? { shapeIdentity } : {})
    }
  })
}

/**
 * 读取 Backend 冻结在物料相对位置上的公共 2.5D 外形身份。
 *
 * @param position 可空的权威相对位置；旧数据可以没有 shape。
 * @returns 同时具有 bundle 与 id 时返回精确身份，否则返回 undefined 并允许视图降级。
 */
function mapBackendShapeIdentity(
  position: Record<string, unknown> | undefined
): MaterialShapeIdentity | undefined {
  if (!position || !isRecord(position.shape)) return undefined
  // shapeBundle/shapeId 共同构成 Backend `/material-shapes` 的稳定去重键。
  const shapeBundle = optionalString(position.shape.bundle)?.trim()
  const shapeId = optionalString(position.shape.id)?.trim()
  if (!shapeBundle || !shapeId) return undefined
  return { bundle: shapeBundle, id: shapeId }
}

/**
 * 把 OS 物料（Material）配置规范化为三个视图共享的实例渲染快照。
 * @param value OS 返回的物料配置。
 * @param materialType OS 返回的物料实例类型，仅为台面补齐稳定渲染语义。
 * @param position 权威相对位置及物理外包尺寸；缺失时不编造尺寸。
 * @param metaData 仅用于保留资源图来源身份的物料元数据。
 * @param resourceTemplate 后端（Backend）资源模板展示摘要的规范化投影。
 * @returns 保留业务配置并补齐 `rendering.kind` 与毫米尺寸的前端配置。
 */
function mapBackendMaterialConfig(
  value: unknown,
  materialType: string,
  position: Record<string, unknown> | undefined,
  metaData: unknown,
  resourceTemplate: Record<string, unknown> | undefined
): Record<string, unknown> {
  const config = recordValue(value)
  const sourceIdentity = optionalString(
    recordValue(metaData).source_node_id
  )
  const identifiedConfig = {
    ...config,
    ...(sourceIdentity ? { sourceIdentity } : {}),
    ...(resourceTemplate ? { resourceTemplate } : {})
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
        (materialType === 'deck' ? 'deck' : 'custom'),
      dimensionsMm: [
        finiteGraphNumber(position.width, 'relative_position.width'),
        finiteGraphNumber(position.depth, 'relative_position.depth'),
        finiteGraphNumber(position.length, 'relative_position.length')
      ]
    }
  }
}

/**
 * 校验物料图节点携带的资源模板展示摘要。
 *
 * @param value 展示摘要 wire 值。
 * @param expectedUuid 物料实例引用的资源模板稳定 UUID。
 * @returns 使用前端命名的展示对象。
 */
function mapBackendResourceTemplateDisplay(
  value: unknown,
  expectedUuid: string
): Record<string, unknown> {
  const raw = recordValue(value)
  const uuid = requiredString(raw.uuid, 'resource_template.uuid')
  if (uuid !== expectedUuid) {
    throw invalidGraph(
      'resource_template.uuid does not match material.resource_template_uuid'
    )
  }
  const icon = optionalString(raw.icon)
  return {
    uuid,
    name: requiredString(raw.name, 'resource_template.name'),
    displayName: requiredString(
      raw.display_name,
      'resource_template.display_name'
    ),
    resourceType: requiredString(
      raw.resource_type,
      'resource_template.resource_type'
    ),
    ...(icon ? { icon } : {})
  }
}

function mapBackendPlacement(
  material: Record<string, unknown>,
  position: Record<string, unknown> | undefined,
  currentSiteUuid: unknown,
  siteById: ReadonlyMap<
    string,
    { ownerMaterialId: string; site: MaterialSite }
  >
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
  return parentId
    ? {
        kind: 'parent',
        parentId,
        anchor: { kind: 'root' },
        localPose: pose
      }
    : { kind: 'world', pose }
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
      rotationDegXYZ: metaData.rotation_deg_xyz == null
        ? [0, 0, 0]
        : parseTuple(
            metaData.rotation_deg_xyz,
            'site.meta_data.rotation_deg_xyz'
          )
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

/**
 * 读取物料（Material）权威修订号。
 *
 * @param value 公共图中的 material.revision。
 * @returns 正安全整数修订号。
 */
function materialRevision(
  value: unknown
): number {
  if (Number.isSafeInteger(value) && (value as number) > 0) {
    return value as number
  }
  throw invalidGraph('material.revision must be a positive safe integer')
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
