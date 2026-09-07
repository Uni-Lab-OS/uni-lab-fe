import type { SpatialAabb } from './types'

export type SpatialProjectionPlane = 'xy' | 'xz'

export interface SpatialProjectionBounds {
  minHorizontal: number
  maxHorizontal: number
  minVertical: number
  maxVertical: number
}

export interface ProjectedSpatialRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SpatialProjectionViewport {
  width: number
  height: number
  padding: number
}

function axes(plane: SpatialProjectionPlane): readonly [number, number] {
  return plane === 'xy' ? [0, 1] : [0, 2]
}

export function getSpatialProjectionBounds(
  boxes: readonly SpatialAabb[],
  plane: SpatialProjectionPlane
): SpatialProjectionBounds {
  if (boxes.length === 0) {
    return {
      minHorizontal: -0.5,
      maxHorizontal: 0.5,
      minVertical: -0.5,
      maxVertical: 0.5
    }
  }
  const [horizontalAxis, verticalAxis] = axes(plane)
  return {
    minHorizontal: Math.min(...boxes.map((box) => box.min_m[horizontalAxis])),
    maxHorizontal: Math.max(...boxes.map((box) => box.max_m[horizontalAxis])),
    minVertical: Math.min(...boxes.map((box) => box.min_m[verticalAxis])),
    maxVertical: Math.max(...boxes.map((box) => box.max_m[verticalAxis]))
  }
}

/** 将米制世界 AABB 等比映射为 SVG rect；纵轴向上，不猜测具体设备尺寸。 */
export function projectSpatialAabb(
  box: SpatialAabb,
  plane: SpatialProjectionPlane,
  bounds: SpatialProjectionBounds,
  viewport: SpatialProjectionViewport
): ProjectedSpatialRect {
  const [horizontalAxis, verticalAxis] = axes(plane)
  const availableWidth = Math.max(1, viewport.width - viewport.padding * 2)
  const availableHeight = Math.max(1, viewport.height - viewport.padding * 2)
  const horizontalRange = Math.max(
    Number.EPSILON,
    bounds.maxHorizontal - bounds.minHorizontal
  )
  const verticalRange = Math.max(
    Number.EPSILON,
    bounds.maxVertical - bounds.minVertical
  )
  const scale = Math.min(
    availableWidth / horizontalRange,
    availableHeight / verticalRange
  )
  const renderedWidth = horizontalRange * scale
  const renderedHeight = verticalRange * scale
  const offsetX = viewport.padding + (availableWidth - renderedWidth) / 2
  const offsetY = viewport.padding + (availableHeight - renderedHeight) / 2

  const x =
    offsetX + (box.min_m[horizontalAxis] - bounds.minHorizontal) * scale
  const y =
    offsetY +
    (bounds.maxVertical - box.max_m[verticalAxis]) * scale
  return {
    x,
    y,
    width: Math.max(0.75, (box.max_m[horizontalAxis] - box.min_m[horizontalAxis]) * scale),
    height: Math.max(0.75, (box.max_m[verticalAxis] - box.min_m[verticalAxis]) * scale)
  }
}
