import type { AppUpdateErrorCode } from '../shared/appUpdate'

export interface AppUpdateInstallLocation {
  platform: NodeJS.Platform
  executablePath: string
}

/**
 * 判断当前应用位置是否允许操作系统更新器原地替换应用。
 *
 * macOS DMG 挂载在只读的 /Volumes 下。直接双击其中的 .app 可以正常运行，
 * 但 Squirrel.Mac 无法把新版本安装回该位置，必须先拖入“应用程序”目录。
 */
export function resolveAppUpdateInstallBlocker(
  location: AppUpdateInstallLocation
): AppUpdateErrorCode | undefined {
  if (
    location.platform === 'darwin'
    && location.executablePath.startsWith('/Volumes/')
  ) {
    return 'INSTALL_FROM_DISK_IMAGE'
  }
  return undefined
}
