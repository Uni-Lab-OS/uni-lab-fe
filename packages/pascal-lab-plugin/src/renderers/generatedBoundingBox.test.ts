import { describe, expect, it } from 'vitest'

import { generatedBoundingBoxCenter } from './generatedBoundingBox'

describe('generatedBoundingBoxCenter', () => {
  it('centres every fallback box inside its lower-left-bottom datum', () => {
    expect(
      generatedBoundingBoxCenter([0.26552, 0.206, 0.18096])
    ).toEqual([0.13276, 0.103, -0.09048])
  })

  it('uses the same lower-left-bottom datum for device fallbacks', () => {
    expect(generatedBoundingBoxCenter([0.6, 0.5, 0.4])).toEqual([
      0.3, 0.25, -0.2
    ])
  })
})
