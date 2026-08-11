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
    title: '发现 Uni-Lab 新版本',
    message: `发现新版本 ${snapshot.availableVersion ?? ''}`.trim(),
    detail: `当前版本 ${snapshot.currentVersion}。可以在后台下载，下载期间不会中断实验。`,
    buttons: ['后台下载', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })
  return result.response === 0
}
/** 显示安装确认，明确重启会停止本地托管进程并触发未保存检查。 */
export async function confirmAppUpdateInstall(
  getMainWindow: () => BrowserWindow | null,
  snapshot: AppUpdateSnapshot
): Promise<boolean> {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return false
  const result = await dialog.showMessageBox(window, {
    type: 'info',
    title: 'Uni-Lab 更新已就绪',
    message: `版本 ${snapshot.availableVersion ?? ''} 已下载`.trim(),
    detail: '重启将停止桌面端托管的 Edge、PLC-Sim 和设备卡片进程。存在未保存内容时应用会再次确认。',
    buttons: ['重启并安装', '稍后'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return result.response === 0
}
