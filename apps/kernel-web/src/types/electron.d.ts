import type { AuthSession } from './auth'
import type {
  DeviceCardActionRun,
  DeviceCardAgentEnvironmentInfo,
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardAuthoringSessionStatus,
  DeviceCardAuthoringTargetRequest,
  DeviceCardAuthoringTargetResponse,
  DeviceCardBounds,
  DeviceCardHostActionRequest,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard,
  OpenDeviceCardRequest,
  OpenDeviceCardWorkspaceRequest
} from '@unilab/device-card-sdk'
import type {
  CloudEnvironment,
  ConfigureLocalDeviceProvisioningInput,
  DevicePackageDownloadSummary,
  DevicePackageInspection,
  DevicePackageUploadRequest,
  DevicePackageUploadResult,
  DeviceProvisioningPathSelection,
  LocalDeviceProvisioning,
  StartLocalDeviceProvisioningInput
} from '@unilab/device-provisioning'
import type {
  DeviceSquareDetail,
  DeviceSquareListQuery,
  DeviceSquarePage,
  HttpRequestTraceEvent
} from '@unilab/services'

interface OpenedFile {
  path: string
  content: string
}

interface SavedFile {
  path: string
}

interface SaveFilePayload {
  path: string | null
  content: string
  defaultName?: string
}

interface SaveBinaryFilePayload {
  content: Uint8Array
  defaultName?: string
}

interface OpenFilePayload {
  accept?: 'json' | 'python'
}

export type LocalRuntimePathKind =
  | 'graph'
  | 'os'
  | 'szlab'
  | 'environment'
  | 'simulator'
  | 'edgeExecutable'
  | 'edgeWorkingDirectory'

export type LocalRuntimeEdgeCommandMode = 'generated' | 'custom'

export interface LocalRuntimeEnvironmentVariable {
  name: string
  value: string
}

export interface LocalRuntimeCustomEdgeCommand {
  executable: string
  workingDirectory: string
  args: string[]
  environment: LocalRuntimeEnvironmentVariable[]
}

export interface LocalRuntimeCommandPreview {
  executable: string
  args: string[]
  cwd: string
}

export interface LocalRuntimeLaunchConfig {
  graphPath: string
  osProjectPath: string
  szlabProjectPath: string
  environmentPath: string
  simulatorProjectPath: string
  edgeCommandMode: LocalRuntimeEdgeCommandMode
  customEdgeCommand: LocalRuntimeCustomEdgeCommand
}

export type LocalRuntimeMode = 'managed' | 'development'

export interface LocalRuntimeModeInfo {
  mode: LocalRuntimeMode
  label: string
  runtimeVersion: string | null
  defaultLaunchConfig?: LocalRuntimeLaunchConfig
}

export type LocalRuntimeAcceptanceStatus =
  | 'unverified'
  | 'verified'
  | 'failed'

export interface LocalRuntimeAcceptanceResult {
  status: LocalRuntimeAcceptanceStatus
  message: string
  checkedAt: number | null
  descriptorPath: string | null
  packageName: string | null
  packageVersion: string | null
}

export interface DevicePackageTrustInfo {
  workspacePath: string
  contentHash: string
  signatureStatus: 'valid' | 'invalid' | 'unsigned'
  signerFingerprint: string | null
  trusted: boolean
  confirmationRequired: boolean
}

export type LocalRuntimeProcessKind = 'simulator' | 'bridge' | 'edge'

export interface LocalRuntimeLogEntry {
  kind: LocalRuntimeProcessKind
  content: string
  available: boolean
  truncated: boolean
}

export interface LocalRuntimeLogsSnapshot {
  readAt: number
  entries: LocalRuntimeLogEntry[]
}

export interface LocalRuntimeLogCursor {
  fileId: string
  offset: number
}

export interface LocalRuntimeLogQuery {
  kind: LocalRuntimeProcessKind
  cursor: LocalRuntimeLogCursor | null
}

export interface LocalRuntimeLogBatch extends LocalRuntimeLogEntry {
  readAt: number
  cursor: LocalRuntimeLogCursor | null
  reset: boolean
}

export interface LocalRuntimeOpenLogResult {
  opened: boolean
  error?: string
}

export type LocalRuntimePhase =
  | 'idle'
  | 'validating_simulator'
  | 'starting_simulator'
  | 'waiting_simulator'
  | 'simulator_ready'
  | 'validating_edge'
  | 'starting_bridge'
  | 'waiting_bridge'
  | 'starting_edge'
  | 'waiting_edge'
  | 'validating_acceptance'
  | 'cleaning_acceptance'
  | 'ready'
  | 'stopping_simulator'
  | 'stopping_edge'
  | 'failed'

export interface LocalRuntimeSnapshot {
  phase: LocalRuntimePhase
  message: string
  simulatorRunning: boolean
  bridgeRunning: boolean
  edgeRunning: boolean
  acceptance?: LocalRuntimeAcceptanceResult
  failedProcess?: LocalRuntimeProcessKind
  error?: string
}

export interface DesktopRuntimeApi {
  selectPath: (kind: LocalRuntimePathKind) => Promise<string | null>
  getDefaultEnvironmentPath: () => Promise<string | null>
  resolveGeneratedEdgeCommand?: (
    config: LocalRuntimeLaunchConfig
  ) => Promise<LocalRuntimeCommandPreview>
  getSnapshot: () => Promise<LocalRuntimeSnapshot>
  getModeInfo: () => Promise<LocalRuntimeModeInfo>
  inspectDevicePackage: (
    config: LocalRuntimeLaunchConfig
  ) => Promise<DevicePackageTrustInfo>
  confirmDevicePackage: (
    config: LocalRuntimeLaunchConfig,
    expectedHash: string
  ) => Promise<DevicePackageTrustInfo>
  startSimulator: (
    config: LocalRuntimeLaunchConfig
  ) => Promise<LocalRuntimeSnapshot>
  stopSimulator: () => Promise<LocalRuntimeSnapshot>
  startEdge: (config: LocalRuntimeLaunchConfig) => Promise<LocalRuntimeSnapshot>
  stopEdge: () => Promise<LocalRuntimeSnapshot>
  runAcceptance: (
    config: LocalRuntimeLaunchConfig
  ) => Promise<LocalRuntimeSnapshot>
  readLogs: () => Promise<LocalRuntimeLogsSnapshot>
  readLog?: (query: LocalRuntimeLogQuery) => Promise<LocalRuntimeLogBatch>
  openLogFile?: (
    kind: LocalRuntimeProcessKind
  ) => Promise<LocalRuntimeOpenLogResult>
  onSnapshot: (
    listener: (snapshot: LocalRuntimeSnapshot) => void
  ) => () => void
}

export interface DesktopDeviceProvisioningApi {
  listCloudDevices: (
    cloudEnvironment: CloudEnvironment,
    query?: DeviceSquareListQuery
  ) => Promise<DeviceSquarePage>
  getCloudDevice: (
    cloudEnvironment: CloudEnvironment,
    templateUuid: string
  ) => Promise<DeviceSquareDetail>
  list: () => Promise<LocalDeviceProvisioning[]>
  start: (
    input: StartLocalDeviceProvisioningInput
  ) => Promise<LocalDeviceProvisioning>
  downloadOnly: (
    input: StartLocalDeviceProvisioningInput
  ) => Promise<DevicePackageDownloadSummary>
  configure: (
    input: ConfigureLocalDeviceProvisioningInput
  ) => Promise<LocalDeviceProvisioning>
  activate: (provisioningId: string) => Promise<LocalDeviceProvisioning>
  retry: (provisioningId: string) => Promise<LocalDeviceProvisioning>
  remove: (provisioningId: string) => Promise<LocalDeviceProvisioning>
  restore: (provisioningId: string) => Promise<LocalDeviceProvisioning>
  selectPath: (
    selection: DeviceProvisioningPathSelection
  ) => Promise<string | null>
  inspectWorkspace: (workspacePath: string) => Promise<DevicePackageInspection>
  uploadWorkspace: (
    request: DevicePackageUploadRequest
  ) => Promise<DevicePackageUploadResult>
  onChanged: (
    listener: (items: LocalDeviceProvisioning[]) => void
  ) => () => void
}

export type ObservabilityState =
  | 'disabled'
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'degraded'

export interface ObservabilityStatus {
  enabled: boolean
  state: ObservabilityState
  provider: 'phoenix'
  storage: 'sqlite'
  project_name: string
  managed_process: boolean
  last_error: string | null
}

export interface TraceListQuery {
  limit?: number
  cursor?: string
  startTime?: string
  endTime?: string
  sort?: 'start_time' | 'latency_ms'
  order?: 'asc' | 'desc'
  includeSpans?: boolean
  sessionIdentifiers?: string[]
}

export interface TraceDetailQuery {
  limit?: number
  cursor?: string
}

export interface TraceListResult {
  project_name: string
  traces: Record<string, unknown>[]
  next_cursor: string | null
}

export interface TraceDetailResult {
  project_name: string
  trace_id: string
  spans: Record<string, unknown>[]
  next_cursor: string | null
}

export interface DesktopObservabilityApi {
  getStatus: () => Promise<ObservabilityStatus>
  listTraces: (query?: TraceListQuery) => Promise<TraceListResult>
  getTrace: (
    traceId: string,
    query?: TraceDetailQuery
  ) => Promise<TraceDetailResult>
  recordHttpRequest?: (event: HttpRequestTraceEvent) => Promise<void>
}

export type WorkbenchRemoteAccessPhase =
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface WorkbenchRemoteAccessSnapshot {
  phase: WorkbenchRemoteAccessPhase
  origin: string | null
  accessUrl: string | null
  pid: number | null
  generation: string | null
  expiresAt: number | null
  error: string | null
}

export interface DesktopWorkbenchRemoteApi {
  getSnapshot: () => Promise<WorkbenchRemoteAccessSnapshot>
  start: () => Promise<WorkbenchRemoteAccessSnapshot>
  stop: () => Promise<WorkbenchRemoteAccessSnapshot>
}

export interface WorkbenchWorkspaceSnapshot {
  phase: 'unavailable' | 'welcome' | 'starting' | 'ready' | 'stopping' | 'failed'
  activeWorkspace: string | null
  recentWorkspaces: Array<{
    path: string
    name: string
    lastOpenedAt: string
  }>
  error: string | null
}

export interface DesktopWorkbenchWorkspaceApi {
  getSnapshot: () => Promise<WorkbenchWorkspaceSnapshot>
  openDirectory: (
    entryMode?: 'debug' | 'production'
  ) => Promise<WorkbenchWorkspaceSnapshot>
  createDirectory: (
    entryMode?: 'debug' | 'production'
  ) => Promise<WorkbenchWorkspaceSnapshot>
  openRecent: (
    path: string,
    entryMode?: 'debug' | 'production'
  ) => Promise<WorkbenchWorkspaceSnapshot>
  selectDirectory: (
    entryMode?: 'debug' | 'production'
  ) => Promise<WorkbenchWorkspaceSnapshot>
  switchToWelcome: () => Promise<{
    switched: boolean
    snapshot: WorkbenchWorkspaceSnapshot
  }>
  onSnapshot: (
    listener: (snapshot: WorkbenchWorkspaceSnapshot) => void
  ) => () => void
}

export type ManagedRuntimeInstallationPhase =
  | 'unavailable'
  | 'external'
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'failed'

export interface ManagedRuntimeInstallationSnapshot {
  phase: ManagedRuntimeInstallationPhase
  bundled: boolean
  managed: boolean
  runtimeVersion: string | null
  platform: string | null
  environmentPath: string | null
  availableEnvironments: Array<{
    kind: 'managed' | 'external'
    label: string
    path: string
  }>
  error: string | null
}

export interface DesktopManagedRuntimeInstallationApi {
  getSnapshot: () => Promise<ManagedRuntimeInstallationSnapshot>
  install: () => Promise<ManagedRuntimeInstallationSnapshot>
  selectEnvironment: (path: string) => Promise<ManagedRuntimeInstallationSnapshot>
  chooseEnvironment: () => Promise<ManagedRuntimeInstallationSnapshot>
  onSnapshot: (
    listener: (snapshot: ManagedRuntimeInstallationSnapshot) => void
  ) => () => void
}

interface DesktopApi {
  getVersion: () => Promise<string>
  unsavedChanges?: {
    set: (hasUnsavedChanges: boolean) => void
  }
  workbenchRemote?: DesktopWorkbenchRemoteApi
  workbenchWorkspace?: DesktopWorkbenchWorkspaceApi
  managedRuntime?: DesktopManagedRuntimeInstallationApi
  auth: {
    getSession: () => Promise<AuthSession | null>
    login: () => Promise<AuthSession | null>
    logout: () => Promise<boolean>
  }
  file?: {
    open: (payload?: OpenFilePayload) => Promise<OpenedFile | null>
    save: (payload: SaveFilePayload) => Promise<SavedFile | null>
    saveBinary: (
      payload: SaveBinaryFilePayload
    ) => Promise<SavedFile | null>
  }
  deviceCards?: {
    list: () => Promise<InstalledDeviceCard[]>
    importCard: () => Promise<InstalledDeviceCard | null>
    agent: {
      getInfo: () => Promise<DeviceCardAgentEnvironmentInfo>
      installCli: () => Promise<DeviceCardAgentEnvironmentInfo>
      removeCli: () => Promise<DeviceCardAgentEnvironmentInfo>
      setBridgeEnabled: (
        enabled: boolean
      ) => Promise<DeviceCardAgentEnvironmentInfo>
    }
    authoring: {
      prepare: (input: {
        deviceId: string
        profile: DeviceCardAuthoringProfile
      }) => Promise<DeviceCardAuthoringSessionStatus | null>
      get: () => Promise<DeviceCardAuthoringSessionStatus | null>
      reveal: (path: string) => Promise<void>
      onTargetRequest: (
        listener: (request: DeviceCardAuthoringTargetRequest) => void
      ) => () => void
      resolveTargetRequest: (
        response: DeviceCardAuthoringTargetResponse
      ) => void
    }
    workspace: {
      get: () => Promise<DeviceCardWorkspaceStatus | null>
      open: (
        context?: DeviceCardAuthoringContext
      ) => Promise<DeviceCardWorkspaceStatus | null>
      close: () => Promise<void>
      rebuild: () => Promise<DeviceCardWorkspaceStatus>
      install: () => Promise<InstalledDeviceCard>
      exportCard: () => Promise<SavedFile | null>
      preview: (request: OpenDeviceCardWorkspaceRequest) => Promise<void>
      onStatus: (
        listener: (status: DeviceCardWorkspaceStatus | null) => void
      ) => () => void
    }
    open: (request: OpenDeviceCardRequest) => Promise<void>
    updateBounds: (bounds: DeviceCardBounds) => Promise<void>
    setOccluded: (source: string, occluded: boolean) => Promise<void>
    updateState: (state: Record<string, unknown>) => Promise<void>
    close: () => Promise<void>
    resolveAction: (run: DeviceCardActionRun) => Promise<void>
    onActionRequest: (
      listener: (request: DeviceCardHostActionRequest) => void
    ) => () => void
  }
  runtime?: DesktopRuntimeApi
  deviceProvisioning?: DesktopDeviceProvisioningApi
  observability?: DesktopObservabilityApi
}

declare global {
  interface Window {
    api?: DesktopApi
  }
}

export {}
