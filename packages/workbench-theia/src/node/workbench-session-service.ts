import type { BackendApplicationContribution } from '@theia/core/lib/node'
import { ILogger } from '@theia/core/lib/common/logger'
import type { Disposable } from '@theia/core/lib/common/disposable'
import { inject, injectable } from '@theia/core/shared/inversify'
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
