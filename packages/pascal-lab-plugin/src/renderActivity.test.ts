import { describe, expect, it } from 'vitest'

import { shouldPausePascalRendering } from './renderActivity'

describe('Pascal 三维帧循环可见性', () => {
  it('仅在三维画布被其他视图覆盖时暂停', () => {
    expect(shouldPausePascalRendering('2d')).toBe(true)
    expect(shouldPausePascalRendering('2.5d')).toBe(true)
    expect(shouldPausePascalRendering('3d')).toBe(false)
    expect(shouldPausePascalRendering('split')).toBe(false)
  })
})
