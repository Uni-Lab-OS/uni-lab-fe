import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  WebContentsView
} from 'electron'
import {
  installDeviceCardArchive,
  listInstalledDeviceCards,
  verifyArtifactKey,
  type InstalledDeviceCardRecord
} from '@unilab/device-card-host'
import type {
  DeviceCardActionRun,
  DeviceCardBounds,
  DeviceCardHostActionRequest,
  DeviceCardRuntimeSnapshot,
  InstalledDeviceCard,
  JsonObject,
  OpenDeviceCardRequest
} from '@unilab/device-card-sdk'

interface RuntimeSession {
  view: WebContentsView
  record: InstalledDeviceCardRecord
  context: DeviceCardRuntimeSnapshot
  config: JsonObject
}

interface PendingAction {
  resolve: (run: DeviceCardActionRun) => void
  timer: ReturnType<typeof setTimeout>
}

export class DeviceCardManager {
  private readonly sessions = new Map<number, RuntimeSession>()
  private readonly pendingActions = new Map<string, PendingAction>()
  private activeView: WebContentsView | null = null

  constructor(private readonly options: {
    getMainWindow: () => BrowserWindow | null
    preloadPath: string
    storeRoot: string
    log: (message: string) => void
  }) {}

  registerIpc(): void {
    ipcMain.handle('device-cards:list', (event) => {
      this.assertMainRenderer(event)
      return this.listPublic()
    })
    ipcMain.handle('device-cards:import', async (event) => {
      this.assertMainRenderer(event)
      const window = this.requireMainWindow()
      const selection = await dialog.showOpenDialog(window, {
        title: '导入 Uni-Lab 设备卡片',
        filters: [{ name: 'Uni-Lab Device Card', extensions: ['ulcard'] }],
        properties: ['openFile']
      })
      if (selection.canceled || selection.filePaths.length === 0) return null
      const record = await installDeviceCardArchive({
        archivePath: selection.filePaths[0],
        storeRoot: this.options.storeRoot
      })
      return publicRecord(record)
    })
    ipcMain.handle(
      'device-cards:open',
      async (event, request: OpenDeviceCardRequest) => {
        this.assertMainRenderer(event)
        await this.open(request)
      }
    )
    ipcMain.handle(
      'device-cards:updateBounds',
      (event, bounds: DeviceCardBounds) => {
        this.assertMainRenderer(event)
        this.activeView?.setBounds(normalizeBounds(bounds))
      }
    )
    ipcMain.handle(
      'device-cards:updateState',
      (event, state: Record<string, unknown>) => {
        this.assertMainRenderer(event)
        this.updateState(state)
      }
    )
    ipcMain.handle('device-cards:close', (event) => {
      this.assertMainRenderer(event)
      this.closeActive()
    })
    ipcMain.handle(
      'device-cards:resolveAction',
      (event, run: DeviceCardActionRun) => {
        this.assertMainRenderer(event)
        this.resolveAction(run)
      }
    )
    ipcMain.handle(
      'device-card-runtime:getContext',
      (event) => this.runtimeSession(event).context
    )
    ipcMain.handle(
      'device-card-runtime:callAction',
      (event, payload: { action?: unknown; params?: unknown }) =>
        this.callAction(event, payload)
    )
    ipcMain.handle(
      'device-card-runtime:saveConfig',
      (event, patch: JsonObject) => this.saveConfig(event, patch)
    )
    ipcMain.on(
      'device-card-runtime:log',
      (event, payload: { level?: unknown; message?: unknown }) => {
        const session = this.runtimeSession(event)
        const level = String(payload?.level ?? 'info')
        const message = String(payload?.message ?? '').slice(0, 2000)
        this.options.log(`[card ${session.record.id}] ${level}: ${message}`)
      }
    )
  }

  destroy(): void {
    this.closeActive()
    for (const pending of this.pendingActions.values()) {
      clearTimeout(pending.timer)
      pending.resolve({
        requestId: '',
        action: '',
        status: 'CANCELLED',
        error: 'Electron 主窗口已关闭。'
      })
    }
    this.pendingActions.clear()
  }

  private async listPublic(): Promise<InstalledDeviceCard[]> {
    return (await listInstalledDeviceCards(this.options.storeRoot))
      .map(publicRecord)
  }

  private async open(request: OpenDeviceCardRequest): Promise<void> {
    if (!isOpenRequest(request)) throw new Error('卡片打开参数无效。')
    const record = (await listInstalledDeviceCards(this.options.storeRoot))
      .find((candidate) =>
        verifyArtifactKey(candidate, request.key)
      )
    if (!record) throw new Error('卡片 Artifact 不存在。')
    if (!record.deviceTypes.includes(request.context.device.deviceTypeId)) {
      throw new Error(
        `卡片不支持设备类型 ${request.context.device.deviceTypeId}。`
      )
    }
    if (request.context.mode === 'live') {
      const availableActions = new Set(request.availableActions ?? [])
      const unavailable = record.metadata.manifest.permissions.actions
        .filter((action) => !availableActions.has(action))
      if (unavailable.length > 0) {
        throw new Error(
          `当前 OS 设备目录不包含卡片请求的 Action：${unavailable.join('、')}`
        )
      }
    }
    this.closeActive()
    const window = this.requireMainWindow()
    const partition = `unilab-card-${record.metadata.sourceHash.slice(0, 24)}`
    const view = new WebContentsView({
      webPreferences: {
        preload: resolve(this.options.preloadPath),
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })
    const session: RuntimeSession = {
      view,
      record,
      context: {
        ...request.context,
        state: filterAllowedState(
          request.context.state,
          record.metadata.manifest.permissions.state
        ),
        config: { ...(record.metadata.manifest.config?.defaults ?? {}) }
      },
      config: { ...(record.metadata.manifest.config?.defaults ?? {}) }
    }
    this.sessions.set(view.webContents.id, session)
    this.activeView = view
    const cardSession = view.webContents.session
    cardSession.setPermissionRequestHandler((_webContents, _permission, reply) => {
      reply(false)
    })
    cardSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true })
    )
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', (event) => event.preventDefault())
    view.webContents.on('will-attach-webview', (event) => event.preventDefault())
    view.webContents.on('destroyed', () => {
      this.sessions.delete(view.webContents.id)
      if (this.activeView === view) this.activeView = null
    })
    window.contentView.addChildView(view)
    view.setBounds(normalizeBounds(request.bounds))
    await view.webContents.loadFile(join(record.artifactDir, 'index.html'))
  }

  private closeActive(): void {
    const view = this.activeView
    if (!view) return
    this.activeView = null
    this.sessions.delete(view.webContents.id)
    const window = this.options.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private updateState(state: Record<string, unknown>): void {
    const view = this.activeView
    if (!view || view.webContents.isDestroyed() || !isPlainRecord(state)) return
    const session = this.sessions.get(view.webContents.id)
    if (!session) return
    const allowed = filterAllowedState(
      state,
      session.record.metadata.manifest.permissions.state
    )
    session.context = {
      ...session.context,
      state: { ...session.context.state, ...allowed }
    }
    view.webContents.send('device-card:state', allowed)
  }

  private async callAction(
    event: IpcMainInvokeEvent,
    payload: { action?: unknown; params?: unknown }
  ): Promise<DeviceCardActionRun> {
    const session = this.runtimeSession(event)
    const action = typeof payload?.action === 'string' ? payload.action : ''
    const params = isPlainRecord(payload?.params) ? payload.params : {}
    const requestId = randomUUID()
    if (!session.record.metadata.manifest.permissions.actions.includes(action)) {
      return {
        requestId,
        action,
        status: 'REJECTED',
        error: 'Action 未在卡片 manifest 中授权。'
      }
    }
    if (JSON.stringify(params).length > 64 * 1024) {
      return {
        requestId,
        action,
        status: 'REJECTED',
        error: 'Action 参数超过 64 KiB。'
      }
    }
    if (session.context.mode === 'mock') {
      return {
        requestId,
        action,
        status: 'DONE',
        result: { mock: true }
      }
    }
    const deviceId = session.context.device.deviceId
    if (!deviceId) {
      return {
        requestId,
        action,
        status: 'REJECTED',
        error: 'Live 卡片没有绑定设备实例。'
      }
    }
    const window = this.requireMainWindow()
    const request: DeviceCardHostActionRequest = {
      requestId,
      deviceId,
      action,
      params
    }
    window.webContents.send('device-cards:actionRequest', request)
    return new Promise<DeviceCardActionRun>((resolveAction) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(requestId)
        resolveAction({
          requestId,
          action,
          status: 'TIMEOUT',
          error: '主应用未在 120 秒内响应 Action 请求。'
        })
      }, 120_000)
      this.pendingActions.set(requestId, { resolve: resolveAction, timer })
    })
  }

  private saveConfig(
    event: IpcMainInvokeEvent,
    patch: JsonObject
  ): JsonObject {
    const session = this.runtimeSession(event)
    if (!isPlainRecord(patch) || JSON.stringify(patch).length > 64 * 1024) {
      throw new Error('卡片配置 patch 无效或过大。')
    }
    session.config = { ...session.config, ...patch }
    session.context = { ...session.context, config: session.config }
    return { ...session.config }
  }

  private resolveAction(run: DeviceCardActionRun): void {
    if (!run || typeof run.requestId !== 'string') return
    const pending = this.pendingActions.get(run.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingActions.delete(run.requestId)
    pending.resolve(run)
  }

  private runtimeSession(
    event: IpcMainInvokeEvent | IpcMainEvent
  ): RuntimeSession {
    const session = this.sessions.get(event.sender.id)
    if (!session) throw new Error('未知的卡片运行会话。')
    return session
  }

  private assertMainRenderer(event: IpcMainInvokeEvent): void {
    if (event.sender.id !== this.requireMainWindow().webContents.id) {
      throw new Error('IPC 调用方不是主渲染进程。')
    }
  }

  private requireMainWindow(): BrowserWindow {
    const window = this.options.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('主窗口不可用。')
    return window
  }
}

function publicRecord(record: InstalledDeviceCardRecord): InstalledDeviceCard {
  return {
    key: record.key,
    id: record.id,
    version: record.version,
    title: record.title,
    deviceTypes: record.deviceTypes,
    authoringProfile: record.authoringProfile,
    installedAt: record.installedAt
  }
}

function normalizeBounds(bounds: DeviceCardBounds): DeviceCardBounds {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height]
    .every(Number.isFinite)) {
    throw new Error('卡片视图 bounds 无效。')
  }
  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width: Math.max(1, Math.floor(bounds.width)),
    height: Math.max(1, Math.floor(bounds.height))
  }
}

function filterAllowedState(
  state: Record<string, unknown>,
  allowedKeys: string[]
): Record<string, unknown> {
  const allowed = new Set(allowedKeys)
  return Object.fromEntries(
    Object.entries(state).filter(([key]) => allowed.has(key))
  )
}

function isOpenRequest(value: unknown): value is OpenDeviceCardRequest {
  if (!isPlainRecord(value)) return false
  const context = value.context
  return typeof value.key === 'string' &&
    isPlainRecord(value.bounds) &&
    isPlainRecord(context) &&
    (context.mode === 'mock' || context.mode === 'live') &&
    isPlainRecord(context.device) &&
    typeof context.device.deviceTypeId === 'string' &&
    isPlainRecord(context.state) &&
    isPlainRecord(context.config)
    && (
      value.availableActions === undefined ||
      Array.isArray(value.availableActions) &&
      value.availableActions.every((action) => typeof action === 'string')
    )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
