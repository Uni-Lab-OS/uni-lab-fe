import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import type { AppUpdateManager } from './appUpdateManager'

/** 注册 Workbench 更新的窄 IPC interface；所有命令仍由主进程校验状态。 */
export function registerAppUpdateIpc(options: {
  ipcMain: IpcMain
  manager: AppUpdateManager
  assertSender: (event: IpcMainInvokeEvent) => void
}): void {
  const { ipcMain, manager, assertSender } = options
  ipcMain.handle('app-update:getState', (event) => {
    assertSender(event)
    return manager.getSnapshot()
  })
  ipcMain.handle('app-update:check', async (event) => {
    assertSender(event)
    return manager.check()
  })
  ipcMain.handle('app-update:download', async (event) => {
    assertSender(event)
    return manager.download()
  })
  ipcMain.handle('app-update:pauseDownload', async (event) => {
    assertSender(event)
    return manager.pauseDownload()
  })
  ipcMain.handle('app-update:resumeDownload', async (event) => {
    assertSender(event)
    return manager.resumeDownload()
  })
  ipcMain.handle('app-update:restartAndInstall', async (event) => {
    assertSender(event)
    return manager.restartAndInstall()
  })
}
