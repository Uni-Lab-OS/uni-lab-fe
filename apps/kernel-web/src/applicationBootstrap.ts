import type { ComponentType } from 'react'

import { ensurePascalRendererDefaults } from '@unilab/pascal-host/renderer-features'

export interface ApplicationModule {
  default: ComponentType
}

/**
 * 在应用模块及其 Pascal 依赖求值前应用渲染兼容默认值。
 * Pascal 0.9.2 会在模块求值时冻结可选渲染特性，因此这里必须保持顺序。
 */
export async function loadApplicationAfterRendererDefaults(
  loadApplication: () => Promise<ApplicationModule>,
  applyRendererDefaults: () => void = ensurePascalRendererDefaults
): Promise<ApplicationModule> {
  applyRendererDefaults()
  return loadApplication()
}
