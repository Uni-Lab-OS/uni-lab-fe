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
import {
  DiagnosticSeverity,
  type Diagnostic
} from '@theia/core/shared/vscode-languageserver-protocol'
import {
  Disposable,
  DisposableCollection
} from '@theia/core/lib/common/disposable'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DeviceManagementConnection } from '@unilab/device-management'
import {
  MaterialStoreProvider,
  MaterialWorkbench,
  createMaterialStore,
  type MaterialId,
  type MaterialStore
} from '@unilab/material'
import {
  RobotWorkstation,
  type WorkstationModule
} from '@unilab/robot-workstation'
import {
  assertCapability
} from '@unilab/services'
import {
  createWorkflowResourceSlotOptionsPort,
  WorkflowPanel,
  type WorkflowPanelRuntimeProjection
} from '@unilab/workflow-editor'
import {
  createWorkflowIdeSyncState,
  synchronizeSavedWorkflowSource,
  WorkflowIdeHostAdapter,
  type WorkflowIdeBridge,
  type WorkflowIdeDiagnosticSeverity,
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
import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import { EnvironmentManager } from './environment-manager'
import { createTheiaWorkflowIdeAdapter } from './theia-workflow-ide-adapter'
import {
  createWorkbenchConnectionTargets,
  createWorkbenchServices,
  type WorkbenchConnectionMode,
  type WorkbenchConnectionTargets
} from './workbench-connection-profile'
import { preflightWorkbenchRuntimeAuthority } from './workbench-domain-authority'
import {
  WorkbenchConnectionSelector,
  type WorkbenchConnectionState
} from './workbench-connection-selector'
import {
  currentBrowserOrigin,
  initialWorkbenchConnectionMode,
  persistWorkbenchConnectionMode,
  sessionConnectionState,
  useBackendConnectionState
} from './workbench-connection-runtime'
import { useRobotWorkstationData } from './robot-workstation-data'
import { WorkbenchDomainLayout } from './workbench-domain-layout'
import { WorkbenchDeviceSurface } from './workbench-device-surface'
import { subscribeWorkbenchMaterialMoves } from './workbench-material-graph-load'
import { WorkbenchMaterialViewport } from './workbench-material-viewport'
import { workflowExecutionStatusForConnection } from './workbench-execution-readiness'
import {
  WorkbenchRuntimeLogLauncher,
  workbenchRuntimeLogPaths
} from './workbench-runtime-log-drawer'
import {
  runAndRefreshWorkbenchOperation,
  WorkbenchAuthorityLoading,
  WorkbenchSessionGate
} from './workbench-session-gate'
import {
  WorkbenchViewState,
  isRobotWorkbenchViewMode,
  type WorkbenchViewMode
} from './workbench-view-state'
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
  protected connectionSwitchRevision = 0
  protected connectionInterrupted = false
  protected recoveryRevision = 0
  @postConstruct()
  protected init(): void {
    this.ideAdapter = createTheiaWorkflowIdeAdapter({
      revealSource: location => this.revealResolvedSource(location),
      hideSource: resolvedUri => this.hideResolvedSource(resolvedUri),
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
        this.connectionSwitchingTo = null
        await this.refreshSessionSnapshot()
        this.connectionMode = this.sessionSnapshot.configuredDomainMode
        persistWorkbenchConnectionMode(this.connectionMode)
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

  /** 画布重新取得主区时关闭对应 Monaco 源码标签，未保存源码保持打开。 */
  protected readonly hideResolvedSource = async (
    resolvedUri: string
  ): Promise<void> => {
    const widgets = this.editorManager.all.filter(
      candidate => candidate.editor.uri.toString() === resolvedUri
    )
    for (const widget of widgets) {
      if (widget.editor.document.dirty) {
        throw new Error('工作流源码有未保存修改，不能退出代码模式')
      }
      await this.shell.closeWidget(widget.id, { save: false })
    }
    await this.shell.activateWidget(this.id)
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
    const connectionTargets = createWorkbenchConnectionTargets({
      managedLocalUrl: this.sessionSnapshot.identity?.backendUrl,
      browserOrigin: currentBrowserOrigin()
    })
    if (
      this.sessionSnapshot.phase !== 'ready'
      || !this.sessionSnapshot.identity
    ) {
      return (
        <WorkbenchSessionGate
          snapshot={this.sessionSnapshot}
          onRetry={this.retrySession}
          onStop={this.stopWorkspaceBackend}
          launchMode={this.connectionSwitchingTo ?? this.connectionMode}
          switchingTo={this.connectionSwitchingTo}
          connectionSelector={(
            <WorkbenchConnectionSelector
              targets={connectionTargets}
              selectedMode={this.connectionMode}
              connection={sessionConnectionState(this.sessionSnapshot.phase)}
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
              session={this.sessionSnapshot}
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
        session={this.sessionSnapshot}
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
}: {
  connectionMode: WorkbenchConnectionMode
  connectionSwitchingTo: WorkbenchConnectionMode | null
  connectionTargets: WorkbenchConnectionTargets
  ideBridge: WorkflowIdeBridge
  session: WorkbenchSessionSnapshot
  sessionClient: WorkbenchSessionClientImpl
  recoveryRevision: number
  viewMode: WorkbenchViewMode
  switchBlockedReason: string | null
  onConnectionModeChange: (mode: WorkbenchConnectionMode) => void
  onSourceSaveHandlerChange: (handler: SourceSaveHandler | null) => void
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void
  onRestartSession: () => Promise<void>
  onRebuildLocalData: () => Promise<void>
  onInspectReleaseTarget: (
    backendUrl: string
  ) => Promise<WorkbenchReleaseTargetInspection>
  onPublishRelease: (
    backendUrl: string,
    resetTarget?: boolean
  ) => Promise<WorkbenchReleaseReceipt>
  onResetWorkflowEnvironment: (backendUrl: string) => Promise<void>
  onReadEnvironmentLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  onOpenLog: (path: string) => Promise<void>
  onConfigureGraph: (graphPath: string) => Promise<void>
  onSetExternalDevicesOnly: (enabled: boolean) => Promise<void>
  onConfigurePlcSimulator: (
    configuration: WorkbenchPlcSimulatorConfiguration
  ) => Promise<void>
  onRefreshPlcVariableTables: () => Promise<void>
  onStartPlcSimulator: () => Promise<void>
  onStopPlcSimulator: () => Promise<void>
  onReleaseEnvironmentPorts: (target: 'os' | 'plc-sim') => Promise<void>
  onStartAgent: () => Promise<void>
  onStopAgent: () => Promise<void>
  onRestartAgent: () => Promise<void>
  onSetRuntimeMode: (mode: WorkbenchRuntimeMode) => Promise<void>
  onSetSchedulerUrl: (url: string | null) => Promise<void>
  onStopSession: () => Promise<void>
}): React.JSX.Element {
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
  const mountedDomains = useRef(new Set<
    'workflow' | 'material' | 'device' | 'robot-workstation'
  >([
    'workflow'
  ]))
  recordMountedWorkbenchDomains(mountedDomains.current, viewMode)
  const query = new URLSearchParams(globalThis.location.search)
  const workflowUuid = query.get('workflowUuid') ?? undefined
  const selectedTarget = connectionTargets[connectionMode]
  const services = useMemo(
    () => createWorkbenchServices(selectedTarget),
    [selectedTarget.cacheKey]
  )
  const [connectionProbeRevision, setConnectionProbeRevision] = useState(0)
  const backendConnection = useBackendConnectionState(
    connectionMode,
    services,
    connectionProbeRevision
  )
  const connection = workbenchConnectionState(
    connectionMode,
    session.phase,
    backendConnection
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
  const deviceConnection: DeviceManagementConnection = connection
  const deviceBackend = selectedTarget.backend

  useEffect(() => () => materialStore.getState().reset(), [materialStore])

  useEffect(() => subscribeWorkbenchMaterialMoves(
    materialStore,
    services.materials,
    services.getCapabilityStatus('material.subscribeMoves').available
  ), [materialStore, services])

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
          encodeURIComponent(selectedTarget.sourceId)
        }.v1`}
        allowWorkflowSelection
        recoveryRevision={recoveryRevision}
        hideEmbeddedCodeEditor={connectionMode === 'local'}
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
              realtime={services.realtime}
              jointRealtimeEnabled={
                services.capabilities.realtime.subscribeJointState
              }
              attachmentRealtimeEnabled={
                services.capabilities.realtime.subscribeKinematicAttachment
              }
              runtimeScopeId={selectedTarget.sourceId}
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
              cameraFocus={
                viewMode === 'device-material'
                  || viewMode === 'material-device'
                  || viewMode === 'material-robot-debug'
                  ? 'kinematics'
                  : 'scene'
              }
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
      <WorkbenchDeviceSurface
        services={services}
        backend={deviceBackend}
        backendEnabled={Boolean(selectedTarget.backend.apiUrl)}
        connection={deviceConnection}
        workspacePath={session.identity?.workspacePath ?? ''}
        runtimeRevision={session.edgeRuntime.phase}
        active={viewMode === 'device' || viewMode === 'device-material'
          || viewMode === 'material-device'}
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
        <header className="unilab-workbench__bar">
          <div className="unilab-workbench__identity">
            <strong>Unilab 调试工作台</strong>
            <span>
              {session.identity
                ? `Workspace Backend PID ${session.identity.pid} · ${session.identity.mode} · ${session.identity.backendUrl}`
                : 'Workspace Backend 尚未启动'}
            </span>
            <span className="unilab-workbench__view-mode">
              {workbenchViewLabel(viewMode)}
            </span>
          </div>
          <div className="unilab-workbench__controls">
            <WorkbenchConnectionSelector
              targets={connectionTargets}
              selectedMode={connectionMode}
              connection={connection}
              switchBlockedReason={switchBlockedReason}
              onRetry={connectionRetry}
              onSelect={onConnectionModeChange}
            />
            <nav aria-label="调试工作台页面">
              <WorkbenchRuntimeLogLauncher
                onReadLog={onReadEnvironmentLog}
                logPaths={workbenchRuntimeLogPaths(session)}
                onOpenLog={onOpenLog}
              />
              <button
                className={environmentOpen ? 'is-active' : ''}
                aria-expanded={environmentOpen}
                onClick={() => setEnvironmentOpen(value => !value)}
              >
                <span
                  className={`unilab-environment-trigger__status is-${session.phase}`}
                  aria-hidden="true"
                />
                环境管理
              </button>
              <DesktopWorkspaceSwitchButton />
            </nav>
          </div>
        </header>
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
        <WorkbenchDomainLayout
          key={selectedTarget.cacheKey}
          mode={viewMode}
          workflow={mountedSurface(
            mountedDomains.current,
            'workflow',
            workflowSurface
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
        {connectionSwitchingTo ? (
          <WorkbenchAuthorityLoading mode={connectionSwitchingTo} />
        ) : null}
      </div>
    </QueryClientProvider>
  )
}

type WorkbenchMountedDomain =
  | 'workflow'
  | 'material'
  | 'device'
  | 'robot-workstation'

/** 记录已经访问过的领域表面，使切换活动栏时保留面板本地状态。 */
function recordMountedWorkbenchDomains(
  mountedDomains: Set<WorkbenchMountedDomain>,
  mode: WorkbenchViewMode
): void {
  if (isWorkflowWorkbenchView(mode)) mountedDomains.add('workflow')
  if (
    mode === 'material' || mode === 'split'
    || mode === 'device-material' || mode === 'material-device'
    || mode === 'material-robot-debug'
  ) mountedDomains.add('material')
  if (
    mode === 'device' || mode === 'device-material'
    || mode === 'material-device'
  ) {
    mountedDomains.add('device')
  }
  if (
    isRobotWorkbenchViewMode(mode) || mode === 'material-robot-debug'
  ) mountedDomains.add('robot-workstation')
}

/** 返回工作流表面在当前 Workbench 领域模式下是否拥有可见权。 */
function isWorkflowWorkbenchView(mode: WorkbenchViewMode): boolean {
  return mode === 'workflow' || mode === 'split'
}

/** 选择当前调度权威对应的连接事实来源。 */
function workbenchConnectionState(
  mode: WorkbenchConnectionMode,
  sessionPhase: WorkbenchSessionSnapshot['phase'],
  backendConnection: WorkbenchConnectionState
): WorkbenchConnectionState {
  return mode === 'local'
    ? sessionConnectionState(sessionPhase)
    : backendConnection
}

/** 只为已经访问过的领域返回表面，避免无关模块抢占运行状态。 */
function mountedSurface(
  mountedDomains: Set<WorkbenchMountedDomain>,
  domain: WorkbenchMountedDomain,
  surface: React.ReactNode
): React.ReactNode {
  return mountedDomains.has(domain) ? surface : null
}

/** 返回 Workbench 标题栏使用的当前领域短名称。 */
function workbenchViewLabel(mode: WorkbenchViewMode): string {
  if (mode === 'material-device') return '仪器设备 + 物料'
  if (mode === 'material-robot-debug') return '物料 + 机械臂调试'
  if (mode === 'split') return '工作流 + 物料'
  if (mode === 'device-material') return '仪器设备 + 物料'
  if (mode === 'workflow') return '工作流'
  if (mode === 'material') return '物料'
  if (mode === 'device') return '仪器设备'
  if (isRobotWorkbenchViewMode(mode)) return workstationViewLabel(mode)
  return '未打开面板'
}

/**
 * 将 Workbench 机械臂活动栏模式映射为无二级导航的功能模块。
 * @param mode 当前主区模式；非机械臂模式仅用于未展示表面的稳定预渲染。
 * @returns 机械臂工作站包接受的模块标识。
 */
function workstationModule(mode: WorkbenchViewMode): WorkstationModule {
  if (mode === 'robot-points') return 'points'
  if (mode === 'robot-bench') return 'bench'
  if (mode === 'robot-reagents') return 'reagents'
  return 'debug'
}

/**
 * 返回机械臂活动栏模式对应的中文主区标题。
 * @param mode 已由类型守卫确认的机械臂模式。
 * @returns 当前功能入口的短标题。
 */
function workstationViewLabel(mode: `robot-${string}`): string {
  if (mode === 'robot-debug') return '动作调试'
  if (mode === 'robot-points') return '点位管理'
  if (mode === 'robot-bench') return '实验台'
  return '试剂'
}

function publishDesktopUnsavedChanges(hasUnsavedChanges: boolean): void {
  const desktopApi = (globalThis as typeof globalThis & {
    api?: { unsavedChanges?: { set(value: boolean): void } }
  }).api
  desktopApi?.unsavedChanges?.set(hasUnsavedChanges)
}

function theiaDiagnosticSeverity(
  severity: WorkflowIdeDiagnosticSeverity
): DiagnosticSeverity {
  switch (severity) {
    case 'error': return DiagnosticSeverity.Error
    case 'warning': return DiagnosticSeverity.Warning
    case 'information': return DiagnosticSeverity.Information
    case 'hint': return DiagnosticSeverity.Hint
  }
}

function emptyPlcSimulatorSnapshot(): WorkbenchSessionSnapshot['plcSimulator'] {
  return {
    phase: 'idle',
    message: '尚未连接环境管理器',
    projectPath: '',
    variableTablePath: '',
    variableTableCandidates: [],
    handshakeProfile: 'szlab',
    pid: null,
    guiUrl: '',
    opcUaUrl: '',
    logPath: '',
    diagnostic: null
  }
}

function emptyEdgeRuntimeSnapshot(): WorkbenchSessionSnapshot['edgeRuntime'] {
  return {
    phase: 'idle',
    message: 'Edge Runtime 尚未启动',
    pid: null,
    generation: null,
    graphPath: 'deployment/graphs/szlab-local-debug.json',
    mode: 'normal',
    logPath: '',
    diagnostic: null
  }
}
