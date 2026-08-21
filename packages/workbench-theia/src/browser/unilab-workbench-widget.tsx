import { EditorManager, EditorWidget } from '@theia/editor/lib/browser'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { ApplicationShell, Message } from '@theia/core/lib/browser'
import {
  ConnectionStatus,
  ConnectionStatusService
} from '@theia/core/lib/browser/connection-status-service'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { MessageService } from '@theia/core/lib/common/message-service'
import { URI } from '@theia/core/lib/common/uri'
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager'
import type { Diagnostic } from '@theia/core/shared/vscode-languageserver-protocol'
import {
  Disposable,
  DisposableCollection
} from '@theia/core/lib/common/disposable'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  DeviceManagementPanel
} from '@unilab/device-management'
import {
  MaterialStoreProvider,
  MaterialWorkbench,
  createMaterialStore,
  type MaterialId,
  type MaterialStore
} from '@unilab/material'
import {
  RobotWorkstation
} from '@unilab/robot-workstation'
import {
  assertCapability
} from '@unilab/services'
import {
  createWorkflowResourceSlotOptionsPort,
  WorkflowPanel,
  WorkflowTaskList,
  type WorkflowPanelRuntimeProjection
} from '@unilab/workflow-editor'
import {
  createWorkflowIdeSyncState,
  synchronizeSavedWorkflowSource,
  WorkflowIdeHostAdapter,
  type WorkflowIdeBridge,
  type WorkflowIdeSyncState,
  type WorkflowIdeResolvedDiagnostic,
  type WorkflowIdeResolvedLocation,
  type WorkflowSourceProjection
} from '@unilab/workflow-ide-bridge'
import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchPlcSimulatorConfiguration,
  WorkbenchReleaseReceipt,
  WorkbenchReleaseTargetInspection,
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  WorkbenchSessionClient,
  WorkbenchSessionServer
} from '../common/workbench-session-protocol'
import { WorkbenchSessionClientImpl } from './workbench-session-client'
import { desktopWorkflowTraceRuntime } from './desktop-workflow-trace-runtime'
import { desktopWorkspaceApi } from './desktop-workspace'
import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import {
  WorkbenchAuthorityScopeBoundary,
  workbenchAuthorityScopeKey
} from './workbench-authority-scope'
import { EnvironmentManager } from './environment-manager'
import { createTheiaWorkflowIdeAdapter } from './theia-workflow-ide-adapter'
import {
  createWorkbenchConnectionTargets,
  createWorkbenchServices,
  type WorkbenchConnectionMode
} from './workbench-connection-profile'
import { preflightWorkbenchRuntimeAuthority } from './workbench-domain-authority'
import { WorkbenchConnectionSelector } from './workbench-connection-selector'
import { authoritySurfaceSnapshot } from './workbench-authority-surface'
import {
  currentBrowserOrigin,
  initialWorkbenchConnectionMode,
  persistWorkbenchConnectionMode,
  sessionConnectionState,
  useBackendConnectionState
} from './workbench-connection-runtime'
import { useRobotWorkstationData } from './robot-workstation-data'
import { WorkbenchDomainLayout } from './workbench-domain-layout'
import { WorkbenchHeader } from './workbench-header'
import { WorkbenchMaterialViewport } from './workbench-material-viewport'
import { workbenchDeviceConnection } from './workbench-device-connection'
import { workflowExecutionStatusForConnection } from './workbench-execution-readiness'
import {
  runAndRefreshWorkbenchOperation,
  WorkbenchAuthorityLoading,
  WorkbenchSessionGate
} from './workbench-session-gate'
import {
  WorkbenchViewState,
  type WorkbenchViewMode
} from './workbench-view-state'
import {
  emptyEdgeRuntimeSnapshot,
  emptyPlcSimulatorSnapshot,
  isWorkflowWorkbenchView,
  mountedSurface,
  publishDesktopUnsavedChanges,
  recordMountedWorkbenchDomains,
  theiaDiagnosticSeverity,
  workbenchConnectionState,
  workstationModule,
  type WorkbenchMountedDomain,
  type WorkbenchSurfaceProps
} from './workbench-surface-helpers'
import { hasWorkbenchUnsavedChanges } from './workbench-unsaved-changes'

type SourceSaveHandler = (pythonSource: string) => Promise<void>

@injectable()
export class UniLabWorkbenchWidget extends ReactWidget {
  // This persisted identity predates the formal product name. Keep it stable so
  // existing Theia layouts reopen the same widget after upgrading.
  static readonly ID = 'unilab:authoring-workbench'
  static readonly LABEL = 'Unilab 调试工作台'

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  @inject(FileService)
  protected readonly fileService!: FileService

  @inject(WorkbenchSessionServer)
  protected readonly workbenchSession!: WorkbenchSessionServer

  @inject(WorkbenchSessionClient)
  protected readonly workbenchSessionClient!: WorkbenchSessionClientImpl

  @inject(MessageService)
  protected readonly messages!: MessageService

  @inject(ProblemManager)
  protected readonly problemManager!: ProblemManager

  @inject(WorkbenchViewState)
  protected readonly viewState!: WorkbenchViewState

  @inject(ConnectionStatusService)
  protected readonly connectionStatus!: ConnectionStatusService

  protected editorListeners = new DisposableCollection()
  protected snapshot = createWorkflowIdeSyncState()
  protected ideAdapter!: WorkflowIdeHostAdapter
  protected ideBridge!: WorkflowIdeBridge
  protected diagnosticUris = new Set<string>()
  protected sessionSnapshot: WorkbenchSessionSnapshot = {
    phase: 'idle',
    message: '正在连接 Workbench Backend…',
    configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: null,
    configuredSchedulerUrl: null,
    identity: null,
    agent: null,
    diagnostic: null,
    edgeRuntime: emptyEdgeRuntimeSnapshot(),
    plcSimulator: emptyPlcSimulatorSnapshot()
  }
  protected sourceSaveHandler: SourceSaveHandler | null = null
  protected lastAutomaticSourceSync: string | null = null
  protected workflowPanelDirty = false
  protected lastReportedUnsavedChanges: boolean | null = null
  protected connectionMode: WorkbenchConnectionMode =
    initialWorkbenchConnectionMode()
  protected connectionSwitchingTo: WorkbenchConnectionMode | null = null
  protected connectionSwitchSurface: WorkbenchSessionSnapshot | null = null
  protected connectionSwitchRevision = 0
  protected connectionInterrupted = false
  protected recoveryRevision = 0
  @postConstruct()
  protected init(): void {
    this.ideAdapter = createTheiaWorkflowIdeAdapter({
      revealSource: location => this.revealResolvedSource(location),
      replaceDiagnostics: diagnostics => this.replaceDiagnostics(diagnostics),
      reportError: message => { void this.messages.error(message) }
    })
    this.ideBridge = this.ideAdapter.bridge
    this.id = UniLabWorkbenchWidget.ID
    this.title.label = UniLabWorkbenchWidget.LABEL
    this.title.caption = 'UniLab Workbench'
    this.title.closable = false
    this.title.iconClass = 'codicon codicon-type-hierarchy-sub'
    this.toDispose.push(Disposable.create(() => this.editorListeners.dispose()))
    this.toDispose.push(Disposable.create(() => {
      void this.ideAdapter.dispose()
    }))
    this.toDispose.push(Disposable.create(() => {
      publishDesktopUnsavedChanges(false)
    }))
    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => {
      this.observeCurrentEditor()
    }))
    this.toDispose.push(this.workbenchSessionClient.onSessionChanged(snapshot => {
      this.sessionSnapshot = snapshot
      // Workspace Host owns the committed Domain Authority.  Keep the
      // selector on that fact except while this renderer is presenting an
      // explicit in-flight target.
      if (!this.connectionSwitchingTo) {
        this.connectionMode = snapshot.configuredDomainMode
        persistWorkbenchConnectionMode(snapshot.configuredDomainMode)
      }
      this.ideAdapter.setPackageMounts(
        snapshot.identity?.packageMounts?.items ?? []
      )
      this.update()
    }))
    this.toDispose.push(this.viewState.onDidChangeMode(() => this.update()))
    this.toDispose.push(this.connectionStatus.onStatusChange(status => {
      if (status === ConnectionStatus.OFFLINE) {
        this.connectionInterrupted = true
        return
      }
      if (!this.connectionInterrupted) return
      this.connectionInterrupted = false
      this.recoveryRevision += 1
      void this.refreshSessionSnapshot()
      this.update()
    }))
    void this.refreshSessionSnapshot()
    this.observeCurrentEditor()
    this.update()
  }

  protected async refreshSessionSnapshot(): Promise<void> {
    try {
      this.sessionSnapshot = await this.workbenchSession.getSnapshot()
      if (!this.connectionSwitchingTo) {
        this.connectionMode = this.sessionSnapshot.configuredDomainMode
        persistWorkbenchConnectionMode(this.connectionMode)
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const reconnecting = /reconnecting channel/i.test(rawMessage)
      this.sessionSnapshot = {
        phase: 'failed',
        message: 'Workbench Backend 连接失败',
        configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
        configuredExternalDevicesOnly: true,
        configuredRuntimeMode: 'normal',
        configuredDomainMode: 'local',
        configuredBackendUrl: null,
        configuredSchedulerUrl: null,
        identity: null,
        agent: null,
        diagnostic: {
          code: 'os_start_failed',
          message: reconnecting
            ? '连接暂时中断，正在等待自动恢复。'
            : rawMessage,
          recovery: reconnecting
            ? '网络恢复后页面会自动重新读取数据，无需手动刷新'
            : '确认 Workbench Backend 正在运行后重试'
        },
        edgeRuntime: emptyEdgeRuntimeSnapshot(),
        plcSimulator: emptyPlcSimulatorSnapshot()
      }
    }
    this.ideAdapter.setPackageMounts(
      this.sessionSnapshot.identity?.packageMounts?.items ?? []
    )
    this.update()
  }

  protected readonly retrySession = async (): Promise<void> => {
    try {
      await this.workbenchSession.startWorkspaceBackend()
    } catch {
      // The backend publishes the actionable failed snapshot before rejecting.
    }
    await this.refreshSessionSnapshot()
  }

  protected readonly stopSession = async (): Promise<void> => {
    await this.workbenchSession.stop()
    await this.refreshSessionSnapshot()
  }

  protected readonly stopWorkspaceBackend = async (): Promise<void> => {
    await this.workbenchSession.stopWorkspaceBackend()
    await this.refreshSessionSnapshot()
  }

  protected readonly restartSession = async (): Promise<void> => {
    try {
      await this.workbenchSession.restart()
    } catch {
      // The backend publishes the actionable failed snapshot before rejecting.
    }
    await this.refreshSessionSnapshot()
  }

  protected readonly rebuildLocalData = async (): Promise<void> => {
    await runAndRefreshWorkbenchOperation(
      () => this.workbenchSession.rebuildLocalData().then(() => undefined),
      () => this.refreshSessionSnapshot()
    )
  }

  protected readonly publishRelease = async (
    backendUrl: string,
    resetTarget = false
  ): Promise<WorkbenchReleaseReceipt> => {
    if (this.lastReportedUnsavedChanges) {
      throw new Error('请先保存当前工作流修改，再发布 WorkspaceRelease')
    }
    try {
      const receipt = await this.workbenchSession.publishRelease({
        activate: true,
        backendUrl,
        resetTarget
      })
      this.sessionSnapshot = await this.workbenchSession.getSnapshot()
      if (receipt.activated) {
        this.connectionMode = 'backend'
        persistWorkbenchConnectionMode('backend')
      }
      void this.messages.info(
        `发布并校验完成：${receipt.counts.templates} 个模板、` +
        `${receipt.counts.materials} 个物料、${receipt.counts.workflows} 个工作流`
      )
      return receipt
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  /** 重启 PLC-Sim，并用当前设备图重建目标 Backend 的物料与库位状态。 */
  protected readonly resetWorkflowEnvironment = async (
    backendUrl: string
  ): Promise<void> => {
    if (this.lastReportedUnsavedChanges) {
      throw new Error('请先保存当前工作流修改，再复位运行环境')
    }
    try {
      await this.workbenchSession.stopPlcSimulator()
      await this.workbenchSession.startPlcSimulator()
      await this.publishRelease(backendUrl, true)
      this.recoveryRevision += 1
      void this.messages.info('运行环境已复位，可以重新运行工作流')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`运行环境复位失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
      this.update()
    }
  }

  protected readonly inspectReleaseTarget = async (
    backendUrl: string
  ): Promise<WorkbenchReleaseTargetInspection> => {
    return await this.workbenchSession.inspectReleaseTarget(backendUrl)
  }

  protected readonly readEnvironmentLog = async (
    kind: WorkbenchEnvironmentLogKind
  ): Promise<string> => this.workbenchSession.readEnvironmentLog(
    kind,
    32 * 1024
  )

  protected readonly configurePlcSimulator = async (
    configuration: WorkbenchPlcSimulatorConfiguration
  ): Promise<void> => {
    try {
      await this.workbenchSession.configurePlcSimulator(configuration)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`PLC-Sim 配置失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly refreshPlcVariableTables = async (): Promise<void> => {
    try {
      await this.workbenchSession.refreshPlcVariableTables()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`PLC 变量表扫描失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly configureGraph = async (graphPath: string): Promise<void> => {
    try {
      await this.workbenchSession.configureGraph(graphPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`设备图配置失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly setExternalDevicesOnly = async (
    enabled: boolean
  ): Promise<void> => {
    try {
      await this.workbenchSession.setExternalDevicesOnly(enabled)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`设备目录加载范围配置失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly startPlcSimulator = async (): Promise<void> => {
    try {
      await this.workbenchSession.startPlcSimulator()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`PLC-Sim 启动失败：${message}`)
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly stopPlcSimulator = async (): Promise<void> => {
    await this.workbenchSession.stopPlcSimulator()
    await this.refreshSessionSnapshot()
  }

  protected readonly releaseEnvironmentPorts = async (
    target: 'os' | 'plc-sim'
  ): Promise<void> => {
    try {
      await this.workbenchSession.releaseEnvironmentPorts(target)
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly startAgent = async (): Promise<void> => {
    try {
      await this.workbenchSession.startAgent()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`Agent 启动失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly stopAgent = async (): Promise<void> => {
    await this.workbenchSession.stopAgent()
    await this.refreshSessionSnapshot()
  }

  protected readonly restartAgent = async (): Promise<void> => {
    try {
      await this.workbenchSession.restartAgent()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`Agent 重启失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly setRuntimeMode = async (
    mode: WorkbenchRuntimeMode
  ): Promise<void> => {
    try {
      await this.workbenchSession.setRuntimeMode(mode)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`OS 模式切换失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected readonly setSchedulerUrl = async (
    url: string | null
  ): Promise<void> => {
    try {
      await this.workbenchSession.setSchedulerUrl(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`Scheduler 地址保存失败：${message}`)
      throw error
    } finally {
      await this.refreshSessionSnapshot()
    }
  }

  protected observeCurrentEditor(render = true): void {
    this.editorListeners.dispose()
    this.editorListeners = new DisposableCollection()
    const editorWidget = this.editorManager.currentEditor
    if (!editorWidget) {
      this.ideAdapter.acceptEditor({
        currentUri: null,
        dirty: false,
        cursor: null
      })
      this.snapshot = this.ideAdapter.snapshot.sync
      this.reportUnsavedChanges()
      if (render) this.update()
      return
    }
    const updateFromEditor = () => this.updateFromEditor(editorWidget)
    this.editorListeners.push(editorWidget.editor.onSelectionChanged(
      updateFromEditor
    ))
    this.editorListeners.push(editorWidget.editor.document.onDirtyChanged(
      updateFromEditor
    ))
    this.updateFromEditor(editorWidget, render)
  }

  protected updateFromEditor(editorWidget: EditorWidget, render = true): void {
    const previous = this.snapshot
    const currentUri = editorWidget.editor.uri.toString()
    const dirty = editorWidget.editor.document.dirty
    let cursor: { line: number; column: number } | null = null
    try {
      const editorCursor = editorWidget.editor.cursor
      cursor = {
        line: editorCursor.line + 1,
        column: editorCursor.character + 1
      }
    } catch {
      // Monaco can transiently have no position while its model is detaching.
    }
    this.ideAdapter.acceptEditor({
      currentUri,
      dirty,
      cursor
    })
    this.snapshot = this.ideAdapter.snapshot.sync
    this.reportUnsavedChanges()
    if (render) this.update()
    if (
      previous.currentUri === currentUri &&
      previous.dirty &&
      !dirty &&
      currentUri === previous.resolvedSourceUri &&
      this.sourceSaveHandler
    ) {
      const pythonSource = editorWidget.editor.document.getText()
      void this.sourceSaveHandler(pythonSource).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        void this.messages.error(`工作流源码同步失败：${message}`)
      })
    }
  }

  protected readonly registerSourceSaveHandler = (
    handler: SourceSaveHandler | null
  ): void => {
    this.sourceSaveHandler = handler
    if (handler) void this.synchronizeUnmappedSource()
  }

  protected readonly setWorkflowPanelDirty = (
    hasUnsavedChanges: boolean
  ): void => {
    this.workflowPanelDirty = hasUnsavedChanges
    this.reportUnsavedChanges()
  }

  /**
   * 原子切换后续界面请求和 Workspace Host 的真实运行权威。
   * 已有任务仍由原调度权威收敛；新请求只在目标工作流目录通过预检后开放。
   */
  protected readonly setConnectionMode = async (
    mode: WorkbenchConnectionMode
  ): Promise<void> => {
    if (
      mode === this.connectionMode
      && mode === this.sessionSnapshot.configuredDomainMode
    ) return
    if (this.connectionSwitchingTo) return
    if (this.lastReportedUnsavedChanges) {
      void this.messages.warn('请先保存当前工作流修改，再切换运行连接')
      return
    }
    const revision = ++this.connectionSwitchRevision
    this.connectionSwitchSurface =
      this.sessionSnapshot.phase === 'ready' && this.sessionSnapshot.identity
        ? this.sessionSnapshot
        : null
    this.connectionSwitchingTo = mode
    this.update()
    try {
      const session = await this.workbenchSession.setDomainAuthority(mode)
      if (revision !== this.connectionSwitchRevision) return
      this.sessionSnapshot = session
      const targets = createWorkbenchConnectionTargets({
        managedLocalUrl: session.identity?.backendUrl,
        browserOrigin: currentBrowserOrigin()
      })
      await preflightWorkbenchRuntimeAuthority(targets[mode])
      if (revision !== this.connectionSwitchRevision) return
      this.connectionMode = mode
      persistWorkbenchConnectionMode(mode)
      void this.messages.info(
        mode === 'backend'
          ? '已切换到 Backend：画布直接保存远端工作流，本地代码不再联动画布'
          : '已切换到本地：工作区代码与画布恢复双向联动'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const committed = this.sessionSnapshot.configuredDomainMode === mode
      void this.messages.error(
        committed
          ? `运行权威已切换，但工作流接口未就绪：${message}`
          : `运行连接未切换：${message}`
      )
    } finally {
      if (revision === this.connectionSwitchRevision) {
        await this.refreshSessionSnapshot()
        this.connectionMode = this.sessionSnapshot.configuredDomainMode
        persistWorkbenchConnectionMode(this.connectionMode)
        this.connectionSwitchingTo = null
        this.connectionSwitchSurface = null
        this.update()
      }
    }
  }

  protected reportUnsavedChanges(): void {
    const hasUnsavedChanges = hasWorkbenchUnsavedChanges(
      this.workflowPanelDirty,
      this.editorManager.all.map(widget => widget.editor.document.dirty)
    )
    if (this.lastReportedUnsavedChanges === hasUnsavedChanges) return
    this.lastReportedUnsavedChanges = hasUnsavedChanges
    publishDesktopUnsavedChanges(hasUnsavedChanges)
  }

  protected readonly setSourceProjection = (
    sourceProjection: WorkflowSourceProjection | null
  ): void => {
    // OS mount 到 Theia URI 是纯身份换算，必须和 projection 原子安装。
    // 中间态 update 会允许 React effect cleanup 把同一投影清空，形成竞态。
    const current = this.snapshot.sourceProjection
    if (
      current?.workflowUuid === sourceProjection?.workflowUuid &&
      current?.sourceVersion === sourceProjection?.sourceVersion &&
      current?.sourceUri === sourceProjection?.sourceUri &&
      current?.mappingAvailable === sourceProjection?.mappingAvailable
    ) return
    this.ideAdapter.acceptSourceProjection(sourceProjection)
    this.snapshot = this.ideAdapter.snapshot.sync
    // React effect 正在向宿主发布该投影；此处只更新宿主快照，不能同步要求
    // ReactWidget 重绘，否则 StrictMode/effect cleanup 会重入同一发布路径。
    this.observeCurrentEditor(false)
    void this.synchronizeUnmappedSource()
  }

  /**
   * 对已经落盘但尚无 source map 的源码执行一次同内容 CAS 编译。
   *
   * 文件字节由 Theia 文件服务读取；OS 会再次核对当前 draft hash，因此保存后
   * 发生的并发编辑不会被覆盖。同一源码版本只尝试一次，非法草稿不会形成循环。
   */
  protected async synchronizeUnmappedSource(): Promise<void> {
    const projection = this.snapshot.sourceProjection
    const resolvedSourceUri = this.snapshot.resolvedSourceUri
    const handler = this.sourceSaveHandler
    if (
      !projection || projection.mappingAvailable || !resolvedSourceUri ||
      !handler ||
      (
        this.snapshot.currentUri === resolvedSourceUri &&
        this.snapshot.dirty
      )
    ) return
    const attempt = `${projection.workflowUuid}:${projection.sourceVersion}`
    if (this.lastAutomaticSourceSync === attempt) return
    this.lastAutomaticSourceSync = attempt
    try {
      const source = await this.fileService.read(new URI(resolvedSourceUri))
      await handler(source.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`工作流源码补编译失败：${message}`)
    }
  }

  protected readonly revealResolvedSource = async (
    location: WorkflowIdeResolvedLocation
  ): Promise<void> => {
    const uri = new URI(location.resolvedUri)
    const existing = this.editorManager.all.find(
      candidate => candidate.editor.uri.toString() === uri.toString()
    )
    const widget = existing ?? await this.editorManager.open(uri, {
      mode: 'activate',
      widgetOptions: { area: 'main', mode: 'split-right', ref: this }
    })
    if (location.readOnly) {
      const monacoEditor = widget.editor as typeof widget.editor & {
        editor?: { updateOptions(options: { readOnly: boolean }): void }
      }
      monacoEditor.editor?.updateOptions({ readOnly: true })
    }
    if (existing) await this.shell.activateWidget(existing.id)
    const start = {
      line: location.line - 1,
      character: location.column - 1
    }
    const end = {
      line: location.endLine - 1,
      character: location.endColumn - 1
    }
    widget.editor.selection = { start, end, direction: 'ltr' }
    widget.editor.cursor = start
    widget.editor.revealRange({ start, end })
  }

  /** 在 Workbench 同一主标签组打开日志，避免分栏与固定工作台层叠。 */
  protected readonly openSessionLog = async (logPath: string): Promise<void> => {
    if (!logPath) throw new Error('当前会话尚未生成日志文件')
    const readableLogPath = await this.workbenchSession.prepareReadableLog(logPath)
    const uri = URI.fromFilePath(readableLogPath)
    const existing = this.editorManager.all.find(
      candidate => candidate.editor.uri.toString() === uri.toString()
    )
    if (existing) {
      await this.shell.closeWidget(existing.id, { save: false })
      return
    }
    const widget = await this.editorManager.open(uri, {
      mode: 'activate',
      widgetOptions: { area: 'main', mode: 'tab-after', ref: this }
    })
    widget.title.closable = true
    const monacoEditor = widget.editor as typeof widget.editor & {
      editor?: {
        updateOptions(options: {
          readOnly: boolean
          minimap: { enabled: boolean }
          wordWrap: 'off'
          renderControlCharacters: boolean
        }): void
      }
    }
    monacoEditor.editor?.updateOptions({
      readOnly: true,
      minimap: { enabled: false },
      wordWrap: 'off',
      renderControlCharacters: false
    })
  }

  protected readonly replaceDiagnostics = (
    diagnostics: readonly WorkflowIdeResolvedDiagnostic[]
  ): void => {
    const grouped = new Map<string, Diagnostic[]>()
    for (const diagnostic of diagnostics) {
      const markers = grouped.get(diagnostic.resolvedUri) ?? []
      markers.push({
        range: {
          start: {
            line: diagnostic.line - 1,
            character: diagnostic.column - 1
          },
          end: {
            line: diagnostic.endLine - 1,
            character: diagnostic.endColumn - 1
          }
        },
        severity: theiaDiagnosticSeverity(diagnostic.severity),
        code: diagnostic.code,
        source: diagnostic.source,
        message: diagnostic.message
      })
      grouped.set(diagnostic.resolvedUri, markers)
    }
    for (const uri of this.diagnosticUris) {
      if (!grouped.has(uri)) {
        this.problemManager.setMarkers(new URI(uri), 'unilab', [])
      }
    }
    for (const [uri, markers] of grouped) {
      this.problemManager.setMarkers(new URI(uri), 'unilab', markers)
    }
    this.diagnosticUris = new Set(grouped.keys())
  }

  protected override render(): React.ReactElement {
    const surfaceSnapshot = authoritySurfaceSnapshot(
      this.sessionSnapshot,
      this.connectionSwitchSurface,
      Boolean(this.connectionSwitchingTo)
    )
    const connectionTargets = createWorkbenchConnectionTargets({
      managedLocalUrl: surfaceSnapshot.identity?.backendUrl,
      browserOrigin: currentBrowserOrigin()
    })
    if (
      surfaceSnapshot.phase !== 'ready'
      || !surfaceSnapshot.identity
    ) {
      return (
        <WorkbenchSessionGate
          snapshot={surfaceSnapshot}
          onRetry={this.retrySession}
          onStop={this.stopWorkspaceBackend}
          launchMode={this.connectionSwitchingTo ?? this.connectionMode}
          switchingTo={this.connectionSwitchingTo}
          connectionSelector={(
            <WorkbenchConnectionSelector
              targets={connectionTargets}
              selectedMode={this.connectionMode}
              connection={sessionConnectionState(surfaceSnapshot.phase)}
              switchBlockedReason={this.lastReportedUnsavedChanges
                ? '请先保存当前工作流修改'
                : this.connectionSwitchingTo
                  ? '正在验证目标 Authority'
                : null}
              defaultOpen
              onSelect={this.setConnectionMode}
            />
          )}
          onOpenLog={this.openSessionLog}
          onReadEnvironmentLog={this.readEnvironmentLog}
          renderEnvironmentManager={onClose => (
            <EnvironmentManager
              session={surfaceSnapshot}
              onClose={onClose}
              onRestartSession={this.restartSession}
              onRebuildLocalData={this.rebuildLocalData}
              onInspectReleaseTarget={this.inspectReleaseTarget}
              onPublishRelease={this.publishRelease}
              onReadEnvironmentLog={this.readEnvironmentLog}
              onConfigureGraph={this.configureGraph}
              onSetExternalDevicesOnly={this.setExternalDevicesOnly}
              onConfigurePlcSimulator={this.configurePlcSimulator}
              onRefreshPlcVariableTables={this.refreshPlcVariableTables}
              onStartPlcSimulator={this.startPlcSimulator}
              onStopPlcSimulator={this.stopPlcSimulator}
              onReleaseEnvironmentPorts={this.releaseEnvironmentPorts}
              onStartAgent={this.startAgent}
              onStopAgent={this.stopAgent}
              onRestartAgent={this.restartAgent}
              onSetRuntimeMode={this.setRuntimeMode}
              onSetSchedulerUrl={this.setSchedulerUrl}
              onStopSession={this.stopSession}
            />
          )}
        />
      )
    }
    return (
      <WorkbenchSurface
        connectionMode={this.connectionMode}
        connectionSwitchingTo={this.connectionSwitchingTo}
        connectionTargets={connectionTargets}
        ideBridge={this.ideBridge}
        session={surfaceSnapshot}
        sessionClient={this.workbenchSessionClient}
        recoveryRevision={this.recoveryRevision}
        viewMode={this.viewState.currentMode}
        switchBlockedReason={this.lastReportedUnsavedChanges
          ? '请先保存当前工作流修改'
          : this.connectionSwitchingTo
            ? '正在验证目标 Authority'
          : null}
        onConnectionModeChange={this.setConnectionMode}
        onSourceSaveHandlerChange={this.registerSourceSaveHandler}
        onUnsavedChangesChange={this.setWorkflowPanelDirty}
        onRestartSession={this.restartSession}
        onRebuildLocalData={this.rebuildLocalData}
        onInspectReleaseTarget={this.inspectReleaseTarget}
        onPublishRelease={this.publishRelease}
        onResetWorkflowEnvironment={this.resetWorkflowEnvironment}
        onReadEnvironmentLog={this.readEnvironmentLog}
        onOpenLog={this.openSessionLog}
        onConfigureGraph={this.configureGraph}
        onSetExternalDevicesOnly={this.setExternalDevicesOnly}
        onConfigurePlcSimulator={this.configurePlcSimulator}
        onRefreshPlcVariableTables={this.refreshPlcVariableTables}
        onStartPlcSimulator={this.startPlcSimulator}
        onStopPlcSimulator={this.stopPlcSimulator}
        onReleaseEnvironmentPorts={this.releaseEnvironmentPorts}
        onStartAgent={this.startAgent}
        onStopAgent={this.stopAgent}
        onRestartAgent={this.restartAgent}
        onSetRuntimeMode={this.setRuntimeMode}
        onSetSchedulerUrl={this.setSchedulerUrl}
        onStopSession={this.stopSession}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.node.querySelector<HTMLElement>('button, input')?.focus()
  }
}

/**
 * 在 Workbench 主区组合工作流、物料、仪器设备与机械臂工作站界面。
 * @param props 当前 OS 会话、领域视图模式及由 Workbench 持有的运行控制回调。
 * @returns 共用一个 Theia 主区且不创建业务侧边栏的领域工作台。
 */
function WorkbenchSurface({
  connectionMode,
  connectionSwitchingTo,
  connectionTargets,
  ideBridge,
  session,
  sessionClient,
  recoveryRevision,
  viewMode,
  switchBlockedReason,
  onConnectionModeChange,
  onSourceSaveHandlerChange,
  onUnsavedChangesChange,
  onRestartSession,
  onRebuildLocalData,
  onInspectReleaseTarget,
  onPublishRelease,
  onResetWorkflowEnvironment,
  onReadEnvironmentLog,
  onOpenLog,
  onConfigureGraph,
  onSetExternalDevicesOnly,
  onConfigurePlcSimulator,
  onRefreshPlcVariableTables,
  onStartPlcSimulator,
  onStopPlcSimulator,
  onReleaseEnvironmentPorts,
  onStartAgent,
  onStopAgent,
  onRestartAgent,
  onSetRuntimeMode,
  onSetSchedulerUrl,
  onStopSession
}: WorkbenchSurfaceProps): React.JSX.Element {
  const [selectedWorkflowNode, setSelectedWorkflowNode] =
    useState<string | null>(null)
  const [runtimeProjection, setRuntimeProjection] =
    useState<WorkflowPanelRuntimeProjection | null>(null)
  const [selectedMaterialIds, setSelectedMaterialIds] =
    useState<readonly MaterialId[]>([])
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [environmentResetBusy, setEnvironmentResetBusy] = useState(false)
  const reportWorkflowUnsavedChanges = useCallback(
    (hasUnsavedChanges: boolean): void => {
      const desktopApi = (
        globalThis as typeof globalThis & {
          api?: {
            workflowAuthoring?: {
              setUnsavedChanges(value: boolean): void
            }
          }
        }
      ).api
      desktopApi?.workflowAuthoring?.setUnsavedChanges(hasUnsavedChanges)
    },
    []
  )
  const mountedDomains = useRef(new Set<WorkbenchMountedDomain>([
    'workflow'
  ]))
  recordMountedWorkbenchDomains(mountedDomains.current, viewMode)
  const query = new URLSearchParams(globalThis.location.search)
  const workflowUuid = query.get('workflowUuid') ?? undefined
  const selectedTarget = connectionTargets[connectionMode]
  const authorityScopeKey = workbenchAuthorityScopeKey(
    selectedTarget.cacheKey,
    session.identity?.workspacePath
  )
  const services = useMemo(
    () => createWorkbenchServices(selectedTarget),
    [selectedTarget.cacheKey]
  )
  const backendProbeServices = useMemo(
    () => connectionMode === 'backend'
      ? services
      : createWorkbenchServices(connectionTargets.backend),
    [connectionMode, connectionTargets.backend.cacheKey, services]
  )
  const [connectionProbeRevision, setConnectionProbeRevision] = useState(0)
  const backendTargetConnection = useBackendConnectionState(
    'backend',
    backendProbeServices,
    connectionProbeRevision
  )
  const connection = workbenchConnectionState(
    connectionMode,
    session.phase,
    backendTargetConnection
  )
  /** 重新执行当前 Backend 健康探测，不创建或推进任何工作流任务。 */
  const retryConnection = useCallback((): void => {
    setConnectionProbeRevision((revision) => revision + 1)
  }, [])
  const connectionRetry = connectionMode === 'backend'
    ? retryConnection
    : undefined
  const workstationData = useRobotWorkstationData(
    services,
    viewMode,
    recoveryRevision
  )
  const queryClient = useMemo(
    () => new QueryClient(),
    [selectedTarget.cacheKey]
  )
  const scope = useMemo(() => ({ kind: 'singleton' } as const), [])
  const materialStore = useMemo<MaterialStore>(() => createMaterialStore({
    scope,
    graph: services.materials,
    requireCapability: (capability) => {
      assertCapability(services.getCapabilityStatus(capability), capability)
    }
  }), [scope, services])
  const resourceSlotOptionsPort = useMemo(
    () => createWorkflowResourceSlotOptionsPort(services.materials, scope),
    [scope, services.materials]
  )
  const deviceConnection = workbenchDeviceConnection(
    connectionMode,
    connection,
    session.edgeRuntime.phase
  )
  const deviceBackend = selectedTarget.backend

  useEffect(() => () => materialStore.getState().reset(), [materialStore])

  useEffect(() => {
    if (recoveryRevision === 0) return
    materialStore.getState().reset()
    void queryClient.invalidateQueries()
  }, [materialStore, queryClient, recoveryRevision])

  useEffect(() => {
    reportWorkflowUnsavedChanges(false)
    return () => reportWorkflowUnsavedChanges(false)
  }, [reportWorkflowUnsavedChanges])

  useEffect(() => () => {
    queryClient.clear()
    services.dispose()
  }, [queryClient, services])

  useEffect(() => () => {
    if (backendProbeServices !== services) backendProbeServices.dispose()
  }, [backendProbeServices, services])

  const synchronizeSavedSource = useCallback(async (pythonSource: string) => {
    if (!workflowUuid) return
    try {
      await synchronizeSavedWorkflowSource(
        services.workflow,
        workflowUuid,
        pythonSource
      )
    } catch (error) {
      throw error
    }
  }, [services, workflowUuid])

  useEffect(() => {
    onSourceSaveHandlerChange(
      connectionMode === 'local' ? synchronizeSavedSource : null
    )
    return () => onSourceSaveHandlerChange(null)
  }, [connectionMode, onSourceSaveHandlerChange, synchronizeSavedSource])

  const highlightedMaterialIds = useMemo(() => {
    const route = runtimeProjection?.materialTransferRoutes.find(
      (candidate) => candidate.workflowNodeUuid === selectedWorkflowNode
    )
    return [
      route?.source.ownerMaterialId,
      route?.target.ownerMaterialId
    ].filter((value): value is string => Boolean(value))
  }, [runtimeProjection, selectedWorkflowNode])

  const workflowRunStatus = services.getCapabilityStatus('workflow.runTasks')
  const resetWorkflowEnvironment = useCallback(async (): Promise<void> => {
    setEnvironmentResetBusy(true)
    try {
      await onResetWorkflowEnvironment(selectedTarget.backend.apiUrl)
    } catch {
      // 宿主已展示可操作的失败消息；这里只负责结束按钮忙碌态。
    } finally {
      setEnvironmentResetBusy(false)
    }
  }, [onResetWorkflowEnvironment, selectedTarget.backend.apiUrl])

  const workflowSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--workflow"
      aria-label="工作流窗口"
    >
      <WorkflowPanel
        runtime={services.workflow}
        traceRuntime={desktopWorkflowTraceRuntime(
          typeof window === 'undefined' ? undefined : window
        )}
        authoringStatus={services.getCapabilityStatus(
          connectionMode === 'backend'
            ? 'workflow.editDefinitions'
            : 'workflow.authoring'
        )}
        definitionEditingMode={connectionMode === 'backend'
          ? 'backend'
          : 'workspace'}
        runStatus={workflowRunStatus}
        executionStatus={workflowExecutionStatusForConnection(
          connectionMode,
          session.edgeRuntime,
          workflowRunStatus
        )}
        resourceSlotOptionsPort={resourceSlotOptionsPort}
        active={isWorkflowWorkbenchView(viewMode)}
        workflowUuid={workflowUuid}
        activeWorkflowStorageKey={`unilab.workflow.active.${
          encodeURIComponent(authorityScopeKey)
        }.v1`}
        allowWorkflowSelection
        recoveryRevision={recoveryRevision}
        hideEmbeddedCodeEditor={
          connectionMode === 'local' && desktopWorkspaceApi() !== null
        }
        ideBridge={ideBridge}
        onUnsavedChangesChange={(hasUnsavedChanges) => {
          onUnsavedChangesChange(hasUnsavedChanges)
          reportWorkflowUnsavedChanges(hasUnsavedChanges)
        }}
        onSelectedWorkflowStepChange={setSelectedWorkflowNode}
        onWorkflowRuntimeProjectionChange={setRuntimeProjection}
        onResetEnvironment={resetWorkflowEnvironment}
        environmentResetBusy={environmentResetBusy}
      />
    </section>
  )
  const workflowTasksSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--workflow-tasks"
      aria-label="工作流任务窗口"
    >
      <WorkflowTaskList
        runtime={services.workflow}
        active={viewMode === 'workflow-tasks'}
        recoveryRevision={recoveryRevision}
      />
    </section>
  )
  const materialSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--material"
      aria-label="物料窗口"
    >
      <MaterialStoreProvider store={materialStore}>
        <MaterialWorkbench
          catalog={services.materials}
          profileId={`workbench:${selectedTarget.cacheKey}`}
          scope={scope}
          capabilities={{
            readTemplates: services.getCapabilityStatus(
              'material.readTemplates'
            ),
            readGraph: services.getCapabilityStatus('material.readGraph'),
            create: services.getCapabilityStatus('material.create'),
            updateConfig: services.getCapabilityStatus('material.updateConfig'),
            move: services.getCapabilityStatus('material.move')
          }}
          selectedMaterialIds={selectedMaterialIds}
          highlightedMaterialIds={highlightedMaterialIds}
          onSelectionChange={setSelectedMaterialIds}
          renderViewport={(viewportProps) => (
            <WorkbenchMaterialViewport
              {...viewportProps}
              backendUrl={selectedTarget.backend.apiUrl}
              sourceIdentity={{
                sourceId: selectedTarget.sourceId,
                authority: connectionMode,
                workspacePath: session.identity?.workspacePath ?? '',
                backendUrl: selectedTarget.backend.apiUrl,
                rendererGeneration: `${globalThis.location.origin}:${
                  session.identity?.generation ?? 'unknown'
                }`
              }}
              sessionClient={sessionClient}
              runtimeProjection={runtimeProjection}
              selectedWorkflowNode={selectedWorkflowNode}
            />
          )}
        />
      </MaterialStoreProvider>
    </section>
  )
  const deviceSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--device"
      aria-label="仪器设备窗口"
    >
      <DeviceManagementPanel
        services={services}
        backend={deviceBackend}
        backendEnabled={Boolean(selectedTarget.backend.apiUrl)}
        connection={deviceConnection}
        active={viewMode === 'device' || viewMode === 'device-material'}
      />
    </section>
  )
  const robotWorkstationSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--robot-workstation"
      aria-label="机械臂工作站窗口"
    >
      <RobotWorkstation
        module={workstationModule(viewMode)}
        actionContent={viewMode === 'robot-debug' ? (
          <DeviceManagementPanel
            services={services}
            backend={deviceBackend}
            backendEnabled={Boolean(selectedTarget.backend.apiUrl)}
            connection={deviceConnection}
            active={viewMode === 'robot-debug'}
          />
        ) : undefined}
        pointStatus={workstationData.pointStatus}
        benchSnapshot={workstationData.benchSnapshot}
        benchStatus={workstationData.benchStatus}
        reagentItems={workstationData.reagentItems}
        reagentStatus={workstationData.reagentStatus}
        reagentInfos={workstationData.reagentInfos}
        reagentInfoStatus={workstationData.reagentInfoStatus}
        reagentManagement={workstationData.reagentManagement}
        reagentInfoManagement={workstationData.reagentInfoManagement}
      />
    </section>
  )

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="unilab-workbench"
        data-workspace-path={session.identity?.workspacePath ?? ''}
        data-package-mount-count={
          session.identity?.packageMounts?.items.length ?? 0
        }
        data-session-generation={session.identity?.generation ?? ''}
        data-session-mode={session.identity?.mode ?? ''}
        data-workspace-backend-phase={session.phase}
        data-edge-runtime-phase={session.edgeRuntime.phase}
        data-plc-simulator-phase={session.plcSimulator.phase}
        data-workspace-graph-fingerprint={session.identity?.graphFingerprint ?? ''}
        data-package-catalog-revision={
          session.identity?.packageMounts?.catalogRevision ?? ''
        }
        data-connection-mode={connectionMode}
        data-authority-profile={selectedTarget.authorityProfile}
        data-authority-source-id={selectedTarget.sourceId}
        data-workspace-authoring-source-id={selectedTarget.authoringSourceId}
        data-backend-id={selectedTarget.backend.id}
        data-backend-api-url={selectedTarget.backend.apiUrl}
      >
        <WorkbenchHeader
          session={session}
          viewMode={viewMode}
          connectionTargets={connectionTargets}
          connectionMode={connectionMode}
          connection={connection}
          backendConnection={backendTargetConnection}
          switchBlockedReason={switchBlockedReason}
          connectionRetry={connectionRetry}
          environmentOpen={environmentOpen}
          onConnectionModeChange={onConnectionModeChange}
          onToggleEnvironment={() => setEnvironmentOpen(value => !value)}
          onReadEnvironmentLog={onReadEnvironmentLog}
          onOpenLog={onOpenLog}
        />
        {environmentOpen ? (
          <EnvironmentManager
            session={session}
            onClose={() => setEnvironmentOpen(false)}
            onRestartSession={onRestartSession}
            onRebuildLocalData={onRebuildLocalData}
            onInspectReleaseTarget={onInspectReleaseTarget}
            onPublishRelease={onPublishRelease}
            onReadEnvironmentLog={onReadEnvironmentLog}
            onConfigureGraph={onConfigureGraph}
            onSetExternalDevicesOnly={onSetExternalDevicesOnly}
            onConfigurePlcSimulator={onConfigurePlcSimulator}
            onRefreshPlcVariableTables={onRefreshPlcVariableTables}
            onStartPlcSimulator={onStartPlcSimulator}
            onStopPlcSimulator={onStopPlcSimulator}
            onReleaseEnvironmentPorts={onReleaseEnvironmentPorts}
            onStartAgent={onStartAgent}
            onStopAgent={onStopAgent}
            onRestartAgent={onRestartAgent}
            onSetRuntimeMode={onSetRuntimeMode}
            onSetSchedulerUrl={onSetSchedulerUrl}
            onStopSession={onStopSession}
          />
        ) : null}
        <WorkbenchAuthorityScopeBoundary scopeKey={authorityScopeKey}>
          <WorkbenchDomainLayout
            mode={viewMode}
            workflow={mountedSurface(
              mountedDomains.current,
              'workflow',
              workflowSurface
            )}
            workflowTasks={mountedSurface(
              mountedDomains.current,
              'workflow-tasks',
              workflowTasksSurface
            )}
            material={mountedSurface(
              mountedDomains.current,
              'material',
              materialSurface
            )}
            device={mountedSurface(
              mountedDomains.current,
              'device',
              deviceSurface
            )}
            robotWorkstation={mountedSurface(
              mountedDomains.current,
              'robot-workstation',
              robotWorkstationSurface
            )}
          />
        </WorkbenchAuthorityScopeBoundary>
        {connectionSwitchingTo ? (
          <WorkbenchAuthorityLoading mode={connectionSwitchingTo} />
        ) : null}
      </div>
    </QueryClientProvider>
  )
}
