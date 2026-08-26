import type { DesktopSurfaceKind } from './desktopSurface'

export type WorkbenchReleaseChannel =
  | 'production'
  | 'update-test'
  | 'test'

export interface WorkbenchUpdateEligibility {
  isPackaged: boolean
  releaseChannel: WorkbenchReleaseChannel
  surfaceKind: DesktopSurfaceKind
}

/**
 * 自动更新只属于已打包的生产 Workbench 或隔离热更新测试包。
 */
export function shouldEnableWorkbenchUpdates(
  eligibility: WorkbenchUpdateEligibility
): boolean {
  return eligibility.isPackaged
    && ['production', 'update-test'].includes(eligibility.releaseChannel)
    && eligibility.surfaceKind === 'workbench'
}
