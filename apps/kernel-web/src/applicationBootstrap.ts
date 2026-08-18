import type { ComponentType } from 'react'

import { ensurePascalRendererDefaults } from '@unilab/pascal-host/renderer-features'

export interface ApplicationModule {
  default: ComponentType
}

/**
 * 在应用模块及其 Pascal 依赖求值前应用渲染兼容默认值。
 *
 * @param loadApplication 动态加载共享应用渲染模块的函数。
 * @param applyRendererDefaults 写入 Pascal 可选渲染特性默认值的函数。
 * @returns 完成模块求值后的应用入口；调用方负责挂载 React 根节点。
 * @throws 默认值设置或应用模块加载失败时透传异常，阻止半初始化界面挂载。
 */
export async function loadApplicationAfterRendererDefaults(
  loadApplication: () => Promise<ApplicationModule>,
  applyRendererDefaults: () => void = ensurePascalRendererDefaults
): Promise<ApplicationModule> {
  applyRendererDefaults()
  return loadApplication()
}
