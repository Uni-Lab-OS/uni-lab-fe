import { describe, expect, it } from 'vitest'

import { generatedBoundingBoxCenter } from './generatedBoundingBox'

describe('generatedBoundingBoxCenter', () => {
  it('centres the cover-buffer box inside its lower-corner resource model', () => {
    expect(
      generatedBoundingBoxCenter(
        'resource',
        [0.26552, 0.206, 0.18096]
      )
    ).toEqual([0.13276, 0.103, -0.09048])
  })

  it('keeps the existing centre/base fallback datum for devices', () => {
    expect(
      generatedBoundingBoxCenter('device', [0.6, 0.5, 0.4])
    ).toEqual([0, 0.25, 0])
  })
})
