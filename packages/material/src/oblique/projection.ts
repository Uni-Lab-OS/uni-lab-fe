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
import type { MaterialShapeLibrary } from './shapeSpec'
import { resolveMaterialObliqueShape } from './shapeResolution'

export const OBLIQUE_ANGLE_DEG = 45
export const OBLIQUE_DEPTH_SCALE = 0.5

const ANGLE_RAD = (OBLIQUE_ANGLE_DEG * Math.PI) / 180
const DEPTH_X = Math.cos(ANGLE_RAD) * OBLIQUE_DEPTH_SCALE
const DEPTH_Y = Math.sin(ANGLE_RAD) * OBLIQUE_DEPTH_SCALE


import type {
  MaterialObliqueLevel,
  MaterialObliqueObject,
  MaterialObliqueRenderStyle,
  MaterialObliqueScene,
  MaterialObliqueShape,
  MaterialObliqueShelf,
  ObliquePoint,
  ObliqueWorldPoint
} from './projectionTypes'

export type {
  MaterialObliqueFidelity,
  MaterialObliqueLevel,
  MaterialObliqueObject,
  MaterialObliqueRenderStyle,
  MaterialObliqueScene,
  MaterialObliqueShape,
  MaterialObliqueShelf,
  ObliquePoint,
  ObliqueWorldPoint
} from './projectionTypes'

/**
 * 将世界坐标投影到可旋转的 2.5D 斜投影视图。
 * @param point 世界坐标点，单位为毫米。
 * @param viewRotationDeg 视角绕世界 Z 轴旋转的角度，单位为度。
 * @returns SVG 使用的二维投影坐标。
 */
export function projectObliquePoint(
  point: ObliqueWorldPoint,
  viewRotationDeg = 0
): ObliquePoint {
  const [rotatedX, rotatedY] = rotatePlanPoint(
    point[0],
    point[1],
    viewRotationDeg
  )
  return [
    rotatedX + rotatedY * DEPTH_X,
    -point[2] - rotatedY * DEPTH_Y
  ]
}

/**
 * 从物料聚合构建指定视角下的 2.5D 场景。
 * @param aggregates 物料（Material）聚合列表。
 * @param shapes 设备包提供的外形声明库。
 * @param viewRotationDeg 视角绕世界 Z 轴旋转的角度。
 * @returns 已排序、带边界与诊断信息的 2.5D 场景。
 */
export function buildMaterialObliqueScene(
  aggregates: readonly MaterialAggregate[],
  shapes?: MaterialShapeLibrary,
  viewRotationDeg = 0
): MaterialObliqueScene {
  const aggregatesById = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.material.id, aggregate])
  )
  const projected = aggregates.map((aggregate) => {
    try {
      return materialToObliqueObject(
        aggregate,
        aggregatesById,
        shapes,
        viewRotationDeg
      )
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

/**
 * 把单个物料（Material）聚合转换为当前视角下的可绘制对象。
 * @param aggregate 待投影的物料聚合。
 * @param aggregatesById 解析父子放置关系使用的物料索引。
 * @param shapes 设备包外形声明库。
 * @param viewRotationDeg 当前 2.5D 视角角度。
 * @returns 带投影点、局部平面矩阵与绘制排序信息的对象。
 */
function materialToObliqueObject(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  shapes: MaterialShapeLibrary | undefined,
  viewRotationDeg: number
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
  const resolved = resolveMaterialObliqueShape(
    shapes,
    aggregate.shapeIdentity,
    visual.kind,
    declaredLevels,
    { widthMm, depthMm, heightMm }
  )
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
  const viewWorldCorners = worldCorners.map(([x, y, z]) => {
    const [rotatedX, rotatedY] = rotatePlanPoint(x, y, viewRotationDeg)
    return [rotatedX, rotatedY, z] as const
  })
  const base = worldCorners.map((point) =>
    projectObliquePoint(point, viewRotationDeg)
  )
  const top = worldCorners.map(
    ([x, y, z]) =>
      projectObliquePoint([x, y, z + heightMm], viewRotationDeg)
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
    topTransform: topPlaneTransform(pose, heightMm, viewRotationDeg),
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
        ? Math.max(...viewWorldCorners.map((point) => point[1]))
        : viewWorldCorners.reduce((total, point) => total + point[1], 0) /
          viewWorldCorners.length
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

/**
 * 生成物料局部平面到旋转后 2.5D 视图的仿射变换。
 * @param pose 物料在世界坐标中的权威位姿。
 * @param heightMm 局部平面的物料高度。
 * @param viewRotationDeg 视角绕世界 Z 轴旋转的角度。
 * @returns SVG matrix 使用的六元素仿射矩阵。
 */
function topPlaneTransform(
  pose: LabPose,
  heightMm: number,
  viewRotationDeg: number
): readonly [number, number, number, number, number, number] {
  const yawRad =
    ((pose.rotationDegXYZ[2] + viewRotationDeg) * Math.PI) / 180
  const cosine = Math.cos(yawRad)
  const sine = Math.sin(yawRad)
  const [x, y, z] = pose.positionMm
  const [rotatedX, rotatedY] = rotatePlanPoint(x, y, viewRotationDeg)

  return [
    cosine + sine * DEPTH_X,
    -sine * DEPTH_Y,
    -sine + cosine * DEPTH_X,
    -cosine * DEPTH_Y,
    rotatedX + rotatedY * DEPTH_X,
    -(z + heightMm) - rotatedY * DEPTH_Y
  ]
}

/**
 * 在水平面内绕世界原点旋转坐标。
 * @param x 世界 X 坐标。
 * @param y 世界 Y 坐标。
 * @param rotationDeg 绕 Z 轴旋转的角度。
 * @returns 旋转后的 X、Y 坐标。
 */
function rotatePlanPoint(
  x: number,
  y: number,
  rotationDeg: number
): readonly [number, number] {
  if (rotationDeg === 0) return [x, y]
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cosine = Math.cos(rotationRad)
  const sine = Math.sin(rotationRad)
  return [x * cosine - y * sine, x * sine + y * cosine]
}
