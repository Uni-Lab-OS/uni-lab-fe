import type { Vector3Tuple } from '../units'

export type MaterialKind = 'device' | 'resource'

/**
 * Return the mesh-local centre of a generated bounding-box model.
 *
 * Resource and labware poses use a lower-left-bottom datum. Device fallback
 * boxes keep the existing asset-like centre/base datum. The Material node and
 * every Site stay at their canonical poses; only this generated mesh moves.
 */
export function generatedBoundingBoxCenter(
  materialKind: MaterialKind,
  dimensions: Vector3Tuple
): Vector3Tuple {
  const [width, height, depth] = dimensions
  return materialKind === 'resource'
    ? [width / 2, height / 2, -depth / 2]
    : [0, height / 2, 0]
}
