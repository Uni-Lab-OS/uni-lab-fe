import type {
  LabPose,
  MaterialAggregate,
  MaterialId,
  MaterialSite
} from '../types'
import { resolveMaterialWorldPose } from '../react-flow/projection'
import { readMaterial2DVisual } from '../react-flow/visual'
import {
  isDecorativeDeckRail,
  shouldRenderSiteBounds
} from '../sitePresentation'
import {
  resolveShapePrimitives,
  resolveShapeSpec,
  type MaterialShapeLibrary,
  type MaterialShapePrimitive,
  type MaterialShapeSpec
} from './shapeSpec'

export const OBLIQUE_ANGLE_DEG = 45
export const OBLIQUE_DEPTH_SCALE = 0.5

const ANGLE_RAD = (OBLIQUE_ANGLE_DEG * Math.PI) / 180
const DEPTH_X = Math.cos(ANGLE_RAD) * OBLIQUE_DEPTH_SCALE
const DEPTH_Y = Math.sin(ANGLE_RAD) * OBLIQUE_DEPTH_SCALE

export type ObliquePoint = readonly [number, number]
export type ObliqueWorldPoint = readonly [number, number, number]
/**
 * 只有两种画法：外形声明命中就按声明画（`spec`），否则退回实心包围盒
 * （`solid`）。具体长什么样由设备包的 shape manifest 决定。
 */
export type MaterialObliqueRenderStyle = 'solid' | 'spec'
export type MaterialObliqueFidelity =
  | 'declared'
  | 'envelope'
  | 'inferred'

/** 命中的外形声明与它展开出的本地 mm 图元。 */
export interface MaterialObliqueShape {
  id: string
  bundle: string
  primitives: readonly MaterialShapePrimitive[]
  shadow: MaterialShapeSpec['shadow']
}

export interface MaterialObliqueShelf {
  key: string
  heightMm: number
  occupied: boolean
  siteKey?: string
  label?: string
}

/** Slot plane of an open rack: every site sitting on the same shelf board. */
export interface MaterialObliqueLevel {
  key: string
  zMm: number
  sites: readonly MaterialSite[]
}

export interface MaterialObliqueObject {
  materialId: MaterialId
  code: string
  name: string
  kind: string
  physical: boolean
  pose: LabPose
  widthMm: number
  depthMm: number
  heightMm: number
  renderStyle: MaterialObliqueRenderStyle
  fidelity: MaterialObliqueFidelity
  worldCorners: readonly ObliqueWorldPoint[]
  base: readonly ObliquePoint[]
  top: readonly ObliquePoint[]
  topTransform: readonly [number, number, number, number, number, number]
  logicalMount: boolean
  sites: readonly MaterialSite[]
  siteBounds: readonly MaterialSite[]
  shelves: readonly MaterialObliqueShelf[]
  levels: readonly MaterialObliqueLevel[]
  shape?: MaterialObliqueShape
  /** 0 = 地面，1 = 实体设备与物料，2 = 逻辑挂载点覆盖层。 */
  sortLayer: number
  sortDepth: number
}

export interface MaterialObliqueScene {
  objects: readonly MaterialObliqueObject[]
  diagnostics: {
    declaredShapeCount: number
    envelopeApproximationCount: number
    inferredStructureCount: number
    invalidObjectCount: number
  }
  bounds: {
    minX: number
    minY: number
    width: number
    height: number
  }
}

/**
 * Cabinet oblique projection: X/Z front faces retain true scale while the
 * receding floor-plane Y axis runs at 45° with half depth.
 */
export function projectObliquePoint(
  point: ObliqueWorldPoint
): ObliquePoint {
  return [
    point[0] + point[1] * DEPTH_X,
    -point[2] - point[1] * DEPTH_Y
  ]
}

export function buildMaterialObliqueScene(
  aggregates: readonly MaterialAggregate[],
  shapes?: MaterialShapeLibrary
): MaterialObliqueScene {
  const aggregatesById = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const projected = aggregates.map((aggregate) => {
    try {
      return materialToObliqueObject(aggregate, aggregatesById, shapes)
    } catch {
      return undefined
    }
  })
  const objects = projected
    .filter(
      (object): object is MaterialObliqueObject =>
        object !== undefined && isDrawableObject(object)
    )
    .sort(
      (left, right) =>
        left.sortLayer - right.sortLayer ||
        right.sortDepth - left.sortDepth ||
        left.pose.positionMm[2] - right.pose.positionMm[2] ||
        left.materialId.localeCompare(right.materialId)
    )
  const points = objects.flatMap((object) => [
    ...object.base,
    ...object.top
  ])
  if (points.length === 0) {
    return {
      objects,
      diagnostics: sceneDiagnostics(
        objects,
        projected.length - objects.length
      ),
      bounds: { minX: -500, minY: -350, width: 1000, height: 700 }
    }
  }

  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const contentWidth = Math.max(maxX - minX, 120)
  const contentHeight = Math.max(maxY - minY, 120)
  const padding = Math.max(Math.max(contentWidth, contentHeight) * 0.12, 55)

  return {
    objects,
    diagnostics: sceneDiagnostics(
      objects,
      projected.length - objects.length
    ),
    bounds: {
      minX: minX - padding,
      minY: minY - padding,
      width: contentWidth + padding * 2,
      height: contentHeight + padding * 2
    }
  }
}

function materialToObliqueObject(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  shapes: MaterialShapeLibrary | undefined
): MaterialObliqueObject {
  const visual = readMaterial2DVisual(aggregate)
  const pose = resolveMaterialWorldPose(
    aggregate.material.id,
    aggregatesById
  )
  const [widthMm, depthMm] = visual.footprintMm
  const heightMm = visual.heightMm
  const sites = aggregate.sites.filter(
    (site) =>
      site.visible !== false && !isDecorativeDeckRail(aggregate, site)
  )
  const siteBounds = aggregate.sites.filter((site) =>
    shouldRenderSiteBounds(aggregate, site)
  )
  const config = recordValue(aggregate.material.config)
  const logicalMount =
    config.logical_mount === true || config.logicalMount === true
  const declaredLevels = buildSlotLevels(sites)
  const resolved = resolveShape(shapes, visual.kind, declaredLevels, {
    widthMm,
    depthMm,
    heightMm
  })
  const renderStyle: MaterialObliqueRenderStyle = resolved ? 'spec' : 'solid'
  const usesLevels =
    resolved?.primitives.some(
      (primitive) =>
        primitive.kind === 'open-rack' || primitive.kind === 'site-holes'
    ) ?? false
  const usesShelves =
    resolved?.primitives.some(
      (primitive) => primitive.kind === 'stack-shelves'
    ) ?? false
  const levels =
    usesLevels &&
    declaredLevels.length === 0 &&
    resolved?.primitives.some(
      (primitive) => primitive.kind === 'open-rack'
    )
      ? buildInferredRackLevels(heightMm)
      : declaredLevels
  const yawRad = (pose.rotationDegXYZ[2] * Math.PI) / 180
  const cosine = Math.cos(yawRad)
  const sine = Math.sin(yawRad)
  const origin = pose.positionMm
  const localCorners = [
    [0, 0],
    [widthMm, 0],
    [widthMm, depthMm],
    [0, depthMm]
  ] as const
  const worldCorners = localCorners.map(
    ([x, y]): ObliqueWorldPoint => [
      origin[0] + x * cosine - y * sine,
      origin[1] + x * sine + y * cosine,
      origin[2]
    ]
  )
  const base = worldCorners.map(projectObliquePoint)
  const top = worldCorners.map(
    ([x, y, z]) => projectObliquePoint([x, y, z + heightMm])
  )
  const shelves = usesShelves
    ? buildStackShelves(aggregate, heightMm)
    : []
  const inferredStructure = shelves.some((shelf) =>
    shelf.key.startsWith('inferred-shelf-')
  )

  return {
    materialId: aggregate.material.id,
    code: aggregate.material.code,
    name: aggregate.material.name,
    kind: visual.kind,
    physical: visual.physical,
    pose,
    widthMm,
    depthMm,
    heightMm,
    renderStyle,
    fidelity: inferredStructure
      ? 'inferred'
      : resolved
        ? 'declared'
        : 'envelope',
    worldCorners,
    base,
    top,
    topTransform: topPlaneTransform(pose, heightMm),
    logicalMount,
    sites,
    siteBounds,
    shelves,
    levels: usesLevels ? levels : [],
    shape: resolved?.shape,
    // 台面承载所有设备，必须先画，否则它半透明的顶面会盖住工站后半区。
    sortLayer: isGroundKind(visual.kind) ? 0 : logicalMount ? 2 : 1,
    // An open rack is painted before whatever stands inside it, so it sorts on
    // its rear edge instead of its centre.
    sortDepth:
      resolved?.spec.sort === 'rear-edge'
        ? Math.max(...worldCorners.map((point) => point[1]))
        : worldCorners.reduce((total, point) => total + point[1], 0) /
          worldCorners.length
  }
}

function isDrawableObject(object: MaterialObliqueObject): boolean {
  return [
    object.widthMm,
    object.depthMm,
    object.heightMm,
    ...object.pose.positionMm,
    ...object.pose.rotationDegXYZ,
    ...object.base.flat(),
    ...object.top.flat()
  ].every(Number.isFinite)
}

function sceneDiagnostics(
  objects: readonly MaterialObliqueObject[],
  invalidObjectCount: number
): MaterialObliqueScene['diagnostics'] {
  return {
    declaredShapeCount: objects.filter(
      (object) => object.fidelity === 'declared'
    ).length,
    envelopeApproximationCount: objects.filter(
      (object) => object.fidelity === 'envelope'
    ).length,
    inferredStructureCount: objects.filter(
      (object) => object.fidelity === 'inferred'
    ).length,
    invalidObjectCount
  }
}

interface ResolvedShape {
  spec: MaterialShapeSpec
  shape: MaterialObliqueShape
  primitives: readonly MaterialShapePrimitive[]
}

/**
 * 按物料 category 查外形声明。敞口层架只有一层位点时退回实心包围盒——单层的
 * 「层架」画成柜体反而看不清里面站着什么。
 */
function resolveShape(
  shapes: MaterialShapeLibrary | undefined,
  kind: string,
  levels: readonly MaterialObliqueLevel[],
  envelope: { widthMm: number; depthMm: number; heightMm: number }
): ResolvedShape | undefined {
  const spec = resolveShapeSpec(shapes, kind)
  if (!spec) return undefined
  const primitives = resolveShapePrimitives(spec, envelope)
  if (primitives.length === 0) return undefined
  const needsRack = primitives.some(
    (primitive) => primitive.kind === 'open-rack'
  )
  if (needsRack && levels.length === 1) return undefined

  return {
    spec,
    primitives,
    shape: {
      id: spec.id,
      bundle: spec.bundle,
      primitives,
      shadow: spec.shadow
    }
  }
}

function isGroundKind(kind: string): boolean {
  const normalized = kind.replaceAll('_', '-').toLowerCase()
  return normalized.includes('deck') || normalized.includes('bench')
}

function recordValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Sites are grouped per shelf board by their local Z, lowest board first. */
function buildSlotLevels(
  sites: readonly MaterialSite[]
): MaterialObliqueLevel[] {
  const groups = new Map<number, MaterialSite[]>()
  for (const site of sites) {
    const zMm = Math.round(site.poseInAnchor.positionMm[2])
    const group = groups.get(zMm)
    if (group) {
      group.push(site)
      continue
    }
    groups.set(zMm, [site])
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([zMm, levelSites]) => ({
      key: `level-${zMm}`,
      zMm,
      sites: levelSites
    }))
}

/**
 * Package shape 已声明为 open-rack、但 Backend 尚无权威 Site 时，只补空层板
 * 作为视觉结构；不会制造 Site identity、容量或占用状态。
 */
function buildInferredRackLevels(
  heightMm: number
): MaterialObliqueLevel[] {
  const count = Math.round(clamp(heightMm / 180, 2, 4))
  const lower = heightMm * 0.12
  const upper = heightMm * 0.82
  const step = count > 1 ? (upper - lower) / (count - 1) : 0
  return Array.from({ length: count }, (_, index) => ({
    key: `inferred-level-${index + 1}`,
    zMm: lower + step * index,
    sites: []
  }))
}

function buildStackShelves(
  aggregate: MaterialAggregate,
  heightMm: number
): MaterialObliqueShelf[] {
  const siteShelves = aggregate.sites
    .filter(
      (site) =>
        site.visible !== false &&
        site.kind !== 'well' &&
        site.kind !== 'tip-spot'
    )
    .map((site) => ({
      key: site.id,
      heightMm: clamp(
        site.poseInAnchor.positionMm[2],
        heightMm * 0.06,
        heightMm * 0.94
      ),
      occupied:
        site.occupiedMaterialIds.length > 0 ||
        site.visual?.state === 'occupied' ||
        site.visual?.state === 'filled' ||
        site.visual?.state === 'tip-present',
      siteKey: site.key,
      label: site.key || site.name
    }))
    .sort((left, right) => left.heightMm - right.heightMm)
  if (siteShelves.length > 0) return siteShelves

  // Some edge models currently expose only the stack's physical envelope.
  // In that case shelves are an unoccupied visual scale inferred from height;
  // no material occupancy is invented.
  const count = Math.round(clamp(heightMm / 65, 4, 12))
  const lower = heightMm * 0.1
  const upper = heightMm * 0.9
  const step = count > 1 ? (upper - lower) / (count - 1) : 0
  return Array.from({ length: count }, (_, index) => ({
    key: `inferred-shelf-${index + 1}`,
    heightMm: lower + step * index,
    occupied: false
  }))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function topPlaneTransform(
  pose: LabPose,
  heightMm: number
): readonly [number, number, number, number, number, number] {
  const yawRad = (pose.rotationDegXYZ[2] * Math.PI) / 180
  const cosine = Math.cos(yawRad)
  const sine = Math.sin(yawRad)
  const [x, y, z] = pose.positionMm

  return [
    cosine + sine * DEPTH_X,
    -sine * DEPTH_Y,
    -sine + cosine * DEPTH_X,
    -cosine * DEPTH_Y,
    x + y * DEPTH_X,
    -(z + heightMm) - y * DEPTH_Y
  ]
}
