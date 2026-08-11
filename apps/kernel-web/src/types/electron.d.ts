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
  DeviceSquarePage
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
  startSimulator: (
    config: LocalRuntimeLaunchConfig
  ) => Promise<LocalRuntimeSnapshot>
  stopSimulator: () => Promise<LocalRuntimeSnapshot>
  startEdge: (config: LocalRuntimeLaunchConfig) => Promise<LocalRuntimeSnapshot>
  stopEdge: () => Promise<LocalRuntimeSnapshot>
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
}

export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateSnapshot {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  checkedAt?: number
  errorCode?: 'CHECK_FAILED' | 'DOWNLOAD_FAILED' | 'INSTALL_FAILED'
}

export interface DesktopAppUpdateApi {
  getState: () => Promise<AppUpdateSnapshot>
  check: () => Promise<AppUpdateSnapshot>
  download: () => Promise<AppUpdateSnapshot>
  restartAndInstall: () => Promise<AppUpdateSnapshot>
  onState: (listener: (snapshot: AppUpdateSnapshot) => void) => () => void
}

interface DesktopApi {
  getVersion: () => Promise<string>
  appUpdate?: DesktopAppUpdateApi
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
