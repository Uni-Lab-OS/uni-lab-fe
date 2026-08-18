import { describe, expect, it } from 'vitest'

import { shouldPausePascalRendering } from './renderActivity'

/**
 * 验证被 2D 或 2.5D 画布覆盖时暂停 Pascal 三维帧循环。
 *
 * @returns 无返回值；任一视图模式映射错误时由 Vitest 报告失败。
 */
function pausesOnlyCoveredThreeDimensionalRendering(): void {
  expect(shouldPausePascalRendering('2d')).toBe(true)
  expect(shouldPausePascalRendering('2.5d')).toBe(true)
  expect(shouldPausePascalRendering('3d')).toBe(false)
  expect(shouldPausePascalRendering('split')).toBe(false)
}

describe('Pascal 三维帧循环可见性', () => {
  it('仅在三维画布被其他视图覆盖时暂停', pausesOnlyCoveredThreeDimensionalRendering)
})
