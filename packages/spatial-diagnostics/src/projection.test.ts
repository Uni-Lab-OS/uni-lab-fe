import { describe, expect, it } from 'vitest'

import { getSpatialProjectionBounds, projectSpatialAabb } from './projection'

describe('spatial AABB projection', () => {
  const bounds = getSpatialProjectionBounds(
    [{ min_m: [-2, -1, 0], max_m: [2, 1, 4] }],
    'xz'
  )

  it('preserves physical aspect ratio and maps +Z upward', () => {
    const low = projectSpatialAabb(
      { min_m: [-1, 0, 0], max_m: [0, 1, 1] },
      'xz',
      bounds,
      { width: 240, height: 240, padding: 20 }
    )
    const high = projectSpatialAabb(
      { min_m: [-1, 0, 3], max_m: [0, 1, 4] },
      'xz',
      bounds,
      { width: 240, height: 240, padding: 20 }
    )

    expect(low.width).toBeCloseTo(low.height)
    expect(high.y).toBeLessThan(low.y)
  })

  it('uses the requested XY axes rather than guessing a workcell orientation', () => {
    const xy = getSpatialProjectionBounds(
      [{ min_m: [-2, -5, 100], max_m: [2, 7, 101] }],
      'xy'
    )

    expect(xy).toEqual({
      minHorizontal: -2,
      maxHorizontal: 2,
      minVertical: -5,
      maxVertical: 7
    })
  })
})
