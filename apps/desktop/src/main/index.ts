import {
  app,
  shell,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  type MenuItemConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { basename, dirname, join } from 'path'
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
import {
  createDiagnosticLogSessionId,
  openLocalRuntimeLogDirectory,
  resolveDesktopMainLogPath
} from './diagnosticLogSession'
import { discoverDefaultCondaEnvironment } from './localRuntimeEnvironment'
import { registerDeviceProvisioningIpc } from './deviceProvisioningIpc'
import { LocalDeviceProvisioningManager } from './localDeviceProvisioningManager'
import { LocalDeviceProvisioningStore } from './localDeviceProvisioningStore'
import {
  ManagedRuntimeInstallation,
  resolveManagedRuntimeDataDirectory
} from './managedRuntimeInstallation'
import { registerManagedRuntimeInstallationIpc } from './managedRuntimeInstallationIpc'
import {
  LocalRuntimeManager,
  resolveLocalRuntimeLaunchPlan
} from './localRuntimeManager'
import { ManagedRuntime } from './managedRuntime'
import { DevicePackageTrustStore } from './devicePackageTrust'
import {
  createElectronObservability,
  resolveElectronObservabilityOptions
} from './observability'
import {
  resolveUnsavedUnloadAction,
  validateRendererUnsavedChanges
} from './unsavedChangesGuard'
import type {
  LocalRuntimeLaunchConfig,
  LocalRuntimeOpenLogResult,
  LocalRuntimeLogQuery,
  LocalRuntimePathKind
} from '../shared/localRuntime'
import {
  isDesktopSurfaceNavigationAllowed,
  resolveDesktopSurfaceConfig,
  shouldPromptForRendererUnload,
  shouldQuitWhenAllDesktopWindowsClose
} from './desktopSurface'
import { RendererConsoleLogLimiter } from './rendererConsoleLogLimiter'
import { cleanupPackagedWorkbench, configurePackagedDeviceCardBuilder } from './packagedRuntime'
import { isWorkbenchWorkspaceNavigationAllowed, registerWorkbenchRemoteAccessIpc, workbenchUnloadPrompt } from './workbenchRemoteIpc'

const UNILAB_APPLICATION_NAME = 'Unilab 调试工作台'

/**
 * 构造 macOS 原生应用菜单。产品不暴露文件与帮助菜单，其余可见项统一中文化。
 */
function createMacApplicationMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: UNILAB_APPLICATION_NAME,
      submenu: [
        { role: 'about', label: `关于 ${UNILAB_APPLICATION_NAME}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${UNILAB_APPLICATION_NAME}` },
        { role: 'hideOthers', label: '隐藏其他应用' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${UNILAB_APPLICATION_NAME}` }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ]
}

// 开发态默认继承 Electron 可执行文件名；必须在 ready 前设置，macOS
// 才会用产品名称生成应用菜单。
process.title = UNILAB_APPLICATION_NAME
app.setName(UNILAB_APPLICATION_NAME)

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

// 本次应用生命周期只创建一个日志会话，供主进程和本地运行子进程共同使用。
const DIAGNOSTIC_LOG_SESSION_ID = createDiagnosticLogSessionId()
// 主日志保持位于家目录，兼容既有安装包中的故障排查路径。
const LOG_PATH = resolveDesktopMainLogPath(
  homedir(),
  DIAGNOSTIC_LOG_SESSION_ID
)
let remoteLogSink: ((message: string) => void) | undefined

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
  try {
    remoteLogSink?.(message)
  } catch {
    // 遥测必须保持 fail-open，不能影响主进程及本地文件日志。
  }
}

const isDev = !app.isPackaged
const desktopSurface = resolveDesktopSurfaceConfig({
  environment: process.env,
  isDevelopment: isDev
})
const rendererConsoleLogLimiter = new RendererConsoleLogLimiter({
  limit: 20,
  windowMs: 10_000
})
const electronObservability = createMainObservability()
remoteLogSink = (message) => electronObservability.log(message)

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
logLine(`main 加载 electron=${process.versions.electron ?? 'unknown'} node=${process.versions.node} surface=${desktopSurface.kind}`)
electronObservability.record('electron.app.loaded', {
  'desktop.surface': desktopSurface.kind
})

// electron-vite 的开发态 main bundle 位于 out/main；本地图标保留在
// apps/desktop/build。安装包继续由 electron-builder 的 icns/png 配置负责。
const localAppIcon = join(__dirname, '../../build/icon.png')

// 主窗口引用,供 OAuth 弹窗作为模态父窗口使用
let mainWindow: BrowserWindow | null = null
let localRuntimeManager: LocalRuntimeManager | null = null
let devicePackageTrustStore: DevicePackageTrustStore | null = null
let quitCleanupStarted = false
let quitCleanupFinished = false
let deviceCardManager: DeviceCardManager | null = null
let deviceCardAgentBridge: DeviceCardAgentBridge | null = null
let deviceCardAgentCli: DeviceCardAgentCliManager | null = null
let rendererHasUnsavedChanges: boolean | null = null
let workflowHasUnsavedChanges = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...desktopSurface.window,
    show: false,
    autoHideMenuBar: true,
    title: desktopSurface.title,
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
    workflowHasUnsavedChanges = false
    mainWindow = null
    rendererHasUnsavedChanges = null
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
      if (message.startsWith('[joint-preview]')) {
        const diagnostic = message.slice(0, 2_000)
        // 关节链路诊断同时进入启动终端和本次会话日志；消息本身不含数值或路径。
        console.info(`[renderer] ${diagnostic}`)
        if (level < 2) logLine(`renderer ${diagnostic}`)
      }
      if (level >= 2) {
        rendererConsoleLogLimiter.record(
          { level, message, line, sourceId },
          logLine,
          electronObservability
        )
      }
    }
  )
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const hasUnsavedChanges =
      rendererHasUnsavedChanges === true || workflowHasUnsavedChanges
    if (!shouldPromptForRendererUnload(
      desktopSurface.kind,
      hasUnsavedChanges
    )) {
      // Electron's will-prevent-unload contract is inverted: preventing this
      // event allows the renderer navigation/close to continue.
      event.preventDefault()
      return
    }
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    const unloadState =
      rendererHasUnsavedChanges === null && !workflowHasUnsavedChanges
        ? null
        : hasUnsavedChanges
    if (resolveUnsavedUnloadAction(unloadState) === 'allow') {
      electronObservability.record('electron.renderer.clean_unload_allowed')
      event.preventDefault()
      return
    }

    const prompt = workbenchUnloadPrompt()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: prompt.buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '工作流尚未保存',
      message: '工作流代码有未保存的修改。',
      detail: prompt.detail
    })
    if (choice === 1) {
      workflowHasUnsavedChanges = false
      rendererHasUnsavedChanges = false
      electronObservability.record(prompt.discardedEvent)
      event.preventDefault()
    }
  })

  mainWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        workflowHasUnsavedChanges = false
        rendererHasUnsavedChanges = null
      }
    }
  )

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

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (isDesktopSurfaceNavigationAllowed(desktopSurface, targetUrl) || isWorkbenchWorkspaceNavigationAllowed(targetUrl)) return
    event.preventDefault()
    logLine(`阻止 Workbench renderer 跨 origin 导航: ${targetUrl}`)
    if (/^https?:/u.test(targetUrl)) void shell.openExternal(targetUrl)
  })

  // Workbench uses its managed loopback Theia server. Kernel Web keeps the
  // existing electron-vite development and packaged renderer paths.
  const rendererUrl = desktopSurface.rendererUrl
    ?? (isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined)
  if (rendererUrl) {
    const rendererMode = desktopSurface.kind === 'workbench'
      ? 'workbench'
      : 'development'
    logLine(`加载 ${rendererMode} 渲染地址: ${rendererUrl}`)
    void electronObservability
      .run(
        'electron.renderer.load',
        { 'renderer.mode': rendererMode, 'renderer.url': rendererUrl },
        () => mainWindow?.loadURL(rendererUrl) ?? Promise.resolve()
      )
      .catch((error) => {
        logLine(
          `加载 ${rendererMode} 渲染地址失败: ${error instanceof Error ? error.message : String(error)}`
        )
      })
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
  if (desktopSurface.openDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

/**
 * 完成 Electron 应用初始化，并把同一诊断日志会话注入本地运行管理器。
 *
 * @returns 初始化完成后无业务返回值。
 * @throws 关键初始化失败时拒绝 Promise，由 Electron 启动错误链路处理。
 * @safety IPC 处理器仍校验主渲染器身份；日志路径不接收渲染器输入。
 */
app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate(createMacApplicationMenu()))
  }
  logLine('app ready')
  electronObservability.record('electron.app.ready')
  configurePackagedDeviceCardBuilder({
    isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, log: logLine
  })
  // macOS 开发态运行的是 Electron 可执行文件，BrowserWindow.icon 不会改变
  // Dock 图标；安装包则从 icon.icns 自动获得图标。
  if (isDev && process.platform === 'darwin') {
    app.dock.setIcon(localAppIcon)
  }
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.on('renderer:unsavedChanges', (event, value: unknown) => {
    try {
      assertMainWindowSender(event)
      rendererHasUnsavedChanges = validateRendererUnsavedChanges(value)
    } catch (error) {
      logLine(
        `忽略无效的未保存状态上报：${error instanceof Error
          ? error.message
          : String(error)}`
      )
    }
  })
  ipcMain.on(
    'workflow-authoring:setUnsavedChanges',
    (event, value: unknown) => {
      if (
        event.sender !== mainWindow?.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        return
      }
      if (typeof value !== 'boolean') return
      workflowHasUnsavedChanges = value
    }
  )
  registerWorkbenchRemoteAccessIpc({ observability: electronObservability, assertSender: assertMainWindowSender, getMainWindow: () => mainWindow })
  const managedRuntimeInstallation = registerManagedRuntimeInstallationIpc({
    ipcMain,
    installation: createManagedRuntimeInstallation(),
    discoverExistingEnvironment: () => discoverDefaultCondaEnvironment({
      homeDirectory: homedir()
    }),
    assertSender: assertMainWindowSender,
    getMainWindow: () => mainWindow,
    onEnvironmentReady: environmentPath => {
      process.env['UNILAB_MANAGED_RUNTIME_PREFIX'] = environmentPath
    },
    log: logLine
  })
  await managedRuntimeInstallation.initialize()
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

  const localRuntimeLogsDirectory = join(
    app.getPath('logs'),
    'local-runtime'
  )
  const managedRuntime = createManagedRuntime(join(
    app.getPath('userData'),
    'managed-runtime',
    'supervisor'
  ))
  devicePackageTrustStore = new DevicePackageTrustStore(join(
    app.getPath('userData'),
    'device-package-trust'
  ))
  localRuntimeManager = new LocalRuntimeManager(
    localRuntimeLogsDirectory,
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
    DIAGNOSTIC_LOG_SESSION_ID,
    managedRuntime
      ? {
          managedRuntime,
          managedWorkingRoot: join(
            app.getPath('userData'),
            'managed-runtime',
            'workspaces'
          )
        }
      : {}
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
  ipcMain.handle('runtime:getModeInfo', (event) => {
    assertMainWindowSender(event)
    return requireRuntimeManager().getModeInfo()
  })
  ipcMain.handle(
    'runtime:inspectDevicePackage',
    async (event, payload: unknown) => {
      assertMainWindowSender(event)
      const config = parseRuntimeConfig(payload)
      return requireDevicePackageTrustStore().inspect(
        config.szlabProjectPath
      )
    }
  )
  ipcMain.handle(
    'runtime:confirmDevicePackage',
    async (event, payload: unknown, expectedHash: unknown) => {
      assertMainWindowSender(event)
      if (
        typeof expectedHash !== 'string'
        || !/^[0-9a-f]{64}$/.test(expectedHash)
      ) {
        throw new Error('设备包内容哈希无效')
      }
      const config = parseRuntimeConfig(payload)
      return requireDevicePackageTrustStore().confirm(
        config.szlabProjectPath,
        expectedHash
      )
    }
  )
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
    handleResolveGeneratedEdgeCommand
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
        if ((await requireRuntimeManager().getModeInfo()).mode === 'development') {
          await confirmCustomEdgeLaunch(config)
        }
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
  ipcMain.handle('runtime:runAcceptance', async (event, payload: unknown) => {
    assertMainWindowSender(event)
    return electronObservability.run(
      'electron.runtime.acceptance',
      {},
      () => requireRuntimeManager().runAcceptance(
        parseRuntimeConfig(payload)
      )
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
  ipcMain.handle('runtime:openLogFile', handleOpenLocalRuntimeLogDirectory)

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
  ipcMain.handle('observability:recordHttpRequest', (event, payload: unknown) => {
    assertMainWindowSender(event)
    electronObservability.recordHttpRequestTrace(payload)
  })

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
  if (shouldQuitWhenAllDesktopWindowsClose(
    process.platform,
    desktopSurface.kind
  )) {
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
    if (
      manager
      && !manager.persistsAfterAppQuit()
      && manager.getSnapshot().phase !== 'idle'
    ) {
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
  await cleanupPackagedWorkbench({
    enabled: desktopSurface.kind === 'workbench',
    observability: electronObservability,
    log: logLine
  })
  electronObservability.record('electron.app.quit')
  await electronObservability.shutdown()
}

/**
 * 在安装包或显式测试载荷存在时创建私有运行时（Runtime）控制面。
 *
 * @param supervisorStateDirectory 独立 Supervisor 持久状态目录。
 * @returns 托管 Runtime；开发态没有载荷时返回 undefined。
 * @throws 安装包缺少 manifest 时阻止启动，避免静默退回源码模式。
 * @safety 载荷根只来自 Electron resources 或主进程测试环境变量。
 */
function createManagedRuntime(
  supervisorStateDirectory: string
): ManagedRuntime | undefined {
  const resourcesDirectory = process.env['UNILAB_MANAGED_RUNTIME_RESOURCES']
    ?? (app.isPackaged ? process.resourcesPath : undefined)
  if (!resourcesDirectory) return undefined
  const manifestPath = join(
    resourcesDirectory,
    'runtime-installer',
    'manifest.json'
  )
  if (!existsSync(manifestPath)) {
    if (app.isPackaged) {
      throw new Error(`安装包缺少私有 Runtime manifest：${manifestPath}`)
    }
    return undefined
  }
  return new ManagedRuntime(
    new ManagedRuntimeInstallation({
      resourcesDirectory,
      dataDirectory: app.getPath('userData')
    }),
    supervisorStateDirectory
  )
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
function assertMainWindowSender(
  event: IpcMainInvokeEvent | IpcMainEvent
): void {
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

/** 返回应用生命周期内唯一的设备包信任存储。 */
function requireDevicePackageTrustStore(): DevicePackageTrustStore {
  if (!devicePackageTrustStore) throw new Error('设备包信任存储尚未初始化')
  return devicePackageTrustStore
}

/**
 * 从固定 Electron resources 构造一键安装器。开发态只有显式测试载荷时启用，
 * 安装包缺少载荷时保持 UI 可诊断，而不是隐式搜索源码仓库。
 */
function createManagedRuntimeInstallation(): ManagedRuntimeInstallation | undefined {
  const resourcesDirectory = process.env['UNILAB_MANAGED_RUNTIME_RESOURCES']
    ?? (app.isPackaged ? process.resourcesPath : undefined)
  if (!resourcesDirectory) return undefined
  const manifestPath = join(
    resourcesDirectory,
    'runtime-installer',
    'manifest.json'
  )
  if (!existsSync(manifestPath)) {
    logLine(`未发现内置 Runtime manifest: ${manifestPath}`)
    return undefined
  }
  return new ManagedRuntimeInstallation({
    resourcesDirectory,
    dataDirectory: resolveManagedRuntimeDataDirectory({
      platform: process.platform,
      homeDirectory: homedir(),
      userDataDirectory: app.getPath('userData')
    })
  })
}

/**
 * 构造本地运行时受控路径选择器，确保渲染器只能请求已声明的文件或目录类型。
 *
 * @param kind 渲染器请求选择的本地运行时路径类别。
 * @returns 与类别匹配的系统文件对话框配置。
 * @throws 当类别不在共享闭集中时抛出。
 */
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
  if (kind === 'edgeExecutable') {
    return {
      title: '选择 Edge 自定义可执行文件',
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'Windows 可执行文件', extensions: ['exe'] }] }
        : {}),
      properties: ['openFile']
    }
  }
  const titles: Record<
    Exclude<LocalRuntimePathKind, 'graph' | 'edgeExecutable'>,
    string
  > = {
    os: '选择 Uni-Lab-OS 项目根目录',
    szlab: '选择领域项目根目录（以 Uni-Lab-SZLab 为例）',
    environment: '选择 unilab Conda 环境目录',
    simulator: '选择 PLC-Sim 项目根目录',
    edgeWorkingDirectory: '选择 Edge 自定义工作目录'
  }
  if (!(kind in titles)) throw new Error('不支持的本地运行时路径类型')
  return {
    title: titles[kind as Exclude<
      LocalRuntimePathKind,
      'graph' | 'edgeExecutable'
    >],
    properties: kind === 'simulator'
      ? ['openFile', 'openDirectory']
      : ['openDirectory']
  }
}

/**
 * 校验并复制渲染器提交的本地运行配置，不信任 localStorage 或 IPC 载荷形状。
 *
 * @param value IPC 收到的未知配置值。
 * @returns 字段完整且自定义参数逐项为字符串的启动配置。
 * @throws 当字段缺失、模式非法或自定义命令结构无效时抛出。
 */
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
    typeof candidate.simulatorProjectPath !== 'string' ||
    !['generated', 'custom'].includes(String(candidate.edgeCommandMode))
  ) {
    throw new Error('本地运行时启动配置字段不完整')
  }
  const customEdgeCommand = parseCustomEdgeCommand(candidate.customEdgeCommand)
  return {
    graphPath: candidate.graphPath,
    osProjectPath: candidate.osProjectPath,
    szlabProjectPath: candidate.szlabProjectPath,
    environmentPath: candidate.environmentPath,
    simulatorProjectPath: candidate.simulatorProjectPath,
    edgeCommandMode: candidate.edgeCommandMode as 'generated' | 'custom',
    customEdgeCommand
  }
}

/**
 * 收窄用户自定义 Edge 命令，避免对象原型或非字符串参数跨越 preload seam。
 *
 * @param value IPC 载荷中的自定义命令候选值。
 * @returns 仅包含可执行文件、工作目录、字符串参数和 name/value 环境变量副本的命令配置。
 * @throws 当候选不是普通对象或任一结构化字段类型不正确时抛出。
 */
function parseCustomEdgeCommand(
  value: unknown
): LocalRuntimeLaunchConfig['customEdgeCommand'] {
  if (!value || typeof value !== 'object') {
    throw new Error('Edge 自定义启动命令无效')
  }
  const candidate = value as Record<string, unknown>
  const environment = candidate.environment
  if (
    typeof candidate.executable !== 'string'
    || (candidate.workingDirectory !== undefined
      && typeof candidate.workingDirectory !== 'string')
    || !Array.isArray(candidate.args)
    || !candidate.args.every((argument) => typeof argument === 'string')
    || (environment !== undefined && (
      !Array.isArray(environment)
      || !environment.every((entry) => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as Record<string, unknown>).name === 'string'
        && typeof (entry as Record<string, unknown>).value === 'string'
      ))
    ))
  ) {
    throw new Error('Edge 自定义启动命令字段不完整')
  }
  return {
    executable: candidate.executable,
    workingDirectory: typeof candidate.workingDirectory === 'string'
      ? candidate.workingDirectory
      : '{{workspace}}',
    args: [...candidate.args],
    environment: (environment ?? []).map((entry) => ({
      name: (entry as Record<string, string>).name,
      value: (entry as Record<string, string>).value
    }))
  }
}

/**
 * 解析当前路径对应的系统生成式 Edge 命令，供用户显式复制后再编辑。
 *
 * @param event Electron 主进程收到的 IPC 调用事件。
 * @param payload renderer 提交的未知本地运行配置。
 * @returns 由主进程权威解析的 executable、argv 与工作目录预览。
 * @throws 当发送方、配置、项目结构或默认可执行文件校验失败时抛出。
 */
async function handleResolveGeneratedEdgeCommand(
  event: IpcMainInvokeEvent,
  payload: unknown
): Promise<{ executable: string; args: string[]; cwd: string }> {
  assertMainWindowSender(event)
  const config = parseRuntimeConfig(payload)
  const plan = await resolveLocalRuntimeLaunchPlan({
    ...config,
    edgeCommandMode: 'generated'
  })
  return {
    executable: plan.edge.command,
    args: [...plan.edge.args],
    cwd: plan.edge.cwd
  }
}

/**
 * 在每次执行任意自定义程序前显示主进程原生确认，renderer 不能伪造批准结果。
 *
 * @param config 已通过 IPC schema 校验的本地运行配置。
 * @returns 用户批准系统默认命令或本次自定义启动时正常完成。
 * @throws 当用户取消、自定义命令校验失败或窗口已销毁时抛出。
 */
async function confirmCustomEdgeLaunch(
  config: LocalRuntimeLaunchConfig
): Promise<void> {
  if (config.edgeCommandMode !== 'custom') return
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('主窗口不可用，无法确认 Edge 自定义启动命令')
  }
  const plan = await resolveLocalRuntimeLaunchPlan(config)
  const detailLines = [
    `可执行文件：${plan.edge.command}`,
    `工作目录：${plan.edge.cwd}`,
    '',
    '参数：',
    ...plan.edge.args.slice(0, 24).map(
      (argument, index) => `${index + 1}. ${truncateDialogValue(argument)}`
    ),
    ...(plan.edge.args.length > 24
      ? [`… 另有 ${plan.edge.args.length - 24} 项参数未展开显示`]
      : []),
    '',
    '环境变量覆盖：',
    ...(config.customEdgeCommand.environment.length > 0
      ? config.customEdgeCommand.environment.slice(0, 16).map(
          ({ name, value }) => `${name}=${truncateDialogValue(value)}`
        )
      : ['无']),
    ...(config.customEdgeCommand.environment.length > 16
      ? [`… 另有 ${config.customEdgeCommand.environment.length - 16} 项未展开显示`]
      : [])
  ]
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '确认自定义 Edge 启动命令',
    message: '此配置将启动你指定的本地程序',
    detail: detailLines.join('\n'),
    buttons: ['允许本次启动', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (result.response !== 0) throw new Error('已取消 Edge 自定义命令启动')
}

/**
 * 限制原生确认对话框中单个参数的显示长度，防止超长 argv 淹没安全提示。
 *
 * @param value 已解析的单个命令参数。
 * @returns 最多保留 300 个字符的诊断文本。
 */
function truncateDialogValue(value: string): string {
  return value.length <= 300 ? value : `${value.slice(0, 300)}…`
}

/** 校验渲染器日志来源，只接受主进程固定映射的来源枚举。 */
function parseRuntimeLogKind(value: unknown): 'simulator' | 'edge' {
  if (value !== 'simulator' && value !== 'edge') {
    throw new Error('不支持的本地运行日志来源')
  }
  return value
}

/** 校验有界增量读取游标，防止无效偏移进入主进程文件操作。 */
function parseRuntimeLogQuery(value: unknown): LocalRuntimeLogQuery {
  if (!value || typeof value !== 'object') {
    throw new Error('本地运行日志读取参数无效')
  }
  const candidate = value as Record<string, unknown>
  const kind = parseRuntimeLogKind(candidate.kind)
  if (candidate.cursor === null) return { kind, cursor: null }
  if (!candidate.cursor || typeof candidate.cursor !== 'object') {
    throw new Error('本地运行日志游标无效')
  }
  const cursor = candidate.cursor as Record<string, unknown>
  if (
    typeof cursor.fileId !== 'string'
    || !cursor.fileId
    || !Number.isSafeInteger(cursor.offset)
    || Number(cursor.offset) < 0
  ) {
    throw new Error('本地运行日志游标无效')
  }
  return {
    kind,
    cursor: { fileId: cursor.fileId, offset: Number(cursor.offset) }
  }
}

/**
 * 处理受信任渲染器的“打开日志目录”请求。
 *
 * @param event Electron IPC 调用事件，用于验证主渲染器身份。
 * @param payload 兼容现有协议的固定日志来源，不包含任意路径。
 * @returns 系统文件管理器是否成功打开当前实际日志目录。
 * @throws IPC 调用方或日志来源非法时失败关闭。
 * @safety 目录由 LocalRuntimeManager 解析，渲染器无法指定文件系统位置。
 */
async function handleOpenLocalRuntimeLogDirectory(
  event: IpcMainInvokeEvent,
  payload: unknown
): Promise<LocalRuntimeOpenLogResult> {
  assertMainWindowSender(event)
  const kind = parseRuntimeLogKind(payload)
  const logsDirectory = dirname(requireRuntimeManager().getLogPath(kind))
  return openLocalRuntimeLogDirectory(logsDirectory, {
    createDirectory: createLocalRuntimeLogsDirectory,
    openPath: openLocalRuntimeLogsPath
  })
}

/**
 * 创建 Electron 管理的本地运行日志目录。
 *
 * @param logsDirectory 主进程解析出的当前日志目录。
 * @returns 目录存在后完成的 Promise。
 * @throws 文件系统拒绝创建目录时透传异常，由上层转换为界面提示。
 * @safety recursive 只作用于主进程固定目录，不接受渲染器路径。
 */
async function createLocalRuntimeLogsDirectory(
  logsDirectory: string
): Promise<void> {
  await mkdir(logsDirectory, { recursive: true })
}

/**
 * 使用当前平台的系统文件管理器打开本地运行日志目录。
 *
 * @param logsDirectory 已安全创建的当前日志目录。
 * @returns Electron shell.openPath 的空成功文本或具体失败原因。
 * @throws 系统外壳调用异常时透传，由上层转换为界面提示。
 * @safety 只打开目录，不创建或锁定正在写入的日志文件。
 */
async function openLocalRuntimeLogsPath(
  logsDirectory: string
): Promise<string> {
  return shell.openPath(logsDirectory)
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
