import type { BackendApplicationContribution } from '@theia/core/lib/node'
import { ILogger } from '@theia/core/lib/common/logger'
import type { Disposable } from '@theia/core/lib/common/disposable'
import { inject, injectable } from '@theia/core/shared/inversify'
import {
  createManagedLocalWorkbenchSession,
  type WorkbenchSession
} from '@unilab/workbench-session'

import type {
  WorkbenchSessionClient,
  WorkbenchSessionServer
} from '../common/workbench-session-protocol'

@injectable()
export class WorkbenchSessionService
implements WorkbenchSessionServer, BackendApplicationContribution {
  @inject(ILogger)
  private readonly logger!: ILogger

  private readonly session: WorkbenchSession =
    createManagedLocalWorkbenchSession({
      workspacePath: process.env['THEIA_WORKSPACE'] ?? '',
      osProjectPath: process.env['UNILAB_OS_PROJECT'],
      environmentPath: process.env['UNILAB_PYTHON_ENV'],
      enableAgent: process.env['UNILAB_AGENT_ENABLED'] !== '0',
      agentAppPath: process.env['UNILAB_AIONUI_APP'],
      agentBrandIconPath: process.env['UNILAB_AGENT_ICON'],
      plcSimulatorProjectPath: process.env['UNILAB_PLC_SIM_PROJECT']
    })
  private readonly clients = new Set<WorkbenchSessionClient>()
  private sessionListener: Disposable | undefined

  onStart(): void {
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
    await this.session.stopAll()
  }

  getSnapshot() {
    return Promise.resolve(this.session.getSnapshot())
  }

  start() {
    return this.session.start()
  }

  stop() {
    return this.session.stop()
  }

  restart() {
    return this.session.restart()
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

  setSkipWorkflowSourceActivation(enabled: boolean) {
    return this.session.setSkipWorkflowSourceActivation(enabled)
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

  setClient(client: WorkbenchSessionClient): void {
    this.clients.add(client)
    this.sessionListener ??= this.session.onDidChange(snapshot => {
      for (const connectedClient of this.clients) {
        this.publishToClient(connectedClient, snapshot)
      }
    })
    this.publishToClient(client, this.session.getSnapshot())
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
