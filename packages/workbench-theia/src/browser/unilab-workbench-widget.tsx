import { EditorManager, EditorWidget } from '@theia/editor/lib/browser'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { ApplicationShell, Message } from '@theia/core/lib/browser'
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
import {
  MaterialCapabilityNotice,
  MaterialStoreProvider,
  MaterialWorkbench,
  UnifiedMaterialViewport,
  createMaterialStore,
  useMaterialStore,
  useMaterialStoreApi,
  type MaterialId,
  type MaterialStore,
  type MaterialWorkbenchViewportProps
} from '@unilab/material'
import type {
  MaterialSceneMove,
  MaterialTransferSceneRoute
} from '@unilab/pascal-lab-plugin'
import { ensurePascalRendererDefaults } from '@unilab/pascal-host'
import {
  assertCapability,
  createServices,
  getDefaultBackend,
  type Services
} from '@unilab/services'
import {
  activateSceneRuntimeScope,
  sceneRuntimeScopeId
} from '@unilab/scene-runtime'
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
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

ensurePascalRendererDefaults()

const PascalLabWorkbench = React.lazy(async () => {
  const module = await import('@unilab/pascal-lab-plugin')
  return { default: module.PascalLabWorkbench }
})

import {
  WorkbenchSessionClient,
  WorkbenchSessionServer
} from '../common/workbench-session-protocol'
import { WorkbenchSessionClientImpl } from './workbench-session-client'
import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import { EnvironmentManager } from './environment-manager'
import { createTheiaWorkflowIdeAdapter } from './theia-workflow-ide-adapter'
import { WorkbenchDomainLayout } from './workbench-domain-layout'
import { WorkbenchDeviceSurface } from './workbench-device-cards'
import { WorkbenchSessionGate } from './workbench-session-gate'
import {
  WorkbenchViewState,
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

  protected editorListeners = new DisposableCollection()
  protected snapshot = createWorkflowIdeSyncState()
  protected ideAdapter!: WorkflowIdeHostAdapter
  protected ideBridge!: WorkflowIdeBridge
  protected diagnosticUris = new Set<string>()
  protected sessionSnapshot: WorkbenchSessionSnapshot = {
    phase: 'idle',
    message: '正在连接 Workbench Backend…',
    configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
    configuredSkipWorkflowSourceActivation: false,
    configuredRuntimeMode: 'normal',
    identity: null,
    agent: null,
    diagnostic: null,
    plcSimulator: emptyPlcSimulatorSnapshot()
  }
  protected sourceSaveHandler: SourceSaveHandler | null = null
  protected lastAutomaticSourceSync: string | null = null
  protected workflowPanelDirty = false
  protected lastReportedUnsavedChanges: boolean | null = null
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
      this.ideAdapter.setPackageMounts(
        snapshot.identity?.packageMounts?.items ?? []
      )
      this.update()
    }))
    this.toDispose.push(this.viewState.onDidChangeMode(() => this.update()))
    void this.refreshSessionSnapshot()
    this.observeCurrentEditor()
    this.update()
  }

  protected async refreshSessionSnapshot(): Promise<void> {
    try {
      this.sessionSnapshot = await this.workbenchSession.getSnapshot()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sessionSnapshot = {
        phase: 'failed',
        message: 'Workbench Backend 连接失败',
        configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
        configuredSkipWorkflowSourceActivation: false,
        configuredRuntimeMode: 'normal',
        identity: null,
        agent: null,
        diagnostic: {
          code: 'os_start_failed',
          message,
          recovery: '确认 Workbench Backend 正在运行后重新加载窗口'
        },
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
      await this.workbenchSession.start()
    } catch {
      // The backend publishes the actionable failed snapshot before rejecting.
    }
    await this.refreshSessionSnapshot()
  }

  protected readonly stopSession = async (): Promise<void> => {
    await this.workbenchSession.stop()
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

  protected readonly setSkipWorkflowSourceActivation = async (
    enabled: boolean
  ): Promise<void> => {
    try {
      await this.workbenchSession.setSkipWorkflowSourceActivation(enabled)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void this.messages.error(`禁止重构工作流配置失败：${message}`)
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

  /** 在 Workbench 主编辑区打开当前会话日志。 */
  protected readonly openSessionLog = async (logPath: string): Promise<void> => {
    if (!logPath) throw new Error('当前会话尚未生成日志文件')
    const uri = URI.fromFilePath(logPath)
    const existing = this.editorManager.all.find(
      candidate => candidate.editor.uri.toString() === uri.toString()
    )
    if (existing) {
      await this.shell.activateWidget(existing.id)
      return
    }
    await this.editorManager.open(uri, {
      mode: 'activate',
      widgetOptions: { area: 'main', mode: 'split-right', ref: this }
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
    if (
      this.sessionSnapshot.phase !== 'ready'
      || !this.sessionSnapshot.identity
    ) {
      return (
        <WorkbenchSessionGate
          snapshot={this.sessionSnapshot}
          onRetry={this.retrySession}
          onStop={this.stopSession}
          onOpenLog={this.openSessionLog}
          renderEnvironmentManager={onClose => (
            <EnvironmentManager
              session={this.sessionSnapshot}
              onClose={onClose}
              onRestartSession={this.restartSession}
              onReadEnvironmentLog={this.readEnvironmentLog}
              onConfigureGraph={this.configureGraph}
              onSetSkipWorkflowSourceActivation={
                this.setSkipWorkflowSourceActivation
              }
              onConfigurePlcSimulator={this.configurePlcSimulator}
              onRefreshPlcVariableTables={this.refreshPlcVariableTables}
              onStartPlcSimulator={this.startPlcSimulator}
              onStopPlcSimulator={this.stopPlcSimulator}
              onReleaseEnvironmentPorts={this.releaseEnvironmentPorts}
              onStartAgent={this.startAgent}
              onStopAgent={this.stopAgent}
              onRestartAgent={this.restartAgent}
              onSetRuntimeMode={this.setRuntimeMode}
              onStopSession={this.stopSession}
            />
          )}
        />
      )
    }
    return (
      <WorkbenchSurface
        backendUrl={this.sessionSnapshot.identity.backendUrl}
        ideBridge={this.ideBridge}
        session={this.sessionSnapshot}
        viewMode={this.viewState.currentMode}
        onSourceSaveHandlerChange={this.registerSourceSaveHandler}
        onUnsavedChangesChange={this.setWorkflowPanelDirty}
        onRestartSession={this.restartSession}
        onReadEnvironmentLog={this.readEnvironmentLog}
        onConfigureGraph={this.configureGraph}
        onSetSkipWorkflowSourceActivation={this.setSkipWorkflowSourceActivation}
        onConfigurePlcSimulator={this.configurePlcSimulator}
        onRefreshPlcVariableTables={this.refreshPlcVariableTables}
        onStartPlcSimulator={this.startPlcSimulator}
        onStopPlcSimulator={this.stopPlcSimulator}
        onReleaseEnvironmentPorts={this.releaseEnvironmentPorts}
        onStartAgent={this.startAgent}
        onStopAgent={this.stopAgent}
        onRestartAgent={this.restartAgent}
        onSetRuntimeMode={this.setRuntimeMode}
        onStopSession={this.stopSession}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.node.querySelector<HTMLElement>('button, input')?.focus()
  }
}

function WorkbenchSurface({
  backendUrl,
  ideBridge,
  session,
  viewMode,
  onSourceSaveHandlerChange,
  onUnsavedChangesChange,
  onRestartSession,
  onReadEnvironmentLog,
  onConfigureGraph,
  onSetSkipWorkflowSourceActivation,
  onConfigurePlcSimulator,
  onRefreshPlcVariableTables,
  onStartPlcSimulator,
  onStopPlcSimulator,
  onReleaseEnvironmentPorts,
  onStartAgent,
  onStopAgent,
  onRestartAgent,
  onSetRuntimeMode,
  onStopSession
}: {
  backendUrl: string
  ideBridge: WorkflowIdeBridge
  session: WorkbenchSessionSnapshot
  viewMode: WorkbenchViewMode
  onSourceSaveHandlerChange: (handler: SourceSaveHandler | null) => void
  onUnsavedChangesChange: (hasUnsavedChanges: boolean) => void
  onRestartSession: () => Promise<void>
  onReadEnvironmentLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  onConfigureGraph: (graphPath: string) => Promise<void>
  onSetSkipWorkflowSourceActivation: (enabled: boolean) => Promise<void>
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
  onStopSession: () => Promise<void>
}): React.JSX.Element {
  const [selectedWorkflowNode, setSelectedWorkflowNode] =
    useState<string | null>(null)
  const [runtimeProjection, setRuntimeProjection] =
    useState<WorkflowPanelRuntimeProjection | null>(null)
  const [selectedMaterialIds, setSelectedMaterialIds] =
    useState<readonly MaterialId[]>([])
  const [environmentOpen, setEnvironmentOpen] = useState(false)
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
  const mountedDomains = useRef(new Set<'workflow' | 'material' | 'device'>([
    'workflow'
  ]))
  if (viewMode === 'workflow' || viewMode === 'split') {
    mountedDomains.current.add('workflow')
  }
  if (
    viewMode === 'material'
    || viewMode === 'split'
    || viewMode === 'device-material'
  ) {
    mountedDomains.current.add('material')
  }
  if (viewMode === 'device' || viewMode === 'device-material') {
    mountedDomains.current.add('device')
  }
  const query = new URLSearchParams(globalThis.location.search)
  const workflowUuid = query.get('workflowUuid') ?? undefined
  const services = useMemo(() => createWorkbenchServices(backendUrl), [backendUrl])
  const queryClient = useMemo(() => new QueryClient(), [])
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
  const deviceConnection = session.phase === 'ready'
    ? 'connected'
    : session.phase === 'failed'
      ? 'error'
      : session.phase === 'idle'
        ? 'disconnected'
        : 'connecting'
  const deviceBackend = useMemo(() => ({
    id: 'managed-local-os',
    name: '本地 UniLab OS',
    apiUrl: backendUrl
  }), [backendUrl])

  useEffect(() => {
    activateSceneRuntimeScope(sceneRuntimeScopeId(
      services.backend.id,
      services.backend.apiUrl
    ))
  }, [services.backend.apiUrl, services.backend.id])

  useEffect(() => () => materialStore.getState().reset(), [materialStore])

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
    onSourceSaveHandlerChange(synchronizeSavedSource)
    return () => onSourceSaveHandlerChange(null)
  }, [onSourceSaveHandlerChange, synchronizeSavedSource])

  const highlightedMaterialIds = useMemo(() => {
    const route = runtimeProjection?.materialTransferRoutes.find(
      (candidate) => candidate.workflowNodeUuid === selectedWorkflowNode
    )
    return [
      route?.source.ownerMaterialId,
      route?.target.ownerMaterialId
    ].filter((value): value is string => Boolean(value))
  }, [runtimeProjection, selectedWorkflowNode])

  const workflowSurface = (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--workflow"
      aria-label="工作流窗口"
    >
      <WorkflowPanel
        runtime={services.workflow}
        resourceSlotOptionsPort={resourceSlotOptionsPort}
        active={viewMode === 'workflow' || viewMode === 'split'}
        workflowUuid={workflowUuid}
        allowWorkflowSelection
        hideEmbeddedCodeEditor
        ideBridge={ideBridge}
        onUnsavedChangesChange={(hasUnsavedChanges) => {
          onUnsavedChangesChange(hasUnsavedChanges)
          reportWorkflowUnsavedChanges(hasUnsavedChanges)
        }}
        onSelectedWorkflowStepChange={setSelectedWorkflowNode}
        onWorkflowRuntimeProjectionChange={setRuntimeProjection}
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
          profileId={`workbench:${backendUrl}`}
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
              backendUrl={backendUrl}
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
      <WorkbenchDeviceSurface
        services={services}
        backend={deviceBackend}
        backendEnabled={Boolean(backendUrl)}
        connection={deviceConnection}
        active={viewMode === 'device' || viewMode === 'device-material'}
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
        data-workspace-graph-fingerprint={session.identity?.graphFingerprint ?? ''}
        data-package-catalog-revision={
          session.identity?.packageMounts?.catalogRevision ?? ''
        }
      >
        <header className="unilab-workbench__bar">
          <div>
            <strong>Unilab 调试工作台</strong>
            <span>
              OS PID {session.identity?.pid} · {session.identity?.mode} · {backendUrl}
            </span>
            <span className="unilab-workbench__view-mode">
              {viewMode === 'split'
                ? '工作流 + 物料'
                : viewMode === 'device-material'
                  ? '仪器设备 + 物料模型'
                : viewMode === 'workflow'
                  ? '工作流'
                  : viewMode === 'material'
                    ? '物料'
                    : viewMode === 'device'
                      ? '仪器设备'
                      : '未打开面板'}
            </span>
          </div>
          <nav aria-label="调试工作台页面">
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
        </header>
        {environmentOpen ? (
          <EnvironmentManager
            session={session}
            onClose={() => setEnvironmentOpen(false)}
            onRestartSession={onRestartSession}
            onReadEnvironmentLog={onReadEnvironmentLog}
            onConfigureGraph={onConfigureGraph}
            onSetSkipWorkflowSourceActivation={onSetSkipWorkflowSourceActivation}
            onConfigurePlcSimulator={onConfigurePlcSimulator}
            onRefreshPlcVariableTables={onRefreshPlcVariableTables}
            onStartPlcSimulator={onStartPlcSimulator}
            onStopPlcSimulator={onStopPlcSimulator}
            onReleaseEnvironmentPorts={onReleaseEnvironmentPorts}
            onStartAgent={onStartAgent}
            onStopAgent={onStopAgent}
            onRestartAgent={onRestartAgent}
            onSetRuntimeMode={onSetRuntimeMode}
            onStopSession={onStopSession}
          />
        ) : null}
        <WorkbenchDomainLayout
          mode={viewMode}
          workflow={mountedDomains.current.has('workflow')
            ? workflowSurface
            : null}
          material={mountedDomains.current.has('material')
            ? materialSurface
            : null}
          device={mountedDomains.current.has('device')
            ? deviceSurface
            : null}
        />
      </div>
    </QueryClientProvider>
  )
}

function WorkbenchMaterialViewport({
  backendUrl,
  runtimeProjection,
  selectedWorkflowNode,
  readStatus,
  moveStatus,
  selectedMaterialIds,
  highlightedMaterialIds,
  onSelectionChange
}: MaterialWorkbenchViewportProps & {
  backendUrl: string
  runtimeProjection: WorkflowPanelRuntimeProjection | null
  selectedWorkflowNode: string | null
}): React.JSX.Element {
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore((state) => state.aggregatesById)
  const shapeLibrary = useMaterialStore((state) => state.shapeLibrary)
  const loadState = useMaterialStore((state) => state.loadState)
  const aggregates = useMemo(
    () => Object.values(aggregatesById),
    [aggregatesById]
  )
  const materialTransferRoutes = useMemo<MaterialTransferSceneRoute[]>(
    () => (runtimeProjection?.materialTransferRoutes ?? []).map((route) => ({
      ...route,
      selected: route.workflowNodeUuid === selectedWorkflowNode
    })),
    [runtimeProjection, selectedWorkflowNode]
  )
  const modelRuntime = useMemo(() => ({
    resolveUrl: (model: { path: string }) => {
      if (!model.path || /^https?:\/\//u.test(model.path)) return model.path
      return new URL(
        model.path,
        `${backendUrl.replace(/\/+$/u, '')}/`
      ).toString()
    }
  }), [backendUrl])

  useEffect(() => {
    if (!readStatus.available || loadState !== 'idle') return
    void store.getState().loadGraph()
  }, [loadState, readStatus.available, store])

  const applyMoves = useCallback(async (
    moves: readonly MaterialSceneMove[]
  ): Promise<void> => {
    for (const move of moves) {
      await store.getState().move(move.materialId, move.placement)
    }
  }, [store])

  if (!readStatus.available) {
    return (
      <MaterialCapabilityNotice
        title="物料场景不可用"
        status={readStatus}
      />
    )
  }

  if (loadState === 'idle' || loadState === 'loading') {
    return <div className="unilab-workbench-material-loading">正在加载物料场景…</div>
  }

  return (
    <UnifiedMaterialViewport
      renderView={(viewMode, { showSites, showMaterialTransfers }) => (
        <Suspense
          fallback={(
            <div className="unilab-workbench-material-loading">
              正在加载 {viewMode === '3d' || viewMode === 'split'
                ? '3D'
                : viewMode} 物料视图…
            </div>
          )}
        >
          <PascalLabWorkbench
            aggregates={aggregates}
            shapes={shapeLibrary}
            showSites={showSites}
            showMaterialTransfers={showMaterialTransfers}
            materialTransferRoutes={materialTransferRoutes}
            materialTransferProjectionError={null}
            viewMode={viewMode}
            projectId={`unilab-workbench-${new URL(backendUrl).port}`}
            editable={moveStatus.available}
            selectedMaterialIds={selectedMaterialIds}
            highlightedMaterialIds={highlightedMaterialIds}
            modelRuntime={modelRuntime}
            onMaterialMoves={(moves) => void applyMoves(moves)}
            onSelectionChange={(materialIds) => {
              onSelectionChange?.(materialIds)
            }}
          />
        </Suspense>
      )}
    />
  )
}

function createWorkbenchServices(backendUrl: string): Services {
  const backend = getDefaultBackend('local-python')
  const url = backendUrl.replace(/\/$/, '')
  return createServices({
    backend: {
      ...backend,
      apiUrl: url,
      realtimeUrl: url.replace(/^http/, 'ws')
    }
  })
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
