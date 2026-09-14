import type { Vector3Tuple } from '../units'

/**
 * Return the mesh-local centre of a generated bounding-box model.
 *
 * Every Material node uses a lower-left-bottom datum. The Material node and
 * every Site stay at their canonical poses; only this generated mesh moves.
 */
export function generatedBoundingBoxCenter(
  dimensions: Vector3Tuple
): Vector3Tuple {
  const [width, height, depth] = dimensions
  return [width / 2, height / 2, -depth / 2]
}
