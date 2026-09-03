import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'

import type { ElectronObservability } from './observability'
import {
  configureParentProcessWorkbenchRemoteAccess,
  getPackagedWorkbenchRemoteAccess,
  startPackagedWorkbenchRemoteAccess,
  stopPackagedWorkbenchRemoteAccess
} from './packagedRuntime'
import {
  UNAVAILABLE_WORKBENCH_WORKSPACE,
  type WorkbenchEntryMode,
  type WorkbenchWorkspaceActivation,
  type WorkbenchWorkspaceController,
  type WorkbenchWorkspaceSnapshot
} from '../shared/workbenchWorkspace'
import { switchWorkbenchWorkspaceToWelcome } from './workbenchWorkspaceTransition'

declare global {
  var __unilabWorkbenchWorkspaceController:
    | WorkbenchWorkspaceController
    | undefined
}

let workspaceSwitchPending = false

export function registerWorkbenchRemoteAccessIpc(options: {
  observability: Pick<ElectronObservability, 'run'>
  assertSender: (event: IpcMainInvokeEvent) => void
  getMainWindow: () => BrowserWindow | null
}): void {
  configureParentProcessWorkbenchRemoteAccess()
  ipcMain.handle('workbench-remote:getSnapshot', (event) => {
    options.assertSender(event)
    return getPackagedWorkbenchRemoteAccess()
  })
  ipcMain.handle('workbench-remote:start', (event) => {
    options.assertSender(event)
    return options.observability.run(
      'electron.workbench_remote.start',
      {},
      startPackagedWorkbenchRemoteAccess
    )
  })
  ipcMain.handle('workbench-remote:stop', (event) => {
    options.assertSender(event)
    return options.observability.run(
      'electron.workbench_remote.stop',
      {},
      stopPackagedWorkbenchRemoteAccess
    )
  })
  ipcMain.handle('workbench-workspace:getSnapshot', (event) => {
    options.assertSender(event)
    return workspaceController()?.getSnapshot()
      ?? UNAVAILABLE_WORKBENCH_WORKSPACE
  })
  ipcMain.handle('workbench-workspace:openDirectory', (event, mode: unknown) => {
    options.assertSender(event)
    return openWorkspaceSelection(options, () => requireWorkspaceController()
      .chooseAndOpen('open', workbenchEntryMode(mode)))
  })
  ipcMain.handle('workbench-workspace:createDirectory', (event, mode: unknown) => {
    options.assertSender(event)
    return openWorkspaceSelection(options, () => requireWorkspaceController()
      .chooseAndOpen('create', workbenchEntryMode(mode)))
  })
  ipcMain.handle('workbench-workspace:openRecent', (
    event,
    path: unknown,
    mode: unknown
  ) => {
    options.assertSender(event)
    if (typeof path !== 'string') throw new Error('最近工作区路径无效')
    return openWorkspaceSelection(options, () => requireWorkspaceController()
      .openRecent(path, workbenchEntryMode(mode)))
  })
  ipcMain.handle('workbench-workspace:openPath', (
    event,
    path: unknown,
    mode: unknown
  ) => {
    options.assertSender(event)
    if (typeof path !== 'string' || !path.trim()) {
      throw new Error('工作区目录不能为空')
    }
    return openWorkspaceSelection(options, () => requireWorkspaceController()
      .openPath(path.trim(), workbenchEntryMode(mode)))
  })
  ipcMain.handle('workbench-workspace:selectDirectory', async (
    event,
    mode: unknown
  ) => {
    options.assertSender(event)
    const controller = requireWorkspaceController()
    const window = requireMainWindow(options)
    workspaceSwitchPending = true
    try {
      const transition = await switchWorkbenchWorkspaceToWelcome({
        window,
        controller,
        publishSnapshot: (snapshot) => publishWorkspaceSnapshot(window, snapshot)
      })
      if (!transition.switched || window.isDestroyed()) {
        return transition.snapshot
      }
      return await openWorkspaceSelection(options, () => controller
        .chooseAndOpen('open', workbenchEntryMode(mode)))
    } finally {
      workspaceSwitchPending = false
    }
  })
  ipcMain.handle('workbench-workspace:switchToWelcome', async (event) => {
    options.assertSender(event)
    const controller = requireWorkspaceController()
    const window = requireMainWindow(options)
    workspaceSwitchPending = true
    try {
      return await switchWorkbenchWorkspaceToWelcome({
        window,
        controller,
        publishSnapshot: (snapshot) => publishWorkspaceSnapshot(window, snapshot)
      })
    } finally {
      workspaceSwitchPending = false
    }
  })
}

/** 收窄欢迎页提交的模式意图；省略时保持既有调试模式启动语义。 */
function workbenchEntryMode(value: unknown): WorkbenchEntryMode {
  if (value === undefined || value === 'debug') return 'debug'
  if (value === 'production') return value
  throw new Error('工作模式无效')
}

export function isWorkbenchWorkspaceNavigationAllowed(targetUrl: string): boolean {
  return workspaceController()?.isNavigationAllowed(targetUrl) ?? false
}

export function workbenchUnloadPrompt(): {
  buttons: [string, string]
  detail: string
  discardedEvent: string
} {
  return workspaceSwitchPending
    ? {
        buttons: ['继续编辑', '放弃修改并切换'],
        detail: '切换工作区将丢失这些修改。',
        discardedEvent: 'electron.renderer.unsaved_changes_discarded_for_switch'
      }
    : {
        buttons: ['继续编辑', '放弃修改并关闭'],
        detail: '关闭窗口将丢失这些修改。',
        discardedEvent: 'electron.renderer.unsaved_changes_discarded'
      }
}

async function openWorkspaceSelection(
  options: { getMainWindow: () => BrowserWindow | null },
  select: () => Promise<WorkbenchWorkspaceActivation | null>
): Promise<WorkbenchWorkspaceSnapshot> {
  const controller = requireWorkspaceController()
  const window = requireMainWindow(options)
  let activation: WorkbenchWorkspaceActivation | null
  try {
    activation = await select()
  } catch {
    const snapshot = controller.getSnapshot()
    publishWorkspaceSnapshot(window, snapshot)
    return snapshot
  }
  if (!activation) return controller.getSnapshot()
  try {
    await window.loadURL(activation.rendererUrl)
    return activation.snapshot
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const snapshot = await controller.deactivate(
      `工作区界面加载失败：${message}`
    )
    await window.loadURL(controller.welcomeUrl).catch(() => undefined)
    publishWorkspaceSnapshot(window, snapshot)
    return snapshot
  }
}

function workspaceController(): WorkbenchWorkspaceController | undefined {
  return globalThis.__unilabWorkbenchWorkspaceController
}

function requireWorkspaceController(): WorkbenchWorkspaceController {
  const controller = workspaceController()
  if (!controller) throw new Error('当前桌面应用没有可用的工作区控制器')
  return controller
}

function requireMainWindow(options: {
  getMainWindow: () => BrowserWindow | null
}): BrowserWindow {
  const window = options.getMainWindow()
  if (!window || window.isDestroyed()) throw new Error('主窗口不可用')
  return window
}

function publishWorkspaceSnapshot(
  window: BrowserWindow,
  snapshot: WorkbenchWorkspaceSnapshot
): void {
  if (!window.isDestroyed()) {
    window.webContents.send('workbench-workspace:snapshot', snapshot)
  }
}
