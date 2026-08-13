import { basename, join, resolve } from 'node:path'

import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  WebContentsView
} from 'electron'
import {
  installDeviceCardArchive,
  LocalDeviceCardAuthoringAutomation,
  listInstalledDeviceCards,
  verifyArtifactKey
} from '@unilab/device-card-host'
import type {
  DeviceCardActionRun,
  DeviceCardActionContract,
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardAuthoringSessionStatus,
  DeviceCardAuthoringTargetResponse,
  DeviceCardBounds,
  DeviceCardJointPreviewFrame,
  DeviceCardRuntimeSnapshot,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard,
  JsonObject,
  OpenDeviceCardRequest,
  OpenDeviceCardWorkspaceRequest
} from '@unilab/device-card-sdk'
import { DEVICE_CARD_JOINT_PREVIEW_FEATURE } from '@unilab/device-card-sdk'

import { ElectronDeviceCardAuthoringApprovals } from './deviceCardAgentPermissions'
import { RendererDeviceCardAuthoringTargetPort } from './deviceCardAuthoringTargets'
import { DeviceCardVisibilityController } from './deviceCardVisibility'
import { dispatchDeviceCardAction } from './deviceCardActionDispatch'
import { createDeviceCardJointPreview } from './deviceCardJointPreview'
import { LatestViewOpenCoordinator } from './latestViewOpenCoordinator'
import {
  assertDeviceCardRuntimeCapabilities,
  filterAllowedState,
  isAuthoringContext,
  isOpenRequest,
  isOpenWorkspaceRequest,
  isPlainRecord,
  normalizeBounds,
  publicRecord,
  workspaceRuntimeRecord,
  type RuntimeCardRecord
} from './deviceCardRuntimeValidation'

type RuntimeSession = {
  view: WebContentsView
  record: RuntimeCardRecord
  context: DeviceCardRuntimeSnapshot
  config: JsonObject
  actions: Map<string, DeviceCardActionContract>
}
type PendingAction = { resolve: (run: DeviceCardActionRun) => void }
type DiagnosticLevel = 'info' | 'warning' | 'error'

interface JointPreviewDiagnosticState {
  lastLoggedAt: number
  suppressed: number
}

export class DeviceCardManager {
  private readonly sessions = new Map<number, RuntimeSession>()
  private readonly pendingActions = new Map<string, PendingAction>()
  private readonly visibility = new DeviceCardVisibilityController()
  private readonly attachedViews = new Set<WebContentsView>()
  private readonly jointPreviewDiagnostics =
    new Map<string, JointPreviewDiagnosticState>()
  private readonly openCoordinator: LatestViewOpenCoordinator<WebContentsView>
  private readonly targetPort: RendererDeviceCardAuthoringTargetPort
  readonly authoring: LocalDeviceCardAuthoringAutomation

  constructor(private readonly options: {
    getMainWindow: () => BrowserWindow | null
    preloadPath: string
    storeRoot: string
    workspaceRoot: string
    log: (message: string) => void
  }) {
    this.openCoordinator = new LatestViewOpenCoordinator({
      activate: (view) => this.activateView(view),
      dispose: (view) => this.disposeView(view)
    })
    this.targetPort = new RendererDeviceCardAuthoringTargetPort(
      options.getMainWindow
    )
    this.authoring = new LocalDeviceCardAuthoringAutomation({
      targets: this.targetPort,
      approvals: new ElectronDeviceCardAuthoringApprovals(options.getMainWindow),
      workRoot: options.workspaceRoot,
      storeRoot: options.storeRoot,
      installArchive: installDeviceCardArchive,
      onStatus: (status) => this.sendWorkspaceStatus(
        status?.workspace ?? null
      )
    })
  }

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
      'device-cards:workspace:open',
      async (event, context?: DeviceCardAuthoringContext) => {
        this.assertMainRenderer(event)
        if (context !== undefined && !isAuthoringContext(context)) {
          throw new Error('卡片工作区 Authoring Context 无效。')
        }
        const window = this.requireMainWindow()
        const selection = await dialog.showOpenDialog(window, {
          title: '打开 Uni-Lab 卡片源码目录',
          properties: ['openDirectory']
        })
        if (selection.canceled || selection.filePaths.length === 0) return null
        const result = await this.authoring.prepare({
          mode: 'attach',
          deviceId: context?.deviceId ?? '',
          projectDir: selection.filePaths[0],
          principal: 'renderer'
        })
        return result.workspace
      }
    )
    ipcMain.handle('device-cards:workspace:get', (event) => {
      this.assertMainRenderer(event)
      return this.authoring.getActiveStatus()?.workspace ?? null
    })
    ipcMain.handle('device-cards:workspace:close', async (event) => {
      this.assertMainRenderer(event)
      await this.closeWorkspace()
    })
    ipcMain.handle('device-cards:workspace:rebuild', async (event) => {
      this.assertMainRenderer(event)
      const active = this.requireAuthoringSession()
      return (await this.authoring.recheck(active.session.sessionId)).workspace
    })
    ipcMain.handle('device-cards:workspace:install', async (event) => {
      this.assertMainRenderer(event)
      const active = this.requireAuthoringSession()
      const approval = await this.authoring.requestInstall(
        active.session.sessionId,
        'renderer'
      )
      if (!approval.installed) throw new Error('用户取消了卡片安装。')
      return approval.installed
    })
    ipcMain.handle('device-cards:workspace:export', async (event) => {
      this.assertMainRenderer(event)
      const active = this.requireAuthoringSession()
      const artifact = this.authoring.getPreviewArtifact(active.session.sessionId)
      const defaultName = basename(
        `${artifact.metadata.cardId}-${artifact.metadata.cardVersion}.ulcard`
      )
      const selection = await dialog.showSaveDialog(this.requireMainWindow(), {
        title: '导出 Uni-Lab 设备卡片源码',
        defaultPath: defaultName,
        filters: [{ name: 'Uni-Lab Device Card', extensions: ['ulcard'] }]
      })
      if (selection.canceled || !selection.filePath) return null
      return this.authoring.exportSource(
        active.session.sessionId,
        selection.filePath,
        'renderer'
      )
    })
    ipcMain.handle(
      'device-cards:authoring:prepare',
      async (
        event,
        input: { deviceId?: unknown; profile?: unknown }
      ) => {
        this.assertMainRenderer(event)
        const deviceId = typeof input?.deviceId === 'string'
          ? input.deviceId
          : ''
        const profile = input?.profile as DeviceCardAuthoringProfile
        const selection = await dialog.showOpenDialog(this.requireMainWindow(), {
          title: '选择空目录，为 Agent 创建卡片项目',
          buttonLabel: '创建并接入',
          properties: ['openDirectory', 'createDirectory']
        })
        if (selection.canceled || selection.filePaths.length === 0) return null
        return this.authoring.prepare({
          mode: 'bootstrap',
          deviceId,
          profile,
          projectDir: selection.filePaths[0],
          principal: 'renderer'
        })
      }
    )
    ipcMain.handle('device-cards:authoring:get', (event) => {
      this.assertMainRenderer(event)
      return this.authoring.getActiveStatus()
    })
    ipcMain.handle(
      'device-cards:authoring:reveal',
      (event, path: unknown) => {
        this.assertMainRenderer(event)
        if (typeof path !== 'string' || path.trim().length === 0) {
          throw new Error('打开目录路径无效。')
        }
        shell.showItemInFolder(resolve(path, 'card.manifest.json'))
      }
    )
    ipcMain.on(
      'device-cards:authoringTargetResponse',
      (event, response: DeviceCardAuthoringTargetResponse) => {
        if (event.sender.id !== this.requireMainWindow().webContents.id) return
        if (!response || typeof response.requestId !== 'string') return
        this.targetPort.resolve(response)
      }
    )
    ipcMain.handle(
      'device-cards:open',
      async (event, request: OpenDeviceCardRequest) => {
        this.assertMainRenderer(event)
        await this.open(request)
      }
    )
    ipcMain.handle(
      'device-cards:workspace:preview',
      async (event, request: OpenDeviceCardWorkspaceRequest) => {
        this.assertMainRenderer(event)
        await this.openWorkspacePreview(request)
      }
    )
    ipcMain.handle(
      'device-cards:updateBounds',
      (event, bounds: DeviceCardBounds) => {
        this.assertMainRenderer(event)
        this.openCoordinator.getActive()?.setBounds(normalizeBounds(bounds))
      }
    )
    ipcMain.handle(
      'device-cards:setOccluded',
      (event, source: unknown, occluded: unknown) => {
        this.assertMainRenderer(event)
        if (typeof source !== 'string' || typeof occluded !== 'boolean') {
          throw new Error('设备卡片遮挡状态无效。')
        }
        this.visibility.setOccluded(source, occluded)
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
    ipcMain.handle(
      'device-card-runtime:setJointPreview',
      (event, jointStates: unknown) =>
        this.setJointPreview(event, jointStates)
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
    this.targetPort.destroy()
    void this.authoring.destroy()
    for (const pending of this.pendingActions.values()) {
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
    await this.openRecord(record, request)
  }

  private async openWorkspacePreview(
    request: OpenDeviceCardWorkspaceRequest
  ): Promise<void> {
    if (!isOpenWorkspaceRequest(request)) {
      throw new Error('本地卡片预览参数无效。')
    }
    const active = this.requireAuthoringSession()
    const artifact = this.authoring.getPreviewArtifact(active.session.sessionId)
    await this.openRecord(workspaceRuntimeRecord(artifact), request)
  }

  private async openRecord(
    record: RuntimeCardRecord,
    request: OpenDeviceCardRequest | OpenDeviceCardWorkspaceRequest
  ): Promise<void> {
    assertDeviceCardRuntimeCapabilities(record, request)
    this.requireMainWindow()
    const diagnosticIdentity = cardDiagnosticIdentity(record)
    this.runtimeDiagnostic(
      `stage=open status=started ${diagnosticIdentity}`
    )
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
      config: { ...(record.metadata.manifest.config?.defaults ?? {}) },
      actions: new Map(
        (request.availableActions ?? []).map((action) => [
          action.action,
          structuredClone(action)
        ])
      )
    }
    const viewId = view.webContents.id
    this.sessions.set(viewId, session)
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
    view.webContents.on('render-process-gone', (_event, details) => {
      this.runtimeDiagnostic(
        `stage=card-renderer status=gone reason=${diagnosticToken(details.reason)} ${diagnosticIdentity}`,
        'error'
      )
    })
    view.webContents.on('destroyed', () => {
      this.sessions.delete(viewId)
      this.attachedViews.delete(view)
      this.visibility.detach(view)
      this.openCoordinator.forget(view)
    })
    view.setBounds(normalizeBounds(request.bounds))
    try {
      const outcome = await this.openCoordinator.open(
        view,
        () => view.webContents.loadFile(join(record.artifactDir, 'index.html'))
      )
      this.runtimeDiagnostic(
        `stage=open status=${outcome === 'committed' ? 'ready' : 'superseded'} ${diagnosticIdentity}`
      )
    } catch (error) {
      const code = diagnosticErrorCode(error)
      this.runtimeDiagnostic(
        `stage=open status=failed code=${code} ${diagnosticIdentity}`,
        'error'
      )
      throw new Error(
        `卡片加载失败（${code}，${diagnosticIdentity}）。`
      )
    }
  }

  private async closeWorkspace(): Promise<void> {
    const active = this.authoring.getActiveStatus()
    if (!active) return
    this.closeActive()
    await this.authoring.close(active.session.sessionId)
  }

  private closeActive(): void {
    this.openCoordinator.closeAll()
  }

  private activateView(view: WebContentsView): void {
    const window = this.requireMainWindow()
    window.contentView.addChildView(view)
    this.attachedViews.add(view)
    this.visibility.attach(view)
  }

  private disposeView(view: WebContentsView): void {
    const viewId = view.webContents.id
    this.visibility.detach(view)
    this.sessions.delete(viewId)
    const window = this.options.getMainWindow()
    if (
      this.attachedViews.delete(view)
      && window
      && !window.isDestroyed()
    ) {
      window.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private updateState(state: Record<string, unknown>): void {
    const view = this.openCoordinator.getActive()
    if (!view || view.webContents.isDestroyed() || !isPlainRecord(state)) return
    const session = this.sessions.get(view.webContents.id)
    if (!session) return
    const allowed = filterAllowedState(
      state,
      session.record.metadata.manifest.permissions.state
    )
    session.context = {
      ...session.context,
      state: allowed
    }
    view.webContents.send('device-card:state', allowed)
  }

  private callAction(
    event: IpcMainInvokeEvent,
    payload: { action?: unknown; params?: unknown }
  ): Promise<DeviceCardActionRun> {
    return dispatchDeviceCardAction({
      session: this.runtimeSession(event),
      payload,
      window: this.requireMainWindow(),
      registerPending: (requestId, resolve) => {
        // 真实终态只由 OS Action Task 投影决定；窗口关闭时统一取消 pending。
        this.pendingActions.set(requestId, { resolve })
      }
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

  private setJointPreview(
    event: IpcMainInvokeEvent,
    jointStates: unknown
  ): DeviceCardJointPreviewFrame {
    const session = this.runtimeSession(event)
    if (!session.record.metadata.manifest.uiFeatures.includes(
      DEVICE_CARD_JOINT_PREVIEW_FEATURE
    )) {
      this.logRejectedJointPreview(session, 'capability_missing')
      throw new Error('卡片 Manifest 未声明 joint-preview 能力。')
    }
    let frame: DeviceCardJointPreviewFrame
    try {
      frame = createDeviceCardJointPreview(session.context, jointStates)
    } catch (error) {
      const reason = session.context.mode !== 'mock'
        ? 'live_forbidden'
        : session.context.device.materialId
          ? 'invalid_payload'
          : 'material_missing'
      this.logRejectedJointPreview(session, reason)
      throw error
    }
    session.context = { ...session.context, jointPreview: frame }
    this.logAcceptedJointPreview(session, frame)
    this.requireMainWindow().webContents.send(
      'device-cards:jointPreview',
      frame
    )
    return frame
  }

  private logRejectedJointPreview(
    session: RuntimeSession,
    reason: string
  ): void {
    this.runtimeDiagnostic(
      `[joint-preview] stage=manager status=rejected reason=${diagnosticToken(reason)} material=${diagnosticToken(session.context.device.materialId ?? 'none')} artifact=${session.record.metadata.sourceHash.slice(0, 12)}`,
      'warning'
    )
  }

  private logAcceptedJointPreview(
    session: RuntimeSession,
    frame: DeviceCardJointPreviewFrame
  ): void {
    const artifact = session.record.metadata.sourceHash.slice(0, 12)
    const key = `${artifact}:${frame.materialId}`
    const now = Date.now()
    const previous = this.jointPreviewDiagnostics.get(key)
    if (previous && now - previous.lastLoggedAt < 1_000) {
      previous.suppressed += 1
      return
    }
    const suppressed = previous?.suppressed ?? 0
    this.jointPreviewDiagnostics.set(key, {
      lastLoggedAt: now,
      suppressed: 0
    })
    this.runtimeDiagnostic(
      `[joint-preview] stage=manager status=accepted material=${diagnosticToken(frame.materialId)} artifact=${artifact} joints=${Object.keys(frame.jointStates).length}${suppressed ? ` suppressed=${suppressed}` : ''}`
    )
  }

  private runtimeDiagnostic(
    message: string,
    level: DiagnosticLevel = 'info'
  ): void {
    const line = message.startsWith('[joint-preview]')
      ? message
      : `[device-card-runtime] ${message}`
    this.options.log(line)
    if (level === 'error') console.error(line)
    else if (level === 'warning') console.warn(line)
    else console.info(line)
  }

  private resolveAction(run: DeviceCardActionRun): void {
    if (!run || typeof run.requestId !== 'string') return
    const pending = this.pendingActions.get(run.requestId)
    if (!pending) return
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

  private requireAuthoringSession(): DeviceCardAuthoringSessionStatus {
    const active = this.authoring.getActiveStatus()
    if (!active) {
      throw new Error('尚未打开本地卡片源码目录。')
    }
    return active
  }

  private sendWorkspaceStatus(status: DeviceCardWorkspaceStatus | null): void {
    const window = this.options.getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send('device-cards:workspaceStatus', status)
  }
}

function cardDiagnosticIdentity(record: RuntimeCardRecord): string {
  return `card=${diagnosticToken(record.id)} version=${diagnosticToken(record.metadata.cardVersion)} artifact=${record.metadata.sourceHash.slice(0, 12)}`
}

function diagnosticErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown'
  const candidate = error as { code?: unknown; errno?: unknown }
  if (typeof candidate.code === 'string' && candidate.code) {
    return diagnosticToken(candidate.code)
  }
  if (typeof candidate.errno === 'number' && Number.isFinite(candidate.errno)) {
    return `errno_${candidate.errno}`
  }
  return 'unknown'
}

function diagnosticToken(value: unknown): string {
  return String(value ?? 'unknown')
    .replace(/[^a-zA-Z0-9_.:@-]+/gu, '_')
    .slice(0, 160) || 'unknown'
}
