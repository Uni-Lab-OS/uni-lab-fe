import type { BackendApplicationContribution } from '@theia/core/lib/node'
import { ILogger } from '@theia/core/lib/common/logger'
import type { Disposable } from '@theia/core/lib/common/disposable'
import { inject, injectable } from '@theia/core/shared/inversify'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import {
  createWorkspaceHostWorkbenchSession,
  type WorkbenchSession
} from '@unilab/workbench-session'

import type {
  MaterialRendererRequest,
  MaterialRendererResponse,
  WorkbenchSessionClient,
  WorkbenchSessionServer
} from '../common/workbench-session-protocol'

type WorkbenchNodeSession = WorkbenchSession & {
  registerRenderer?(): Promise<void>
  unregisterRenderer?(): Promise<void>
}

interface PendingMaterialRendererRequest {
  resolve(response: MaterialRendererResponse): void
  reject(error: Error): void
  timeout: ReturnType<typeof setTimeout>
}

const ANSI_CONTROL_SEQUENCE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g

/** Convert a terminal-colored runtime log into plain text for the IDE editor. */
export function sanitizeRuntimeLogForEditor(content: string): string {
  return content.replace(ANSI_CONTROL_SEQUENCE, '')
}

/** Build a stable sibling path without replacing the diagnostic source log. */
export function readableRuntimeLogPath(logPath: string): string {
  const extension = extname(logPath)
  const stem = basename(logPath, extension)
  return resolve(dirname(logPath), '.readable', `${stem}.readable${extension || '.log'}`)
}

function createWorkbenchNodeSession(): WorkbenchNodeSession {
  return createWorkspaceHostWorkbenchSession({
    workspacePath: process.env['THEIA_WORKSPACE'] ?? '',
    osProjectPath: process.env['UNILAB_OS_PROJECT'],
    environmentPath: process.env['UNILAB_PYTHON_ENV'],
    enableAgent: process.env['UNILAB_AGENT_ENABLED'] !== '0',
    agentAppPath: process.env['UNILAB_AIONUI_APP'],
    agentBrandIconPath: process.env['UNILAB_AGENT_ICON'],
    plcSimulatorProjectPath: process.env['UNILAB_PLC_SIM_PROJECT'],
    backendAuthorityUrl: process.env['UNILAB_BACKEND_PROXY_TARGET'],
    schedulerAuthorityUrl: process.env['UNILAB_SCHEDULER_PROXY_TARGET']
  })
}

@injectable()
export class WorkbenchSessionService
implements WorkbenchSessionServer, BackendApplicationContribution {
  @inject(ILogger)
  private readonly logger!: ILogger

  private readonly session: WorkbenchNodeSession = createWorkbenchNodeSession()
  private readonly clients = new Set<WorkbenchSessionClient>()
  private readonly rendererManagedByHost =
    process.env['UNILAB_RENDERER_MANAGED_HEADLESS'] === '1'
  private activeRendererClient: WorkbenchSessionClient | null = null
  private readonly pendingRendererRequests = new Map<
    string,
    PendingMaterialRendererRequest
  >()
  private sessionListener: Disposable | undefined

  onStart(): void {
    if (!this.rendererManagedByHost) {
      void this.session.registerRenderer?.().catch(error => {
        this.logger.warn('Workspace renderer registration failed', error)
      })
    }
    void this.session.startWorkspaceBackend().catch(error => {
      this.logger.warn('Workspace Backend startup failed', error)
    })
    void this.session.startAgent().catch(error => {
      this.logger.warn('Workspace Agent startup failed', error)
    })
    void this.session.refreshPlcVariableTables().catch(error => {
      this.logger.warn('Workspace PLC variable-table discovery failed', error)
    })
  }

  async onStop(): Promise<void> {
    this.sessionListener?.dispose()
    this.sessionListener = undefined
    this.clients.clear()
    this.activeRendererClient = null
    for (const pending of this.pendingRendererRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Workbench renderer 已断开'))
    }
    this.pendingRendererRequests.clear()
    // Workspace Host owns Backend/OS/PLC lifetimes. Theia reload or renderer
    // shutdown must not stop physical work or lose the recoverable session.
    await Promise.allSettled([
      this.rendererManagedByHost
        ? Promise.resolve()
        : this.session.unregisterRenderer?.() ?? Promise.resolve(),
      this.session.stopAgent()
    ])
  }

  getSnapshot() {
    return Promise.resolve(this.session.getSnapshot())
  }

  /**
   * Materialize a safe, read-only editor copy of a session-owned log.
   * The caller may only request one of the paths exposed by the current snapshot.
   */
  async prepareReadableLog(logPath: string): Promise<string> {
    const snapshot = this.session.getSnapshot()
    const allowedPaths = [
      snapshot.identity?.logPath,
      snapshot.edgeRuntime.logPath,
      snapshot.plcSimulator.logPath,
      snapshot.agent?.logPath
    ].filter((candidate): candidate is string => Boolean(candidate))
    const resolvedLogPath = resolve(logPath)
    if (!allowedPaths.some(candidate => resolve(candidate) === resolvedLogPath)) {
      throw new Error('只能打开当前 Workbench 会话生成的日志文件')
    }
    const readablePath = readableRuntimeLogPath(resolvedLogPath)
    const content = await readFile(resolvedLogPath, 'utf8')
    await mkdir(dirname(readablePath), { recursive: true })
    await writeFile(readablePath, sanitizeRuntimeLogForEditor(content), 'utf8')
    return readablePath
  }

  start() {
    return this.session.start()
  }

  startWorkspaceBackend() {
    return this.session.startWorkspaceBackend()
  }

  stopWorkspaceBackend() {
    return this.session.stopWorkspaceBackend()
  }

  stop() {
    return this.session.stop()
  }

  restart() {
    return this.session.restart()
  }

  rebuildLocalData() {
    return this.session.rebuildLocalData()
  }

  startAgent() {
    return this.session.startAgent()
  }

  stopAgent() {
    return this.session.stopAgent()
  }

  restartAgent() {
    return this.session.restartAgent()
  }

  readLogTail(maxBytes?: number) {
    return this.session.readLogTail(maxBytes)
  }

  readEnvironmentLog(
    kind: Parameters<WorkbenchSession['readEnvironmentLog']>[0],
    maxBytes?: number
  ) {
    return this.session.readEnvironmentLog(kind, maxBytes)
  }

  configureGraph(graphPath: string) {
    return this.session.configureGraph(graphPath)
  }

  setExternalDevicesOnly(enabled: boolean) {
    return this.session.setExternalDevicesOnly(enabled)
  }

  configurePlcSimulator(
    configuration: Parameters<WorkbenchSession['configurePlcSimulator']>[0]
  ) {
    return this.session.configurePlcSimulator(configuration)
  }

  refreshPlcVariableTables() {
    return this.session.refreshPlcVariableTables()
  }

  startPlcSimulator() {
    return this.session.startPlcSimulator()
  }

  stopPlcSimulator() {
    return this.session.stopPlcSimulator()
  }

  releaseEnvironmentPorts(
    target: Parameters<WorkbenchSession['releaseEnvironmentPorts']>[0]
  ) {
    return this.session.releaseEnvironmentPorts(target)
  }

  setRuntimeMode(mode: Parameters<WorkbenchSession['setRuntimeMode']>[0]) {
    return this.session.setRuntimeMode(mode)
  }

  setDomainAuthority(
    mode: Parameters<WorkbenchSession['setDomainAuthority']>[0]
  ) {
    return this.session.setDomainAuthority(mode)
  }

  setSchedulerUrl(
    url: Parameters<WorkbenchSession['setSchedulerUrl']>[0]
  ) {
    return this.session.setSchedulerUrl(url)
  }

  publishRelease(
    options?: Parameters<WorkbenchSession['publishRelease']>[0]
  ) {
    return this.session.publishRelease(options)
  }

  inspectReleaseTarget(
    backendUrl: Parameters<WorkbenchSession['inspectReleaseTarget']>[0]
  ) {
    return this.session.inspectReleaseTarget(backendUrl)
  }

  setClient(client: WorkbenchSessionClient): void {
    this.clients.add(client)
    this.activeRendererClient = client
    this.sessionListener ??= this.session.onDidChange(snapshot => {
      for (const connectedClient of this.clients) {
        this.publishToClient(connectedClient, snapshot)
      }
    })
    this.publishToClient(client, this.session.getSnapshot())
  }

  /** 把 Node HTTP 自动化请求交给最近连接的单一 renderer。 */
  requestMaterialRenderer(
    request: MaterialRendererRequest
  ): Promise<MaterialRendererResponse> {
    const client = this.activeRendererClient
    if (!client) {
      return Promise.reject(new Error('没有已连接的 Workbench renderer'))
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = request.options.timeoutMs ?? 30_000
      const timeout = setTimeout(() => {
        this.pendingRendererRequests.delete(request.requestId)
        reject(new Error(`Renderer 在 ${timeoutMs}ms 内未完成请求`))
      }, timeoutMs)
      this.pendingRendererRequests.set(request.requestId, {
        resolve,
        reject,
        timeout
      })
      try {
        // Theia 的 server -> client 回调是通知语义，返回值不会穿过代理。
        // renderer 通过 completeMaterialRendererRequest 显式回传结果。
        void Promise.resolve(client.onMaterialRendererRequest(request)).catch(
          () => undefined
        )
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRendererRequests.delete(request.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  completeMaterialRendererRequest(
    response: MaterialRendererResponse
  ): Promise<void> {
    const pending = this.pendingRendererRequests.get(response.requestId)
    if (!pending) return Promise.resolve()
    this.pendingRendererRequests.delete(response.requestId)
    clearTimeout(pending.timeout)
    pending.resolve(response)
    return Promise.resolve()
  }

  private publishToClient(
    client: WorkbenchSessionClient,
    snapshot: ReturnType<WorkbenchSession['getSnapshot']>
  ): void {
    try {
      // Theia can reject the asynchronous callback acknowledgement even after
      // the renderer handled the notification. That is not a connection-lifecycle
      // signal, so keep the renderer subscribed for the next snapshot.
      void Promise.resolve(client.onDidChange(snapshot)).catch(() => undefined)
    } catch {
      this.clients.delete(client)
    }
  }
}
