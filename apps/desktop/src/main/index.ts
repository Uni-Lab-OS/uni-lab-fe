import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { appendFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { autoUpdater } from 'electron-updater'
import { registerAuthIpc } from './authIpc'
import {
  AppUpdateManager,
  createElectronUpdaterAdapter
} from './appUpdateManager'
import {
  confirmAppUpdateDownload,
  confirmAppUpdateInstall
} from './appUpdateDialogs'
import { registerAppUpdateIpc } from './appUpdateIpc'
import { createDesktopWindow } from './desktopWindow'
import { DeviceCardManager } from './deviceCardManager'
import { DeviceCardAgentEnvironment } from './deviceCardAgentEnvironment'
import {
  createDiagnosticLogSessionId,
  resolveDesktopMainLogPath
} from './diagnosticLogSession'
import { discoverDefaultCondaEnvironment } from './localRuntimeEnvironment'
import { registerDeviceProvisioningIpc } from './deviceProvisioningIpc'
import { LocalDeviceProvisioningManager } from './localDeviceProvisioningManager'
import { LocalDeviceProvisioningStore } from './localDeviceProvisioningStore'
import {
  LocalRuntimeManager
} from './localRuntimeManager'
import {
  confirmCustomEdgeLaunch,
  openRuntimeLogDirectory,
  parseRuntimeConfig,
  parseRuntimeLogQuery,
  resolveGeneratedEdgeCommand,
  runtimePathDialogOptions
} from './localRuntimeIpcSupport'
import {
  createElectronObservability,
  resolveElectronObservabilityOptions
} from './observability'
import { registerFileIpc } from './fileIpc'
import type { LocalRuntimePathKind } from '../shared/localRuntime'

// 本次应用生命周期只创建一个日志会话，供主进程和本地运行子进程共同使用。
const DIAGNOSTIC_LOG_SESSION_ID = createDiagnosticLogSessionId()
// 主日志保持位于家目录，兼容既有安装包中的故障排查路径。
const LOG_PATH = resolveDesktopMainLogPath(
  homedir(),
  DIAGNOSTIC_LOG_SESSION_ID
)

/**
 * 追加一条带 UTC 时间的 Electron 主进程诊断信息。
 *
 * @param message 已由调用方去除敏感内容的诊断消息。
 * @returns 无返回值；写入失败时保持主进程继续运行。
 * @throws 不向调用方抛出文件系统异常。
 * @safety 路径在应用加载时冻结，消息不会改变目标文件位置。
 */
function logLine(message: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // 忽略日志写入失败
  }
}

const isDev = !app.isPackaged
const electronObservability = createMainObservability()

function configurePackagedDeviceCardBuilder(): void {
  if (!app.isPackaged) return
  const executable = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
  const binaryPath = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'esbuild',
    'bin',
    executable
  )
  if (!existsSync(binaryPath)) {
    logLine(`Device Card Builder 缺少 esbuild binary: ${binaryPath}`)
    return
  }
  process.env['ESBUILD_BINARY_PATH'] = binaryPath
}

process.on('uncaughtException', (error) => {
  logLine(`uncaughtException: ${error instanceof Error ? error.stack : String(error)}`)
  electronObservability.record(
    'electron.process.uncaught_exception',
    { 'exception.type': error instanceof Error ? error.name : 'unknown' },
    error
  )
})
process.on('unhandledRejection', (reason) => {
  logLine(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
  electronObservability.record(
    'electron.process.unhandled_rejection',
    { 'exception.type': reason instanceof Error ? reason.name : 'unknown' },
    reason
  )
})
logLine(`main 加载 electron=${process.versions.electron ?? 'unknown'} node=${process.versions.node}`)
electronObservability.record('electron.app.loaded')

// electron-vite 的开发态 main bundle 位于 out/main；本地图标保留在
// apps/desktop/build。安装包继续由 electron-builder 的 icns/png 配置负责。
const localAppIcon = join(__dirname, '../../build/icon.png')

// 主窗口引用,供 OAuth 弹窗作为模态父窗口使用
let mainWindow: BrowserWindow | null = null
let localRuntimeManager: LocalRuntimeManager | null = null
let quitCleanupStarted = false
let quitCleanupFinished = false
let quitCleanupPromise: Promise<void> | null = null
let deviceCardManager: DeviceCardManager | null = null
let deviceCardAgentEnvironment: DeviceCardAgentEnvironment | null = null
let appUpdateManager: AppUpdateManager | null = null

function createWindow(): void {
  mainWindow = createDesktopWindow({
    baseDirectory: __dirname,
    isDevelopment: isDev,
    iconPath: localAppIcon,
    log: logLine,
    observability: electronObservability,
    onClosed: () => {
      mainWindow = null
    }
  })
}

/**
 * 完成 Electron 应用初始化，并把同一诊断日志会话注入本地运行管理器。
 *
 * @returns 初始化完成后无业务返回值。
 * @throws 关键初始化失败时拒绝 Promise，由 Electron 启动错误链路处理。
 * @safety IPC 处理器仍校验主渲染器身份；日志路径不接收渲染器输入。
 */
app.whenReady().then(async () => {
  logLine('app ready')
  electronObservability.record('electron.app.ready')
  configurePackagedDeviceCardBuilder()
  // macOS 开发态运行的是 Electron 可执行文件，BrowserWindow.icon 不会改变
  // Dock 图标；安装包则从 icon.icns 自动获得图标。
  if (isDev && process.platform === 'darwin') {
    app.dock.setIcon(localAppIcon)
  }
  ipcMain.handle('app:getVersion', () => app.getVersion())
  deviceCardManager = new DeviceCardManager({
    getMainWindow: () => mainWindow,
    preloadPath: join(__dirname, '../preload/deviceCard.js'),
    storeRoot: join(app.getPath('userData'), 'device-cards', 'artifacts'),
    workspaceRoot: join(app.getPath('userData'), 'device-cards', 'workspaces'),
    log: logLine
  })
  deviceCardManager.registerIpc()
  deviceCardAgentEnvironment = new DeviceCardAgentEnvironment({
    ipcMain,
    deviceCardManager,
    userDataPath: app.getPath('userData'),
    resourcesPath: process.resourcesPath,
    processExecutable: process.execPath,
    isPackaged: app.isPackaged,
    baseDirectory: __dirname,
    getMainWindow: () => mainWindow,
    log: logLine
  })
  await deviceCardAgentEnvironment.start()

  localRuntimeManager = new LocalRuntimeManager(
    join(app.getPath('logs'), 'local-runtime'),
    (snapshot) => {
      electronObservability.record('electron.runtime.state_changed', {
        'runtime.phase': snapshot.phase,
        'runtime.simulator_running': snapshot.simulatorRunning,
        'runtime.bridge_running': snapshot.bridgeRunning,
        'runtime.edge_running': snapshot.edgeRunning,
        'runtime.failed_process': snapshot.failedProcess,
        'runtime.error': snapshot.error
      })
      if (snapshot.phase === 'ready') void electronObservability.flush()
      const window = mainWindow
      if (window && !window.isDestroyed()) {
        window.webContents.send('runtime:snapshot', snapshot)
      }
    },
    DIAGNOSTIC_LOG_SESSION_ID
  )
  const localDeviceProvisioningManager = new LocalDeviceProvisioningManager(
    new LocalDeviceProvisioningStore(
      join(app.getPath('userData'), 'local-device-provisioning.json')
    ),
    localRuntimeManager,
    (items) => {
      const window = mainWindow
      if (window && !window.isDestroyed()) {
        window.webContents.send('device-provisioning:changed', items)
      }
    }
  )
  registerDeviceProvisioningIpc({
    ipcMain,
    manager: localDeviceProvisioningManager,
    getMainWindow: () => mainWindow,
    assertSender: assertMainWindowSender
  })

  appUpdateManager = new AppUpdateManager({
    currentVersion: app.getVersion(),
    enabled: app.isPackaged,
    updater: createElectronUpdaterAdapter(autoUpdater),
    log: logLine,
    publish: (snapshot) => {
      const window = mainWindow
      if (window && !window.isDestroyed()) {
        window.webContents.send('app-update:state', snapshot)
      }
    },
    confirmDownload: (snapshot) => confirmAppUpdateDownload(
      () => mainWindow,
      snapshot
    ),
    confirmInstall: (snapshot) => confirmAppUpdateInstall(
      () => mainWindow,
      snapshot
    ),
    beforeInstall: ensureQuitCleanup
  })
  registerAppUpdateIpc({
    ipcMain,
    manager: appUpdateManager,
    assertSender: assertMainWindowSender
  })
  appUpdateManager.start()

  ipcMain.handle(
    'runtime:selectPath',
    async (event, kind: LocalRuntimePathKind) => {
      assertMainWindowSender(event)
      const options = runtimePathDialogOptions(kind)
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] ?? null
    }
  )
  ipcMain.handle('runtime:getSnapshot', (event) => {
    assertMainWindowSender(event)
    return requireRuntimeManager().getSnapshot()
  })
  ipcMain.handle('runtime:getDefaultEnvironmentPath', async (event) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.discover_environment',
      {},
      () => discoverDefaultCondaEnvironment({ homeDirectory: homedir() })
    )
  })
  ipcMain.handle(
    'runtime:resolveGeneratedEdgeCommand',
    (event, payload: unknown) => {
      assertMainWindowSender(event)
      return resolveGeneratedEdgeCommand(payload)
    }
  )
  ipcMain.handle('runtime:startSimulator', async (event, payload: unknown) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.start',
      { 'runtime.target': 'simulator' },
      async () => {
        const config = parseRuntimeConfig(payload)
        electronObservability.record('electron.runtime.start_requested', {
          'runtime.target': 'simulator'
        })
        return requireRuntimeManager().startSimulator(config)
      }
    )
  })
  ipcMain.handle('runtime:stopSimulator', async (event) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.stop',
      { 'runtime.target': 'simulator' },
      () => requireRuntimeManager().stopSimulator()
    )
  })
  ipcMain.handle('runtime:startEdge', async (event, payload: unknown) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.start',
      { 'runtime.target': 'edge' },
      async () => {
        const config = parseRuntimeConfig(payload)
        electronObservability.record('electron.runtime.start_requested', {
          'runtime.target': 'edge'
        })
        await confirmCustomEdgeLaunch(config, mainWindow)
        return requireRuntimeManager().startEdge(config)
      }
    )
  })
  ipcMain.handle('runtime:stopEdge', async (event) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.stop',
      { 'runtime.target': 'edge' },
      () => requireRuntimeManager().stopEdge()
    )
  })
  ipcMain.handle('runtime:readLogs', async (event) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.read_logs',
      {},
      () => requireRuntimeManager().readLogs()
    )
  })
  ipcMain.handle('runtime:readLog', async (event, payload: unknown) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.read_log',
      {},
      () => requireRuntimeManager().readLog(parseRuntimeLogQuery(payload))
    )
  })
  ipcMain.handle('runtime:openLogFile', (event, payload: unknown) => {
    assertMainWindowSender(event)
    return openRuntimeLogDirectory(requireRuntimeManager(), payload)
  })

  ipcMain.handle('observability:getStatus', (event) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.observability.get_status',
      {},
      () => electronObservability.getStatus()
    )
  })
  ipcMain.handle('observability:listTraces', (event, query: unknown) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.observability.list_traces',
      {},
      () => electronObservability.listTraces(query)
    )
  })
  ipcMain.handle(
    'observability:getTrace',
    (event, traceId: unknown, query: unknown) => {
      assertMainWindowSender(event)
      return electronObservability.run(
        'electron.observability.get_trace',
        {},
        () => electronObservability.getTrace(traceId, query)
      )
    }
  )

  registerAuthIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    observability: electronObservability,
    log: logLine
  })
  registerFileIpc({ ipcMain, getMainWindow: () => mainWindow })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error) => {
  logLine(`whenReady 失败: ${error instanceof Error ? error.stack : String(error)}`)
  electronObservability.record('electron.app.ready_failed', {}, error)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (quitCleanupFinished) return
  event.preventDefault()
  if (quitCleanupStarted) return
  void ensureQuitCleanup().finally(() => {
    app.quit()
  })
})

/** 对普通退出与更新安装复用一次且仅一次的宿主清理。 */
function ensureQuitCleanup(): Promise<void> {
  if (quitCleanupFinished) return Promise.resolve()
  if (quitCleanupPromise) return quitCleanupPromise
  quitCleanupStarted = true
  quitCleanupPromise = cleanupBeforeQuit().finally(() => {
    quitCleanupFinished = true
  })
  return quitCleanupPromise
}

async function cleanupBeforeQuit(): Promise<void> {
  appUpdateManager?.dispose()
  try {
    deviceCardManager?.destroy()
  } catch (error) {
    logLine(
      `退出时销毁设备卡片管理器失败: ${error instanceof Error ? error.stack : String(error)}`
    )
  }
  try {
    await deviceCardAgentEnvironment?.stop()
  } catch (error) {
    logLine(
      `退出时停止 Agent Bridge 失败: ${error instanceof Error ? error.stack : String(error)}`
    )
  }
  const manager = localRuntimeManager
  try {
    if (manager && manager.getSnapshot().phase !== 'idle') {
      await electronObservability.run(
        'electron.runtime.stop_on_quit',
        {},
        () => manager.stop()
      )
    }
  } catch (error) {
    logLine(
      `退出时停止本地运行时失败: ${error instanceof Error ? error.stack : String(error)}`
    )
    electronObservability.record(
      'electron.runtime.stop_on_quit_failed',
      {},
      error
    )
  }
  electronObservability.record('electron.app.quit')
  await electronObservability.shutdown()
}

function createMainObservability(): ReturnType<
  typeof createElectronObservability
> {
  const common = {
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    homeDirectory: homedir(),
    log: logLine
  }
  try {
    return createElectronObservability(
      resolveElectronObservabilityOptions(common)
    )
  } catch (error) {
    logLine(
      `Trace 配置无效，已禁用远程上报: ${error instanceof Error ? error.message : String(error)}`
    )
    return createElectronObservability(
      resolveElectronObservabilityOptions({
        ...common,
        environment: { UNILABOS_TRACE_ENABLED: '0' }
      })
    )
  }
}

/**
 * 校验 IPC 同时来自主窗口 webContents 与主 frame，阻止未来嵌入 frame 继承本地进程权限。
 *
 * @param event Electron 主进程收到的调用事件。
 * @throws 当窗口、webContents 或 senderFrame 身份不匹配时抛出。
 */
function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('拒绝来自未知窗口的本地运行时请求')
  }
}

function requireRuntimeManager(): LocalRuntimeManager {
  if (!localRuntimeManager) throw new Error('本地运行时尚未初始化')
  return localRuntimeManager
}
