import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

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
  createDeviceCardWorkspace,
  LocalDeviceCardAuthoringAutomation,
  listInstalledDeviceCards,
  verifyArtifactKey,
  type DeviceCardWorkspace
} from '@unilab/device-card-host'
import type {
  DeviceCardActionRun,
  DeviceCardActionContract,
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardAuthoringSessionStatus,
  DeviceCardAuthoringTargetResponse,
  DeviceCardBounds,
  DeviceCardRuntimeSnapshot,
  DeviceCardHostManualExclusiveResult,
  DevicePackageCardProject,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard,
  JsonObject,
  OpenDeviceCardRequest,
  OpenDeviceCardWorkspaceRequest
} from '@unilab/device-card-sdk'

import { ElectronDeviceCardAuthoringApprovals } from './deviceCardAgentPermissions'
import { RendererDeviceCardAuthoringTargetPort } from './deviceCardAuthoringTargets'
import { DeviceCardVisibilityController } from './deviceCardVisibility'
import { dispatchDeviceCardAction } from './deviceCardActionDispatch'
import { dispatchDeviceCardManualExclusive } from './deviceCardManualExclusiveDispatch'
import {
  assertDeviceCardRuntimeCapabilities,
  filterAllowedState,
  isAuthoringContext,
  isOpenRequest,
  isOpenWorkspaceRequest,
  isPlainRecord,
  normalizeBoundsForZoom,
  publicRecord,
  workspaceRuntimeRecord,
  type RuntimeCardRecord
} from './deviceCardRuntimeValidation'

type RuntimeSession = {
  view: WebContentsView; record: RuntimeCardRecord; context: DeviceCardRuntimeSnapshot
  config: JsonObject; actions: Map<string, DeviceCardActionContract>
}
type PendingAction = { resolve: (run: DeviceCardActionRun) => void }
type PendingManualExclusive = {
  resolve: (result: DeviceCardHostManualExclusiveResult) => void
}

export class DeviceCardManager {
  private readonly sessions = new Map<number, RuntimeSession>()
  private readonly pendingActions = new Map<string, PendingAction>()
  private readonly pendingManualExclusive =
    new Map<string, PendingManualExclusive>()
  private readonly visibility = new DeviceCardVisibilityController()
  private activeView: WebContentsView | null = null
  private packageWorkspace: DeviceCardWorkspace | null = null
  private readonly targetPort: RendererDeviceCardAuthoringTargetPort
  readonly authoring: LocalDeviceCardAuthoringAutomation

  constructor(private readonly options: {
    getMainWindow: () => BrowserWindow | null
    preloadPath: string
    storeRoot: string
    workspaceRoot: string
    log: (message: string) => void
  }) {
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
    ipcMain.handle(
      'device-cards:package:discover',
      async (event, workspacePath: unknown) => {
        this.assertMainRenderer(event)
        return discoverPackageCardProjects(
          await this.assertTrustedWorkspace(workspacePath)
        )
      }
    )
    ipcMain.handle(
      'device-cards:package:open',
      async (event, input: unknown) => {
        this.assertMainRenderer(event)
        if (!isPackageCardOpenInput(input)) {
          throw new Error('领域包设备卡片参数无效。')
        }
        const projectDir = await this.assertPackageCardProject(input.projectDir)
        await this.closePackageWorkspace()
        const contextAuthority = input.contextAuthority
          ?? (input.context ? 'host' : 'project-preview')
        if (contextAuthority === 'host' && !input.context) {
          throw new Error('Host 模式打开领域包卡片需要提供 OS Authoring Context。')
        }
        this.packageWorkspace = await createDeviceCardWorkspace({
          projectDir,
          workRoot: this.options.workspaceRoot,
          authoringContext: input.context,
          contextAuthority,
          watch: false
        })
        return this.packageWorkspace.getStatus()
      }
    )
    ipcMain.handle(
      'device-cards:package:preview',
      async (event, request: OpenDeviceCardWorkspaceRequest) => {
        this.assertMainRenderer(event)
        await this.openPackagePreview(request)
      }
    )
    ipcMain.handle('device-cards:package:close', async (event) => {
      this.assertMainRenderer(event)
      await this.closePackageWorkspace()
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
        const view = this.activeView
        if (view) this.applyRendererGeometry(view, bounds)
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
      'device-cards:resolveManualExclusive',
      (event, result: DeviceCardHostManualExclusiveResult) => {
        this.assertMainRenderer(event)
        this.resolveManualExclusive(result)
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
      'device-card-runtime:manualExclusive',
      (event, operation: unknown) => {
        const session = this.runtimeSession(event)
        return dispatchDeviceCardManualExclusive({
          context: session.context,
          uiFeatures: session.record.metadata.manifest.uiFeatures,
          operation,
          window: this.requireMainWindow(),
          registerPending: (requestId, resolve) => {
            this.pendingManualExclusive.set(requestId, { resolve })
          }
        })
      }
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
    void this.closePackageWorkspace()
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
    for (const pending of this.pendingManualExclusive.values()) {
      pending.resolve({
        requestId: '',
        ok: false,
        error: 'Electron 主窗口已关闭。'
      })
    }
    this.pendingManualExclusive.clear()
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

  private async openPackagePreview(
    request: OpenDeviceCardWorkspaceRequest
  ): Promise<void> {
    if (!isOpenWorkspaceRequest(request)) {
      throw new Error('领域包设备卡片预览参数无效。')
    }
    const workspace = this.packageWorkspace
    if (!workspace) throw new Error('当前没有已发现的领域包设备卡片。')
    await this.openRecord(
      workspaceRuntimeRecord(workspace.getPreviewArtifact()),
      request
    )
  }

  private async openRecord(
    record: RuntimeCardRecord,
    request: OpenDeviceCardRequest | OpenDeviceCardWorkspaceRequest
  ): Promise<void> {
    assertDeviceCardRuntimeCapabilities(record, request)
    this.closeActive()
    const window = this.requireMainWindow()
    const zoomFactor = this.mainWindowZoomFactor()
    const partition = `unilab-card-${record.metadata.sourceHash.slice(0, 24)}`
    const view = new WebContentsView({
      webPreferences: {
        preload: resolve(this.options.preloadPath),
        partition,
        zoomFactor,
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
      if (this.activeView === view) {
        this.visibility.detach(view)
        this.activeView = null
      }
    })
    window.contentView.addChildView(view)
    this.visibility.attach(view)
    view.setBounds(normalizeBoundsForZoom(request.bounds, zoomFactor))
    await view.webContents.loadFile(join(record.artifactDir, 'index.html'))
  }

  private async closeWorkspace(): Promise<void> {
    const active = this.authoring.getActiveStatus()
    if (!active) return
    this.closeActive()
    await this.authoring.close(active.session.sessionId)
  }

  private async closePackageWorkspace(): Promise<void> {
    const workspace = this.packageWorkspace
    if (!workspace) return
    this.packageWorkspace = null
    this.closeActive()
    await workspace.close()
  }

  private async assertTrustedWorkspace(workspacePath: unknown): Promise<string> {
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      throw new Error('领域包工作区路径无效。')
    }
    const configured = process.env.THEIA_WORKSPACE
    if (!configured) throw new Error('桌面 Workbench 未声明当前工作区。')
    const [requested, trusted] = await Promise.all([
      realpath(resolve(workspacePath)),
      realpath(resolve(configured))
    ])
    if (requested !== trusted) throw new Error('拒绝读取当前工作区之外的设备卡片。')
    return trusted
  }

  private async assertPackageCardProject(projectDir: string): Promise<string> {
    const workspace = await this.assertTrustedWorkspace(
      process.env.THEIA_WORKSPACE
    )
    const cardsRoot = await realpath(join(workspace, 'frontend', 'cards'))
    const candidate = await realpath(resolve(projectDir))
    const child = relative(cardsRoot, candidate)
    if (!child || child.startsWith(`..${sep}`) || child === '..'
      || child.includes(sep)) {
      throw new Error('设备卡片必须是当前领域包 frontend/cards 的直接子目录。')
    }
    return candidate
  }

  private closeActive(): void {
    const view = this.activeView
    if (!view) return
    this.visibility.detach(view)
    this.activeView = null
    this.sessions.delete(view.webContents.id)
    const window = this.options.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.contentView.removeChildView(view)
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /**
   * 让设备卡片原生视图与主渲染器的缩放和占位框保持同一物理边界。
   *
   * @param view 当前活动的设备卡片原生视图。
   * @param bounds 主渲染器以 CSS 像素测得的占位框。
   * @returns 无。
   */
  private applyRendererGeometry(
    view: WebContentsView,
    bounds: DeviceCardBounds
  ): void {
    const zoomFactor = this.mainWindowZoomFactor()
    view.webContents.setZoomFactor(zoomFactor)
    view.setBounds(normalizeBoundsForZoom(bounds, zoomFactor))
  }

  /**
   * 读取主渲染器的当前缩放系数，作为设备卡片原生视图的坐标换算依据。
   *
   * @returns 主窗口 WebContents 的缩放系数。
   */
  private mainWindowZoomFactor(): number {
    return this.requireMainWindow().webContents.getZoomFactor()
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

  private resolveAction(run: DeviceCardActionRun): void {
    if (!run || typeof run.requestId !== 'string') return
    const pending = this.pendingActions.get(run.requestId)
    if (!pending) return
    this.pendingActions.delete(run.requestId)
    pending.resolve(run)
  }

  private resolveManualExclusive(
    result: DeviceCardHostManualExclusiveResult
  ): void {
    if (!result || typeof result.requestId !== 'string') return
    const pending = this.pendingManualExclusive.get(result.requestId)
    if (!pending) return
    this.pendingManualExclusive.delete(result.requestId)
    pending.resolve(result)
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

async function discoverPackageCardProjects(
  workspace: string
): Promise<DevicePackageCardProject[]> {
  const cardsRoot = join(workspace, 'frontend', 'cards')
  let entries
  try {
    entries = await readdir(cardsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const projects: DevicePackageCardProject[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const projectDir = join(cardsRoot, entry.name)
    try {
      const manifest = JSON.parse(
        await readFile(join(projectDir, 'card.manifest.json'), 'utf8')
      ) as unknown
      if (!isPackageCardManifest(manifest)) continue
      const authoringContext = await readPackageAuthoringContext(projectDir)
      const mockState = await readPackageMockState(projectDir)
      projects.push({
        projectDir: await realpath(projectDir),
        id: manifest.id,
        version: manifest.version,
        title: manifest.title,
        deviceTypes: [...manifest.deviceTypes],
        ...(authoringContext?.deviceId
          ? { deviceId: authoringContext.deviceId }
          : {}),
        ...(authoringContext
          ? {
              authoringPreview: {
                deviceTypeId: authoringContext.deviceTypeId,
                ...(authoringContext.deviceId
                  ? { deviceId: authoringContext.deviceId }
                  : {}),
                title: authoringContext.title,
                actions: [...authoringContext.actions],
                stateSchema: { ...authoringContext.stateSchema },
                sampleState: {
                  ...authoringContext.sampleState,
                  ...mockState
                }
              }
            }
          : {})
      })
    } catch {
      // 不完整的源码目录不进入发现结果，由卡片检查命令单独报告。
    }
  }
  return projects.sort((left, right) => left.id.localeCompare(right.id))
}

function isPackageCardManifest(value: unknown): value is {
  schemaVersion: 1
  id: string
  version: string
  title: string
  deviceTypes: string[]
} {
  return isPlainRecord(value)
    && value.schemaVersion === 1
    && typeof value.id === 'string'
    && typeof value.version === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.deviceTypes)
    && value.deviceTypes.length > 0
    && value.deviceTypes.every((item) => typeof item === 'string' && item.length > 0)
}

function isPackageCardOpenInput(value: unknown): value is {
  projectDir: string
  context?: DeviceCardAuthoringContext
  contextAuthority?: 'host' | 'project-preview'
} {
  return isPlainRecord(value)
    && typeof value.projectDir === 'string'
    && (value.context === undefined || isAuthoringContext(value.context))
    && (value.contextAuthority === undefined
      || value.contextAuthority === 'host'
      || value.contextAuthority === 'project-preview')
    && (value.contextAuthority !== 'host' || isAuthoringContext(value.context))
}

async function readPackageAuthoringContext(
  projectDir: string
): Promise<DeviceCardAuthoringContext | undefined> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(projectDir, 'authoring-context.json'), 'utf8')
    )
    return isAuthoringContext(raw) ? raw : undefined
  } catch {
    return undefined
  }
}

async function readPackageMockState(
  projectDir: string
): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(projectDir, 'mock.json'), 'utf8')
    )
    return isPlainRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}
