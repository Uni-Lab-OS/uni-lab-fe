import type { CapabilityStatus } from './MaterialCapabilityNotice'
import type { MaterialLoadState } from './storeTypes'

export type MaterialCatalogLoadState = 'pending' | 'ready' | 'error'

export interface MaterialWorkspaceReadStatus {
  state: 'ready' | 'pending' | 'error'
  label: string
}

/**
 * 将物料图、资源模板目录能力与加载状态组合为不夸大权威的页面状态。
 *
 * @param graphLoadState 物料聚合图的当前加载状态。
 * @param graphReadStatus 宿主声明的物料图读取能力。
 * @param catalogStatus 宿主声明的资源模板目录读取能力。
 * @param catalogLoadState 资源模板目录的当前加载状态。
 * @returns 可直接展示的状态色和中文状态文本。
 */
export function materialWorkspaceReadStatus(
  graphLoadState: MaterialLoadState,
  graphReadStatus: CapabilityStatus,
  catalogStatus: CapabilityStatus,
  catalogLoadState: MaterialCatalogLoadState
): MaterialWorkspaceReadStatus {
  if (!graphReadStatus.available) {
    return {
      state: 'error',
      label: graphReadStatus.reason ?? '物料图不可读取'
    }
  }
  if (graphLoadState === 'error') {
    return { state: 'error', label: '物料图读取失败' }
  }
  if (graphLoadState !== 'ready') {
    return {
      state: 'pending',
      label: graphLoadState === 'loading'
        ? '正在读取物料图'
        : '等待读取物料图'
    }
  }
  if (!catalogStatus.available) {
    return { state: 'error', label: '物料图已载入 · 模板目录不可读取' }
  }
  if (catalogLoadState === 'error') {
    return { state: 'error', label: '物料图已载入 · 模板目录读取失败' }
  }
  if (catalogLoadState === 'pending') {
    return { state: 'pending', label: '物料图已载入 · 正在分类实例' }
  }
  return { state: 'ready', label: '物料数据已加载' }
}
