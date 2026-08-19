import type { DesktopSurfaceKind } from './desktopSurface'

export type WorkbenchReleaseChannel = 'production' | 'test'

export interface WorkbenchUpdateEligibility {
  isPackaged: boolean
  releaseChannel: WorkbenchReleaseChannel
  surfaceKind: DesktopSurfaceKind
}

/**
 * 自动更新只属于已打包的生产 Workbench；测试介质必须永久失败关闭。
 */
export function shouldEnableWorkbenchUpdates(
  eligibility: WorkbenchUpdateEligibility
): boolean {
  return eligibility.isPackaged
    && eligibility.releaseChannel === 'production'
    && eligibility.surfaceKind === 'workbench'
}
