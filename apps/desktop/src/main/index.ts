import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, join } from 'path'
import { appendFileSync, existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readSession, clearSession, runOAuthLogin } from './authManager'
import { DeviceCardManager } from './deviceCardManager'

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
})
process.on('unhandledRejection', (reason) => {
  logLine(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
})
logLine(`main 加载 electron=${process.versions.electron ?? 'unknown'} node=${process.versions.node}`)

const isDev = !app.isPackaged
// electron-vite 的开发态 main bundle 位于 out/main；本地图标保留在
// apps/desktop/build。安装包继续由 electron-builder 的 icns/png 配置负责。
const localAppIcon = join(__dirname, '../../build/icon.png')

// 主窗口引用,供 OAuth 弹窗作为模态父窗口使用
let mainWindow: BrowserWindow | null = null
let deviceCardManager: DeviceCardManager | null = null

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
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    deviceCardManager?.destroy()
    mainWindow = null
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine(`renderer 加载失败 code=${code} desc=${desc} url=${url}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine(`renderer 进程退出: ${JSON.stringify(details)}`)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logLine(`renderer console: ${message} (${sourceId}:${line})`)
  })
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
    void mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    const file = join(__dirname, '../renderer/index.html')
    logLine(`加载生产渲染文件: ${file}`)
    void mainWindow.loadFile(file)
  }
}

app.whenReady().then(() => {
  logLine('app ready')
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
    log: logLine
  })
  deviceCardManager.registerIpc()

  // 读取当前登录会话(启动/刷新时使用)
  ipcMain.handle('auth:getSession', () => readSession())

  // 发起 Bohrium OAuth 登录(与 web 登录方式一致)
  ipcMain.handle('auth:login', async () => {
    try {
      return await runOAuthLogin(mainWindow)
    } catch (error) {
      logLine(`OAuth 登录失败: ${error instanceof Error ? error.stack : String(error)}`)
      throw error
    }
  })

  // 登出:清除本地会话与 token cookie
  ipcMain.handle('auth:logout', async () => {
    await clearSession()
    return true
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
        payload.defaultName || 'unilab-authoring-kit.zip'
      )
      const options: Electron.SaveDialogOptions = {
        title: '保存 Uni-Lab Authoring Kit',
        defaultPath: defaultName,
        filters: [{
          name: 'Uni-Lab Authoring Kit',
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
