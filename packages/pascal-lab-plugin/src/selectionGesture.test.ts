import { exceedsSelectionDragThreshold } from '@unilab/pascal-host/selection-gesture'
import { describe, expect, it } from 'vitest'

describe('Pascal 3D selection gesture guard', () => {
  it('keeps small pointer jitter as a deliberate click', () => {
    expect(exceedsSelectionDragThreshold(
      { x: 100, y: 100 },
      { x: 103, y: 104 }
    )).toBe(false)
  })

  it('treats camera movement beyond six pixels as a drag', () => {
    expect(exceedsSelectionDragThreshold(
      { x: 100, y: 100 },
      { x: 107, y: 100 }
    )).toBe(true)
  })
})
