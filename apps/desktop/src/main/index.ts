import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  type IpcMainInvokeEvent
} from 'electron'
import { basename, join } from 'path'
import { appendFileSync, existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readSession, clearSession, runOAuthLogin } from './authManager'
import { DeviceCardManager } from './deviceCardManager'
import {
  DeviceCardAgentBridge,
  deviceCardAgentEndpoint
} from './deviceCardAgentBridge'
import { DeviceCardAgentCliManager } from './deviceCardAgentCli'
import { discoverDefaultCondaEnvironment } from './localRuntimeEnvironment'
import { LocalRuntimeManager } from './localRuntimeManager'
import {
  createElectronObservability,
  resolveElectronObservabilityOptions
} from './observability'
import type {
  LocalRuntimeLaunchConfig,
  LocalRuntimePathKind
} from '../shared/localRuntime'

// 保存文件的入参:path 为 null 时弹出"另存为"对话框
interface SaveFilePayload {
  path: string | null
  content: string
  defaultName?: string
}

interface SaveBinaryFilePayload {
  content: Uint8Array
  defaultName?: string
}

// 打开文件的入参:accept 指定对话框过滤的文件类型,缺省为 JSON
interface OpenFilePayload {
  accept?: 'json' | 'python'
}

// 诊断日志：写到家目录 ~/lab-pc-client.log，便于定位启动/渲染错误
const LOG_PATH = join(homedir(), 'lab-pc-client.log')
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
let deviceCardManager: DeviceCardManager | null = null
let deviceCardAgentBridge: DeviceCardAgentBridge | null = null
let deviceCardAgentCli: DeviceCardAgentCliManager | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Lab PC Client',
    ...(isDev ? { icon: localAppIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    logLine('window ready-to-show')
    electronObservability.record('electron.renderer.ready')
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine(`renderer 加载失败 code=${code} desc=${desc} url=${url}`)
    electronObservability.record(
      'electron.renderer.load_failed',
      {
        'renderer.error_code': code,
        'renderer.url': url
      },
      new Error(desc)
    )
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine(`renderer 进程退出: ${JSON.stringify(details)}`)
    electronObservability.record(
      'electron.renderer.process_gone',
      {
        'renderer.reason': details.reason,
        'process.exit_code': details.exitCode
      },
      new Error(`Renderer 进程退出：${details.reason}`)
    )
  })
  mainWindow.webContents.on(
    'console-message',
    (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        logLine(`renderer console: ${message} (${sourceId}:${line})`)
        electronObservability.record('electron.renderer.console', {
          'log.severity_number': level,
          'log.message': message,
          'code.filepath': sourceId,
          'code.lineno': line
        })
      }
    }
  )
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const window = mainWindow
    if (!window || window.isDestroyed()) return

    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['继续编辑', '放弃修改并关闭'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '工作流尚未保存',
      message: '工作流代码有未保存的修改。',
      detail: '关闭窗口将丢失这些修改。'
    })
    if (choice === 1) {
      electronObservability.record('electron.renderer.unsaved_changes_discarded')
      event.preventDefault()
    }
  })

  // Pascal 的工具栏图标与平面图光标使用站点根路径。在 Electron 的
  // file:// 页面中这些路径会落到系统根目录；这里只允许已知路径，
  // 并重定向到 Vite 打包资源，既兼容桌面端也避免任意路径访问。
  mainWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ['file:///icons/*', 'file:///cursor.svg'] },
    (details, callback) => {
      const requestedName = basename(
        fileURLToPath(new URL(details.url))
      )
      const assetDirectory = details.url.startsWith('file:///icons/')
        ? 'icons'
        : ''
      callback({
        redirectURL: pathToFileURL(
          join(
            __dirname,
            '../renderer',
            assetDirectory,
            requestedName
          )
        ).toString()
      })
    }
  )

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // In development load the Vite dev server URL, otherwise load the built file.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    logLine(`加载 dev 渲染地址: ${devServerUrl}`)
    void electronObservability
      .run(
        'electron.renderer.load',
        { 'renderer.mode': 'development', 'renderer.url': devServerUrl },
        () => mainWindow?.loadURL(devServerUrl) ?? Promise.resolve()
      )
      .catch((error) => {
        logLine(
          `加载 dev 渲染地址失败: ${error instanceof Error ? error.message : String(error)}`
        )
      })
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const file = join(__dirname, '../renderer/index.html')
    logLine(`加载生产渲染文件: ${file}`)
    void electronObservability
      .run(
        'electron.renderer.load',
        { 'renderer.mode': 'production' },
        () => mainWindow?.loadFile(file) ?? Promise.resolve()
      )
      .catch((error) => {
        logLine(
          `加载生产渲染文件失败: ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }
}

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
  const agentRoot = join(
    app.getPath('userData'),
    'device-cards',
    'agent'
  )
  deviceCardAgentBridge = new DeviceCardAgentBridge({
    automation: deviceCardManager.authoring,
    agentRoot,
    endpoint: deviceCardAgentEndpoint(app.getPath('userData')),
    log: logLine
  })
  if (await readAgentBridgeEnabled(agentRoot)) {
    await deviceCardAgentBridge.start()
  }
  const cliPath = app.isPackaged
    ? join(process.resourcesPath, 'device-card-agent', 'cli.mjs')
    : join(
        __dirname,
        '../../../../packages/device-card-agent-cli/dist/cli.mjs'
      )
  deviceCardAgentCli = new DeviceCardAgentCliManager({
    cliPath,
    descriptorPath: deviceCardAgentBridge.descriptorPath,
    electronExecutable: process.execPath
  })
  ipcMain.handle('device-cards:agent:getInfo', (event) => {
    assertMainRenderer(event.sender.id)
    return getDeviceCardAgentEnvironmentInfo()
  })
  ipcMain.handle('device-cards:agent:installCli', async (event) => {
    assertMainRenderer(event.sender.id)
    await deviceCardAgentCli?.install()
    return getDeviceCardAgentEnvironmentInfo()
  })
  ipcMain.handle('device-cards:agent:removeCli', async (event) => {
    assertMainRenderer(event.sender.id)
    await deviceCardAgentCli?.remove()
    return getDeviceCardAgentEnvironmentInfo()
  })
  ipcMain.handle(
    'device-cards:agent:setBridgeEnabled',
    async (event, enabled: unknown) => {
      assertMainRenderer(event.sender.id)
      if (typeof enabled !== 'boolean') {
        throw new Error('Agent Bridge enabled 参数无效。')
      }
      if (enabled) {
        await deviceCardAgentBridge?.start()
      } else {
        await deviceCardAgentBridge?.stop()
      }
      await writeAgentBridgeEnabled(agentRoot, enabled)
      return getDeviceCardAgentEnvironmentInfo()
    }
  )

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
    }
  )

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

  // 读取当前登录会话(启动/刷新时使用)
  ipcMain.handle('auth:getSession', () => readSession())

  // 发起 Bohrium OAuth 登录(与 web 登录方式一致)
  ipcMain.handle('auth:login', async () => {
    return electronObservability.run('electron.auth.login', {}, async () => {
      try {
        return await runOAuthLogin(mainWindow)
      } catch (error) {
        logLine(`OAuth 登录失败: ${error instanceof Error ? error.stack : String(error)}`)
        throw error
      }
    })
  })

  // 登出:清除本地会话与 token cookie
  ipcMain.handle('auth:logout', async () => {
    return electronObservability.run('electron.auth.logout', {}, async () => {
      await clearSession()
      return true
    })
  })

  // 打开本地文件:弹出选择框并读取文本内容。
  // accept 指定过滤的文件类型: 'json'(默认) 仅 .json, 'python' 仅 .py。
  ipcMain.handle('file:open', async (_event, payload?: OpenFilePayload) => {
    const isPython = payload?.accept === 'python'
    const options: Electron.OpenDialogOptions = {
      title: isPython ? '打开 Python 文件' : '打开 JSON 文件',
      filters: isPython
        ? [{ name: 'Python', extensions: ['py'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    return { path: filePath, content }
  })

  // 保存文本到本地文件:有 path 时直接写回,否则弹出"另存为"
  ipcMain.handle('file:save', async (_event, payload: SaveFilePayload) => {
    let filePath = payload.path
    if (!filePath) {
      const options: Electron.SaveDialogOptions = {
        title: '保存 JSON 文件',
        defaultPath: payload.defaultName || 'station.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      filePath = result.filePath
    }
    await writeFile(filePath, payload.content, 'utf-8')
    return { path: filePath }
  })

  // 保存由受信任 renderer 生成的二进制交付物。始终通过对话框选择目标，
  // renderer 不能借此直接覆盖任意本地路径。
  ipcMain.handle(
    'file:saveBinary',
    async (event, payload: SaveBinaryFilePayload) => {
      if (event.sender.id !== mainWindow?.webContents.id) {
        throw new Error('二进制保存调用方不是主渲染进程。')
      }
      if (
        !payload ||
        !(payload.content instanceof Uint8Array) ||
        payload.content.byteLength === 0 ||
        payload.content.byteLength > 10 * 1024 * 1024
      ) {
        throw new Error('二进制文件无效或超过 10 MiB。')
      }
      const defaultName = basename(
        payload.defaultName || 'unilab-card-kit.zip'
      )
      const options: Electron.SaveDialogOptions = {
        title: '保存卡片开发包',
        defaultPath: defaultName,
        filters: [{
          name: '卡片开发包',
          extensions: ['zip']
        }]
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, payload.content)
      return { path: result.filePath }
    }
  )

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
  quitCleanupStarted = true
  void cleanupBeforeQuit().finally(() => {
    quitCleanupFinished = true
    app.quit()
  })
})

async function cleanupBeforeQuit(): Promise<void> {
  try {
    deviceCardManager?.destroy()
  } catch (error) {
    logLine(
      `退出时销毁设备卡片管理器失败: ${error instanceof Error ? error.stack : String(error)}`
    )
  }
  try {
    await deviceCardAgentBridge?.stop()
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

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('拒绝来自未知窗口的本地运行时请求')
  }
}

function requireRuntimeManager(): LocalRuntimeManager {
  if (!localRuntimeManager) throw new Error('本地运行时尚未初始化')
  return localRuntimeManager
}

function runtimePathDialogOptions(
  kind: LocalRuntimePathKind
): Electron.OpenDialogOptions {
  if (kind === 'graph') {
    return {
      title: '选择设备图 JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    }
  }
  const titles: Record<Exclude<LocalRuntimePathKind, 'graph'>, string> = {
    os: '选择 Uni-Lab-OS 项目根目录',
    szlab: '选择领域项目根目录（以 Uni-Lab-SZLab 为例）',
    environment: '选择 unilab Conda 环境目录',
    simulator: '选择 PLC-Sim 项目根目录'
  }
  if (!(kind in titles)) throw new Error('不支持的本地运行时路径类型')
  return {
    title: titles[kind as Exclude<LocalRuntimePathKind, 'graph'>],
    properties: ['openDirectory']
  }
}

function parseRuntimeConfig(value: unknown): LocalRuntimeLaunchConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('本地运行时启动配置无效')
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.graphPath !== 'string' ||
    typeof candidate.osProjectPath !== 'string' ||
    typeof candidate.szlabProjectPath !== 'string' ||
    typeof candidate.environmentPath !== 'string' ||
    typeof candidate.simulatorProjectPath !== 'string'
  ) {
    throw new Error('本地运行时启动配置字段不完整')
  }
  return {
    graphPath: candidate.graphPath,
    osProjectPath: candidate.osProjectPath,
    szlabProjectPath: candidate.szlabProjectPath,
    environmentPath: candidate.environmentPath,
    simulatorProjectPath: candidate.simulatorProjectPath
  }
}

function assertMainRenderer(senderId: number): void {
  if (!mainWindow || mainWindow.isDestroyed() ||
    senderId !== mainWindow.webContents.id) {
    throw new Error('IPC 调用方不是主渲染进程。')
  }
}

async function getDeviceCardAgentEnvironmentInfo() {
  const info = await deviceCardAgentCli?.getInfo(
    deviceCardAgentBridge?.getInfo().enabled ?? false
  )
  return info
    ? {
        ...info,
        recentRequests: deviceCardAgentBridge?.getRecentRequests() ?? []
      }
    : null
}

async function readAgentBridgeEnabled(agentRoot: string): Promise<boolean> {
  try {
    const settings = JSON.parse(
      await readFile(join(agentRoot, 'settings.json'), 'utf8')
    ) as { enabled?: unknown }
    return settings.enabled !== false
  } catch {
    return true
  }
}

async function writeAgentBridgeEnabled(
  agentRoot: string,
  enabled: boolean
): Promise<void> {
  await mkdir(agentRoot, { recursive: true, mode: 0o700 })
  await writeFile(
    join(agentRoot, 'settings.json'),
    `${JSON.stringify({ enabled }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}
