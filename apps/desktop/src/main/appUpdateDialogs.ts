import { dialog, type BrowserWindow } from 'electron'

import type { AppUpdateSnapshot } from '../shared/appUpdate'

/** 显示更新下载确认；窗口不可用时保持后台不下载。 */
export async function confirmAppUpdateDownload(
  getMainWindow: () => BrowserWindow | null,
  snapshot: AppUpdateSnapshot
): Promise<boolean> {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return false
  const result = await dialog.showMessageBox(window, {
    type: 'info',
    title: '发现 UniLab Workbench 新版本',
    message: `发现新版本 ${snapshot.availableVersion ?? ''}`.trim(),
    detail: `当前版本 ${snapshot.currentVersion}。可以在后台下载，下载期间不会中断实验。`,
    buttons: ['后台下载', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  return result.response === 0
}

/** 显示安装确认，明确重启会停止 Workbench 管理的本地进程。 */
export async function confirmAppUpdateInstall(
  getMainWindow: () => BrowserWindow | null,
  snapshot: AppUpdateSnapshot
): Promise<boolean> {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return false
  const result = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'UniLab Workbench 更新已就绪',
    message: `版本 ${snapshot.availableVersion ?? ''} 已下载`.trim(),
    detail: '重启将先停止 Workbench 后端、Runtime、Agent 和设备卡片进程；未保存的工作流仍会在退出前确认。',
    buttons: ['重启并安装', '稍后'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return result.response === 0
}
