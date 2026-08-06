import {
  composePoses,
  IDENTITY_POSE,
  relativePose,
  type LabPose,
  type MaterialAggregate,
  type MaterialAnchor,
  type MaterialId,
  type MaterialPlacement,
  type Vector3Tuple as MaterialVector3Tuple
} from '@unilab/material/domain'
import type { SceneGraph } from '@unilab/pascal-host'

import {
  LabDeviceNodeSchema,
  LabTableNodeSchema,
  isLabDeviceNode,
  isLabTableNode,
  type LabAttachPoint,
  type LabPlacementRef
} from './schema'
import { inferModelFormat } from './modelFormat'
import {
  labLinkPoseToThree,
  labPoseToPascal,
  pascalPoseToLab,
  threePoseToLabLink,
  type Vector3Tuple
} from './units'

const SITE_ID = 'site_unilab'
const BUILDING_ID = 'building_unilab'
const LEVEL_ID = 'level_unilab'

export interface MaterialSceneMove {
  materialId: MaterialId
  placement: MaterialPlacement
}

export interface MaterialSceneProjectionOptions {
  fitSceneRevision?: number
}

export interface MaterialRenderingSnapshot {
  kind: string
  dimensionsMm: MaterialVector3Tuple
  footprintMm: readonly [number, number]
  scale: MaterialVector3Tuple
  model: {
    path: string
    format?: string
    meshDir?: string
    macro?: string
    ossDir?: string
    version?: string
    type?: string
    color?: string
    position: Vector3Tuple
    rotation: Vector3Tuple
    attachPoints: readonly LabAttachPoint[]
    instances?: {
      path: string
      format: 'xacro' | 'urdf' | 'gltf' | 'stl' | 'fbx' | 'obj'
      color?: string
      position: Vector3Tuple
      rotation: Vector3Tuple
      items: readonly {
        id: string
        position: Vector3Tuple
        rotation: Vector3Tuple
      }[]
    }
  }
}

/**
 * Project the authoritative Material aggregates into Pascal-owned view state.
 * `material.config.rendering` is the preferred, instance-scoped rendering
 * snapshot. Direct config fields are accepted only as a migration fallback.
 */
export function materialAggregatesToSceneGraph(
  aggregates: readonly MaterialAggregate[],
  options: MaterialSceneProjectionOptions = {}
): SceneGraph {
  const aggregatesById = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const sceneObjectIdByMaterialId = Object.fromEntries(
    aggregates.map((aggregate) => [
      aggregate.material.id,
      materialSceneObjectId(aggregate)
    ])
  )
  const nodes: Record<string, unknown> = {}
  const labNodeIds: string[] = []
  for (const aggregate of aggregates) {
    const id = sceneObjectIdByMaterialId[aggregate.material.id]
    const rendering = readMaterialRendering(aggregate)
    const projected = projectPlacement(
      aggregate,
      aggregatesById,
      sceneObjectIdByMaterialId
    )
    const worldPose = resolveAggregateWorldPose(
      aggregate.material.id,
      aggregatesById
    )
    const common = {
      id,
      parentId: LEVEL_ID,
      materialNodeId: aggregate.material.id,
      displayName: aggregate.material.name,
      position: projected.position,
      rotation: projected.rotation,
      dimensions: rendering.dimensionsMm.map(
        (value) => Math.max(value / 1000, 0.01)
      ) as Vector3Tuple,
      placementRef: projected.placementRef,
      floorplanSnapshot: {
        kind: rendering.kind,
        worldPositionMm: worldPose.positionMm,
        worldRotationDegXYZ: worldPose.rotationDegXYZ,
        footprintMm: rendering.footprintMm,
        sites: aggregate.sites.map((site) => ({
          id: site.id,
          key: site.key,
          name: site.name,
          kind: site.kind,
          shape: site.shape,
          positionMm: site.poseInAnchor.positionMm,
          sizeMm: site.sizeMm,
          visible: site.visible !== false,
          visualState: site.visual?.state ?? 'empty'
        }))
      }
    }

    if (rendering.kind === 'table') {
      nodes[id] = LabTableNodeSchema.parse({
        ...common,
        type: 'lab-table'
      })
    } else {
      nodes[id] = LabDeviceNodeSchema.parse({
        ...common,
        type: 'lab-device',
        deviceType: rendering.kind || 'custom',
        templateUuid: aggregate.material.sourceTemplateId,
        rosDeviceName: sanitizeRosName(
          stringValue(
            readRecord(aggregate.material.config).rosDeviceName,
            aggregate.material.code || aggregate.material.name
          )
        ),
        scale: rendering.scale,
        model: {
          path: rendering.model.path,
          format: inferModelFormat(
            rendering.model.path,
            rendering.model.format
          ),
          meshDir: rendering.model.meshDir,
          macro: rendering.model.macro,
          ossDir: rendering.model.ossDir,
          version: rendering.model.version,
          type: rendering.model.type,
          color: rendering.model.color,
          position: rendering.model.position,
          rotation: rendering.model.rotation,
          attachPoints: rendering.model.attachPoints,
          instances: rendering.model.instances
        },
        attach: projected.attach
      })
    }
    labNodeIds.push(id)
  }

  nodes[SITE_ID] = {
    id: SITE_ID,
    type: 'site',
    object: 'node',
    name: 'Uni-Lab',
    parentId: null,
    visible: true,
    children: [BUILDING_ID],
    fitSceneRevision: options.fitSceneRevision ?? 0
  }
  nodes[BUILDING_ID] = {
    id: BUILDING_ID,
    type: 'building',
    object: 'node',
    name: '实验室',
    parentId: SITE_ID,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    children: [LEVEL_ID]
  }
  nodes[LEVEL_ID] = {
    id: LEVEL_ID,
    type: 'level',
    object: 'node',
    name: 'Lab floor',
    parentId: BUILDING_ID,
    visible: true,
    level: 0,
    children: labNodeIds
  }

  return {
    nodes,
    rootNodeIds: [SITE_ID],
    installedPlugins: ['unilab.lab']
  }
}

export function sceneGraphToMaterialMoves(
  scene: SceneGraph,
  aggregates: readonly MaterialAggregate[]
): MaterialSceneMove[] {
  const aggregatesById = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const moves: MaterialSceneMove[] = []

  for (const value of Object.values(scene.nodes)) {
    if (!isLabDeviceNode(value) && !isLabTableNode(value)) continue
    const aggregate = aggregatesById[value.materialNodeId]
    if (!aggregate) continue

    const placement = placementFromSceneNode(
      value.position,
      value.rotation,
      aggregate,
      aggregatesById
    )
    if (!samePlacement(placement, aggregate.placement)) {
      moves.push({
        materialId: aggregate.material.id,
        placement
      })
    }
  }

  return moves
}

export function materialSceneObjectId(
  aggregate: MaterialAggregate
): string {
  return readMaterialRendering(aggregate).kind === 'table'
    ? `lab-table-${aggregate.material.id}`
    : `lab-${aggregate.material.id}`
}

export function readMaterialRendering(
  aggregate: MaterialAggregate
): MaterialRenderingSnapshot {
  const config = readRecord(aggregate.material.config)
  const source = recordValue(config.rendering) ?? config
  const model = recordValue(source.model) ?? {}
  const pose = recordValue(source.pose) ?? {}
  const size = recordValue(pose.size) ?? {}
  const kind = stringValue(
    source.kind ?? source.type ?? source.resourceType,
    'custom'
  ).toLowerCase()

  const dimensionsMm =
    vectorTuple(source.dimensionsMm ?? source.sizeMm) ??
    [
      finiteNumber(size.width, kind === 'table' ? 1500 : 600),
      finiteNumber(size.height, kind === 'table' ? 900 : 500),
      finiteNumber(size.depth, kind === 'table' ? 750 : 600)
    ]
  const footprintMm =
    pairTuple(source.footprintMm) ??
    [dimensionsMm[0], dimensionsMm[2]]

  return {
    kind: kind === 'lab-table' || kind === 'workbench' ? 'table' : kind,
    dimensionsMm,
    footprintMm,
    scale: vectorTuple(source.scale) ?? [1, 1, 1],
    model: {
      path: stringValue(model.path ?? model.mesh),
      format: optionalString(model.format ?? model.model_type),
      meshDir: optionalString(model.meshDir ?? model.mesh),
      macro: optionalString(model.macro),
      ossDir: optionalString(model.ossDir ?? model.oss_dir),
      version: optionalString(model.version),
      type: optionalString(model.type),
      color: optionalString(model.color),
      position: vectorTuple(model.position) ?? [0, 0, 0],
      rotation: vectorTuple(model.rotation) ?? [0, 0, 0],
      attachPoints: readAttachPoints(model, aggregate),
      instances: readModelInstances(model, aggregate)
    }
  }
}

function readModelInstances(
  model: Record<string, unknown>,
  aggregate: MaterialAggregate
): MaterialRenderingSnapshot['model']['instances'] {
  const source = recordValue(model.instances)
  if (!source) return undefined
  const path = optionalString(source.path)
  if (!path) return undefined
  const siteKinds = stringArray(source.siteKinds) ?? []
  const visibleStates = stringArray(source.visibleStates) ?? []
  const items = aggregate.sites
    .filter(
      (site) =>
        site.visible !== false &&
        (siteKinds.length === 0 ||
          (site.kind != null && siteKinds.includes(site.kind))) &&
        (visibleStates.length === 0 ||
          (site.visual != null &&
            visibleStates.includes(site.visual.state)))
    )
    .map((site) => {
      const pose = labPoseToPascal(site.poseInAnchor)
      return {
        id: site.id,
        position: pose.position,
        rotation: pose.rotation
      }
    })
  return {
    path,
    format: inferModelFormat(path, optionalString(source.format)),
    color: optionalString(source.color),
    position: vectorTuple(source.position) ?? [0, 0, 0],
    rotation: vectorTuple(source.rotation) ?? [0, 0, 0],
    items
  }
}

function projectPlacement(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  sceneObjectIdByMaterialId: Readonly<Record<MaterialId, string>>
): {
  position: Vector3Tuple
  rotation: Vector3Tuple
  attach: {
    parentDeviceId: string | null
    parentLinkName: string | null
    mountPoint: string | null
  }
  placementRef: LabPlacementRef
} {
  const placement = aggregate.placement
  const base = {
    attach: {
      parentDeviceId: null,
      parentLinkName: null,
      mountPoint: null
    },
    placementRef: placementRef(placement, aggregatesById)
  }

  if (placement.kind === 'unplaced' || placement.kind === 'world') {
    const pose = labPoseToPascal(
      placement.kind === 'world' ? placement.pose : IDENTITY_POSE
    )
    return { ...base, ...pose }
  }

  const parentSceneObjectId =
    sceneObjectIdByMaterialId[placement.parentId] ??
    `lab-${placement.parentId}`
  const anchor =
    placement.kind === 'parent'
      ? placement.anchor
      : findSite(aggregate, aggregatesById)?.anchor ?? { kind: 'root' }
  const localPose =
    placement.kind === 'parent'
      ? placement.localPose
      : composePoses(
          findSite(aggregate, aggregatesById)?.poseInAnchor ?? IDENTITY_POSE,
          placement.offsetPose
        )
  if (
    anchor.kind === 'root' &&
    !requiresLiveParenting(aggregate.material.id, aggregatesById)
  ) {
    return {
      ...base,
      ...labPoseToPascal(
        resolveAggregateWorldPose(aggregate.material.id, aggregatesById)
      )
    }
  }
  const pose =
    anchor.kind === 'link'
      ? labLinkPoseToThree(localPose)
      : labPoseToPascal(localPose)

  return {
    ...base,
    ...pose,
    attach: {
      parentDeviceId: parentSceneObjectId,
      parentLinkName:
        anchor.kind === 'link' ? anchor.linkName : '__root__',
      mountPoint: placement.kind === 'site' ? placement.siteId : null
    }
  }
}

function placementFromSceneNode(
  position: Vector3Tuple,
  rotation: Vector3Tuple,
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): MaterialPlacement {
  const current = aggregate.placement
  if (current.kind === 'unplaced' || current.kind === 'world') {
    return {
      kind: 'world',
      pose: pascalPoseToLab(position, rotation)
    }
  }

  const anchor =
    current.kind === 'parent'
      ? current.anchor
      : findSite(aggregate, aggregatesById)?.anchor ?? { kind: 'root' }
  if (
    anchor.kind === 'root' &&
    !requiresLiveParenting(aggregate.material.id, aggregatesById)
  ) {
    const worldPose = pascalPoseToLab(position, rotation)
    if (current.kind === 'parent') {
      return {
        ...current,
        localPose: relativePose(
          worldPose,
          resolveAggregateWorldPose(current.parentId, aggregatesById)
        )
      }
    }
    const site = findSite(aggregate, aggregatesById)
    const siteWorldPose = composePoses(
      resolveAggregateWorldPose(current.parentId, aggregatesById),
      site?.poseInAnchor ?? IDENTITY_POSE
    )
    return {
      ...current,
      offsetPose: relativePose(worldPose, siteWorldPose)
    }
  }
  const localPose =
    anchor.kind === 'link'
      ? threePoseToLabLink(position, rotation)
      : pascalPoseToLab(position, rotation)

  if (current.kind === 'parent') {
    return {
      ...current,
      localPose
    }
  }

  const site = findSite(aggregate, aggregatesById)
  return {
    ...current,
    offsetPose: site
      ? relativePose(localPose, site.poseInAnchor)
      : localPose
  }
}

function resolveAggregateWorldPose(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  resolved = new Map<MaterialId, LabPose>(),
  visiting = new Set<MaterialId>()
): LabPose {
  const cached = resolved.get(materialId)
  if (cached) return cached
  if (visiting.has(materialId)) return IDENTITY_POSE
  const aggregate = aggregatesById[materialId]
  if (!aggregate) return IDENTITY_POSE
  visiting.add(materialId)
  const placement = aggregate.placement
  let pose: LabPose
  if (placement.kind === 'unplaced') {
    pose = IDENTITY_POSE
  } else if (placement.kind === 'world') {
    pose = placement.pose
  } else if (placement.kind === 'parent') {
    pose = composePoses(
      resolveAggregateWorldPose(
        placement.parentId,
        aggregatesById,
        resolved,
        visiting
      ),
      placement.localPose
    )
  } else {
    const parent = aggregatesById[placement.parentId]
    const site = parent?.sites.find(
      (candidate) => candidate.id === placement.siteId
    )
    pose = composePoses(
      composePoses(
        resolveAggregateWorldPose(
          placement.parentId,
          aggregatesById,
          resolved,
          visiting
        ),
        site?.poseInAnchor ?? IDENTITY_POSE
      ),
      placement.offsetPose
    )
  }
  visiting.delete(materialId)
  resolved.set(materialId, pose)
  return pose
}

/**
 * Link-anchored subtrees stay parented in Three so high-frequency joint
 * updates propagate without rebuilding Material Graph view state. Pure
 * root-anchor chains are flattened to level/world space; this avoids
 * imperative reparenting races between independently rendered Pascal nodes.
 */
function requiresLiveParenting(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  visiting = new Set<MaterialId>()
): boolean {
  if (visiting.has(materialId)) return false
  visiting.add(materialId)
  const aggregate = aggregatesById[materialId]
  const placement = aggregate?.placement
  if (!placement || placement.kind === 'unplaced' || placement.kind === 'world') {
    return false
  }
  const anchor =
    placement.kind === 'parent'
      ? placement.anchor
      : findSite(aggregate, aggregatesById)?.anchor ?? { kind: 'root' }
  return (
    anchor.kind === 'link' ||
    requiresLiveParenting(placement.parentId, aggregatesById, visiting)
  )
}

function placementRef(
  placement: MaterialPlacement,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): LabPlacementRef {
  const parentMaterialId =
    placement.kind === 'parent' || placement.kind === 'site'
      ? placement.parentId
      : null
  const site =
    placement.kind === 'site'
      ? aggregatesById[placement.parentId]?.sites.find(
          (candidate) => candidate.id === placement.siteId
        )
      : undefined
  const anchor: MaterialAnchor =
    placement.kind === 'parent'
      ? placement.anchor
      : site?.anchor ?? { kind: 'root' }

  return {
    kind: placement.kind,
    parentMaterialId,
    siteId: placement.kind === 'site' ? placement.siteId : null,
    anchorKind: anchor.kind,
    anchorLinkName: anchor.kind === 'link' ? anchor.linkName : null
  }
}

function findSite(
  child: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
) {
  const placement = child.placement
  if (placement.kind !== 'site') return undefined
  return aggregatesById[placement.parentId]?.sites.find(
    (site) => site.id === placement.siteId
  )
}

function readAttachPoints(
  model: Record<string, unknown>,
  aggregate: MaterialAggregate
): LabAttachPoint[] {
  const points = new Map<string, LabAttachPoint>()
  const rawPoints = Array.isArray(model.attachPoints)
    ? model.attachPoints
    : Array.isArray(model.attach_points)
      ? model.attach_points
      : []

  for (const value of rawPoints) {
    const point = recordValue(value)
    if (!point) continue
    const link = optionalString(point.link)
    if (!link) continue
    points.set(link, {
      link,
      label: optionalString(point.label),
      row: optionalNumber(point.row),
      col: optionalNumber(point.col),
      acceptTypes: stringArray(point.acceptTypes ?? point.accept_types),
      position: vectorTuple(point.position),
      rotation: vectorTuple(point.rotation)
    })
  }

  for (const site of aggregate.sites) {
    if (site.anchor.kind !== 'link') continue
    points.set(site.anchor.linkName, {
      link: site.anchor.linkName,
      label: site.name,
      acceptTypes: [...site.allowedTemplateIds],
      position: [...site.poseInAnchor.positionMm],
      rotation: [...site.poseInAnchor.rotationDegXYZ]
    })
  }

  return [...points.values()]
}

function samePlacement(
  left: MaterialPlacement,
  right: MaterialPlacement
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'unplaced' && right.kind === 'unplaced') return true
  if (left.kind === 'world' && right.kind === 'world') {
    return samePose(left.pose, right.pose)
  }
  if (left.kind === 'parent' && right.kind === 'parent') {
    return (
      left.parentId === right.parentId &&
      JSON.stringify(left.anchor) === JSON.stringify(right.anchor) &&
      samePose(left.localPose, right.localPose)
    )
  }
  if (left.kind === 'site' && right.kind === 'site') {
    return (
      left.parentId === right.parentId &&
      left.siteId === right.siteId &&
      samePose(left.offsetPose, right.offsetPose)
    )
  }
  return false
}

function samePose(left: LabPose, right: LabPose): boolean {
  return (
    sameTuple(left.positionMm, right.positionMm) &&
    sameTuple(left.rotationDegXYZ, right.rotationDegXYZ)
  )
}

function sameTuple(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.every(
    (value, index) => Math.abs(value - right[index]) < 1e-6
  )
}

function readRecord(value: unknown): Record<string, unknown> {
  return recordValue(value) ?? {}
}

function recordValue(
  value: unknown
): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function vectorTuple(value: unknown): Vector3Tuple | undefined {
  if (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every((item) => Number.isFinite(Number(item)))
  ) {
    return value.slice(0, 3).map(Number) as Vector3Tuple
  }
  const record = recordValue(value)
  if (!record) return undefined
  const tuple = [record.x, record.y, record.z]
  return tuple.every((item) => Number.isFinite(Number(item)))
    ? tuple.map(Number) as Vector3Tuple
    : undefined
}

function pairTuple(value: unknown): readonly [number, number] | undefined {
  return Array.isArray(value) &&
    value.length >= 2 &&
    value.slice(0, 2).every((item) => Number.isFinite(Number(item)))
    ? [Number(value[0]), Number(value[1])]
    : undefined
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringValue(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function optionalString(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value)
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.map(String)
    : undefined
}

function sanitizeRosName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_')
}
