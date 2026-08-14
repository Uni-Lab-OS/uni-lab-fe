import type {
  FloorplanGeometry,
  FloorplanPoint,
  GeometryContext
} from '@pascal-app/core'

import type {
  LabDeviceNode,
  LabFloorplanSite,
  LabSceneNode
} from './schema'

const MILLIMETERS_TO_METERS = 0.001

/**
 * Pascal-native floor-plan geometry for Uni-Lab material nodes.
 *
 * The Material graph uses Z-up millimetres and a lower-left footprint origin.
 * Pascal's plan uses its X/Z plane in metres, hence the world Y sign flip.
 * Geometry is emitted in level coordinates so Pascal retains ownership of
 * fitting, panning, zooming, hover and selection.
 */
export function buildLabFloorplan(
  node: LabSceneNode,
  ctx: GeometryContext
): FloorplanGeometry | null {
  const snapshot = node.floorplanSnapshot
  if (!snapshot || node.visible === false) return null

  const [widthMm, depthMm] = snapshot.footprintMm
  if (widthMm <= 0 || depthMm <= 0) return null

  const selected = ctx.viewState?.selected ?? false
  const highlighted = ctx.viewState?.highlighted ?? false
  const hovered = ctx.viewState?.hovered ?? false
  const showSelection = selected || highlighted
  const selectedStroke =
    ctx.viewState?.palette?.selectedStroke ?? '#3b82f6'
  const colors = floorplanColors(snapshot.kind)
  const footprint = localPolygon(
    snapshot.worldPositionMm,
    snapshot.worldRotationDegXYZ[2],
    [
      [0, 0],
      [widthMm, 0],
      [widthMm, depthMm],
      [0, depthMm]
    ]
  )
  const children: FloorplanGeometry[] = [
    {
      kind: 'polygon',
      points: footprint,
      fill: colors.fill,
      fillOpacity: colors.fillOpacity,
      stroke: showSelection ? selectedStroke : colors.stroke,
      strokeWidth: showSelection ? 0.012 : 0.006,
      vectorEffect: 'non-scaling-stroke'
    }
  ]

  for (const site of snapshot.sites) {
    if (!site.visible) continue
    children.push(
      ...siteGeometry(
        site,
        snapshot.worldPositionMm,
        snapshot.worldRotationDegXYZ[2]
      )
    )
  }

  const equipment =
    node.type === 'lab-table' ||
    isEquipmentKind((node as LabDeviceNode).deviceType ?? snapshot.kind)
  if (node.showLabel && (equipment || hovered || showSelection)) {
    const labelPoint = localPoint(
      snapshot.worldPositionMm,
      snapshot.worldRotationDegXYZ[2],
      [widthMm / 2, depthMm + Math.max(depthMm * 0.06, 12)]
    )
    children.push({
      kind: 'text',
      x: labelPoint[0],
      y: labelPoint[1],
      text: node.displayName,
      fontSize: clamp(Math.min(widthMm, depthMm) / 1000 * 0.12, 0.035, 0.09),
      fill: showSelection ? selectedStroke : '#0f172a',
      fontWeight: 650,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      stroke: '#ffffff',
      strokeWidth: 0.008,
      paintOrder: 'stroke',
      upright: true
    })
  }

  return { kind: 'group', children }
}

function siteGeometry(
  site: LabFloorplanSite,
  worldPositionMm: readonly [number, number, number],
  worldYawDeg: number
): FloorplanGeometry[] {
  const [widthMm, depthMm] = site.sizeMm
  const colors = siteColors(site.visualState, site.kind)
  const common = {
    fill: colors.fill,
    stroke: colors.stroke,
    strokeWidth: 0.004,
    vectorEffect: 'non-scaling-stroke' as const
  }
  const x = site.positionMm[0]
  const y = site.positionMm[1]
  const geometry: FloorplanGeometry =
    site.shape === 'circle'
      ? {
          kind: 'circle',
          ...common,
          ...circleAt(
            worldPositionMm,
            worldYawDeg,
            [x + widthMm / 2, y + depthMm / 2],
            Math.min(widthMm, depthMm) / 2
          )
        }
      : {
          kind: 'polygon',
          ...common,
          points: localPolygon(worldPositionMm, worldYawDeg, [
            [x, y],
            [x + widthMm, y],
            [x + widthMm, y + depthMm],
            [x, y + depthMm]
          ])
        }
  const result: FloorplanGeometry[] = [geometry]

  if (
    site.kind === 'deck-slot' &&
    Math.min(widthMm, depthMm) >= 40
  ) {
    const center = localPoint(worldPositionMm, worldYawDeg, [
      x + widthMm / 2,
      y + depthMm / 2
    ])
    result.push({
      kind: 'text',
      x: center[0],
      y: center[1],
      text: site.name,
      fontSize: clamp(Math.min(widthMm, depthMm) / 1000 * 0.24, 0.025, 0.07),
      fill: '#334155',
      fontWeight: 650,
      textAnchor: 'middle',
      dominantBaseline: 'middle',
      upright: true
    })
  }
  return result
}

function localPolygon(
  worldPositionMm: readonly [number, number, number],
  worldYawDeg: number,
  points: readonly (readonly [number, number])[]
): readonly FloorplanPoint[] {
  return points.map((point) =>
    localPoint(worldPositionMm, worldYawDeg, point)
  )
}

function localPoint(
  worldPositionMm: readonly [number, number, number],
  worldYawDeg: number,
  point: readonly [number, number]
): FloorplanPoint {
  const angle = (worldYawDeg * Math.PI) / 180
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const worldX =
    worldPositionMm[0] + point[0] * cosine - point[1] * sine
  const worldY =
    worldPositionMm[1] + point[0] * sine + point[1] * cosine
  return [
    worldX * MILLIMETERS_TO_METERS,
    -worldY * MILLIMETERS_TO_METERS
  ]
}

function circleAt(
  worldPositionMm: readonly [number, number, number],
  worldYawDeg: number,
  centerMm: readonly [number, number],
  radiusMm: number
): { cx: number; cy: number; r: number } {
  const center = localPoint(worldPositionMm, worldYawDeg, centerMm)
  return {
    cx: center[0],
    cy: center[1],
    r: radiusMm * MILLIMETERS_TO_METERS
  }
}

function floorplanColors(kind: string): {
  fill: string
  fillOpacity: number
  stroke: string
} {
  const normalized = kind.replaceAll('_', '-').toLowerCase()
  if (normalized.includes('trash')) {
    return { fill: '#334155', fillOpacity: 0.94, stroke: '#0f172a' }
  }
  if (
    normalized.includes('plate') ||
    normalized.includes('tip-rack') ||
    normalized.includes('tiprack')
  ) {
    return { fill: '#e2e8f0', fillOpacity: 0.96, stroke: '#64748b' }
  }
  if (normalized.includes('deck')) {
    return { fill: '#f8fafc', fillOpacity: 0.72, stroke: '#22c55e' }
  }
  return { fill: '#eef6ff', fillOpacity: 0.76, stroke: '#64748b' }
}

function siteColors(
  state: LabFloorplanSite['visualState'],
  kind: LabFloorplanSite['kind']
): { fill: string; stroke: string } {
  if (state === 'filled') return { fill: '#60a5fa', stroke: '#2563eb' }
  if (state === 'tip-present') {
    return { fill: '#d9f99d', stroke: '#22c55e' }
  }
  if (state === 'occupied') {
    return { fill: '#93c5fd', stroke: '#3b82f6' }
  }
  return kind === 'deck-slot'
    ? { fill: '#f8fafc', stroke: '#3b82f6' }
    : { fill: '#f8fafc', stroke: '#cbd5e1' }
}

function isEquipmentKind(kind: string): boolean {
  const normalized = kind.replaceAll('_', '-').toLowerCase()
  return ![
    'plate',
    'tip-rack',
    'tiprack',
    'labware',
    'container',
    'reagent',
    'sample',
    'tube',
    'trash',
    'deck'
  ].some((token) => normalized.includes(token))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
