import { basename, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, shell } from 'electron'

import type { ElectronObservability } from './observability'

interface DesktopWindowOptions {
  baseDirectory: string
  isDevelopment: boolean
  iconPath: string
  log: (message: string) => void
  observability: ElectronObservability
  onClosed: () => void
}

/**
 * 创建并加载唯一桌面主窗口，同时绑定渲染进程诊断与安全导航策略。
 *
 * @param options 窗口资源、日志、可观测性和关闭回调依赖。
 * @returns 已开始加载渲染页面的 Electron 主窗口。
 */
export function createDesktopWindow({
  baseDirectory,
  isDevelopment,
  iconPath,
  log,
  observability,
  onClosed
}: DesktopWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Lab PC Client',
    ...(isDevelopment ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(baseDirectory, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.webContents.setVisualZoomLevelLimits(1, 1)
  window.on('ready-to-show', () => {
    log('window ready-to-show')
    observability.record('electron.renderer.ready')
    window.show()
  })
  window.on('closed', onClosed)
  registerRendererDiagnostics(window, log, observability)
  registerDesktopNavigation(window, baseDirectory)
  loadRenderer(window, {
    baseDirectory,
    isDevelopment,
    log,
    observability
  })
  return window
}

/** 绑定渲染进程退出、加载失败、控制台错误和未保存修改保护。 */
function registerRendererDiagnostics(
  window: BrowserWindow,
  log: (message: string) => void,
  observability: ElectronObservability
): void {
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log(`renderer 加载失败 code=${code} desc=${description} url=${url}`)
    observability.record(
      'electron.renderer.load_failed',
      { 'renderer.error_code': code, 'renderer.url': url },
      new Error(description)
    )
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`renderer 进程退出: ${JSON.stringify(details)}`)
    observability.record(
      'electron.renderer.process_gone',
      {
        'renderer.reason': details.reason,
        'process.exit_code': details.exitCode
      },
      new Error(`Renderer 进程退出：${details.reason}`)
    )
  })
  window.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      if (level < 2) return
      log(`renderer console: ${message} (${sourceId}:${line})`)
      observability.record('electron.renderer.console', {
        'log.severity_number': level,
        'log.message': message,
        'code.filepath': sourceId,
        'code.lineno': line
      })
    }
  )
  window.webContents.on('will-prevent-unload', (event) => {
    if (window.isDestroyed()) return
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
    if (choice !== 1) return
    observability.record('electron.renderer.unsaved_changes_discarded')
    event.preventDefault()
  })
}

/** 将 Pascal 固定资源路径映射到桌面打包资源，并禁止新窗口接管导航。 */
function registerDesktopNavigation(
  window: BrowserWindow,
  baseDirectory: string
): void {
  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['file:///icons/*', 'file:///cursor.svg'] },
    (details, callback) => {
      const requestedName = basename(fileURLToPath(new URL(details.url)))
      const assetDirectory = details.url.startsWith('file:///icons/')
        ? 'icons'
        : ''
      callback({
        redirectURL: pathToFileURL(join(
          baseDirectory,
          '../renderer',
          assetDirectory,
          requestedName
        )).toString()
      })
    }
  )
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** 根据开发/生产模式加载 Vite 地址或打包后的渲染入口。 */
function loadRenderer(
  window: BrowserWindow,
  options: Pick<
    DesktopWindowOptions,
    'baseDirectory' | 'isDevelopment' | 'log' | 'observability'
  >
): void {
  const { baseDirectory, isDevelopment, log, observability } = options
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDevelopment && devServerUrl) {
    log(`加载 dev 渲染地址: ${devServerUrl}`)
    void observability.run(
      'electron.renderer.load',
      { 'renderer.mode': 'development', 'renderer.url': devServerUrl },
      () => window.loadURL(devServerUrl)
    ).catch((error) => logLoadFailure(log, 'dev 渲染地址', error))
    window.webContents.openDevTools({ mode: 'detach' })
    return
  }

  const file = join(baseDirectory, '../renderer/index.html')
  log(`加载生产渲染文件: ${file}`)
  void observability.run(
    'electron.renderer.load',
    { 'renderer.mode': 'production' },
    () => window.loadFile(file)
  ).catch((error) => logLoadFailure(log, '生产渲染文件', error))
}

/** 统一渲染入口加载失败的诊断文本。 */
function logLoadFailure(
  log: (message: string) => void,
  target: string,
  error: unknown
): void {
  log(`加载${target}失败: ${
    error instanceof Error ? error.message : String(error)
  }`)
}
