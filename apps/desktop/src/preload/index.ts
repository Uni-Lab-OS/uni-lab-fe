import { contextBridge, ipcRenderer } from 'electron'
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
  LocalRuntimeLaunchConfig,
  LocalRuntimeCommandPreview,
  LocalRuntimeLogBatch,
  LocalRuntimeLogQuery,
  LocalRuntimeLogsSnapshot,
  LocalRuntimeOpenLogResult,
  LocalRuntimePathKind,
  LocalRuntimeProcessKind,
  LocalRuntimeSnapshot
} from '../shared/localRuntime'
import type {
  ObservabilityStatus,
  TraceDetailQuery,
  TraceDetailResult,
  TraceListQuery,
  TraceListResult
} from '../shared/observability'
import type { AppUpdateSnapshot } from '../shared/appUpdate'
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

// 登录会话结构(与主进程 authManager.AuthSession 保持一致)
export interface AuthUserInfo {
  name?: string
  email?: string
  userId?: string
}

export interface AuthSession {
  token: string
  userInfo: AuthUserInfo | null
  loggedInAt: number
}

// 本地文件读写结果
export interface OpenedFile {
  path: string
  content: string
}

export interface SavedFile {
  path: string
}

export interface SaveFilePayload {
  path: string | null
  content: string
  defaultName?: string
}

export interface SaveBinaryFilePayload {
  content: Uint8Array
  defaultName?: string
}

// 打开文件的入参:accept 指定对话框过滤的文件类型,缺省为 JSON
export interface OpenFilePayload {
  accept?: 'json' | 'python'
}

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  appUpdate: {
    getState: (): Promise<AppUpdateSnapshot> =>
      ipcRenderer.invoke('app-update:getState'),
    check: (): Promise<AppUpdateSnapshot> =>
      ipcRenderer.invoke('app-update:check'),
    download: (): Promise<AppUpdateSnapshot> =>
      ipcRenderer.invoke('app-update:download'),
    restartAndInstall: (): Promise<AppUpdateSnapshot> =>
      ipcRenderer.invoke('app-update:restartAndInstall'),
    onState: (
      listener: (snapshot: AppUpdateSnapshot) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        snapshot: AppUpdateSnapshot
      ): void => listener(snapshot)
      ipcRenderer.on('app-update:state', wrapped)
      return () => ipcRenderer.removeListener('app-update:state', wrapped)
    }
  },
  auth: {
    // 读取本地已保存的登录会话
    getSession: (): Promise<AuthSession | null> => ipcRenderer.invoke('auth:getSession'),
    // 发起 Bohrium OAuth 登录,成功返回会话,取消返回 null
    login: (): Promise<AuthSession | null> => ipcRenderer.invoke('auth:login'),
    // 登出并清除本地会话
    logout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout')
  },
  file: {
    // 打开本地文件(accept 指定类型,默认 JSON),取消返回 null
    open: (payload?: OpenFilePayload): Promise<OpenedFile | null> =>
      ipcRenderer.invoke('file:open', payload),
    // 保存文本到本地文件(path 为 null 时弹出"另存为"),取消返回 null
    save: (payload: SaveFilePayload): Promise<SavedFile | null> =>
      ipcRenderer.invoke('file:save', payload),
    // 保存二进制文件，始终弹出"另存为"，避免 renderer 指定任意覆盖路径
    saveBinary: (payload: SaveBinaryFilePayload): Promise<SavedFile | null> =>
      ipcRenderer.invoke('file:saveBinary', payload)
  },
  deviceCards: {
    list: (): Promise<InstalledDeviceCard[]> =>
      ipcRenderer.invoke('device-cards:list'),
    importCard: (): Promise<InstalledDeviceCard | null> =>
      ipcRenderer.invoke('device-cards:import'),
    agent: {
      getInfo: (): Promise<DeviceCardAgentEnvironmentInfo> =>
        ipcRenderer.invoke('device-cards:agent:getInfo'),
      installCli: (): Promise<DeviceCardAgentEnvironmentInfo> =>
        ipcRenderer.invoke('device-cards:agent:installCli'),
      removeCli: (): Promise<DeviceCardAgentEnvironmentInfo> =>
        ipcRenderer.invoke('device-cards:agent:removeCli'),
      setBridgeEnabled: (
        enabled: boolean
      ): Promise<DeviceCardAgentEnvironmentInfo> =>
        ipcRenderer.invoke('device-cards:agent:setBridgeEnabled', enabled)
    },
    authoring: {
      prepare: (input: {
        deviceId: string
        profile: DeviceCardAuthoringProfile
      }): Promise<DeviceCardAuthoringSessionStatus | null> =>
        ipcRenderer.invoke('device-cards:authoring:prepare', input),
      get: (): Promise<DeviceCardAuthoringSessionStatus | null> =>
        ipcRenderer.invoke('device-cards:authoring:get'),
      reveal: (path: string): Promise<void> =>
        ipcRenderer.invoke('device-cards:authoring:reveal', path),
      onTargetRequest: (
        listener: (request: DeviceCardAuthoringTargetRequest) => void
      ): (() => void) => {
        const wrapped = (
          _event: Electron.IpcRendererEvent,
          request: DeviceCardAuthoringTargetRequest
        ): void => listener(request)
        ipcRenderer.on('device-cards:authoringTargetRequest', wrapped)
        return () => ipcRenderer.removeListener(
          'device-cards:authoringTargetRequest',
          wrapped
        )
      },
      resolveTargetRequest: (
        response: DeviceCardAuthoringTargetResponse
      ): void => ipcRenderer.send(
        'device-cards:authoringTargetResponse',
        response
      )
    },
    workspace: {
      get: (): Promise<DeviceCardWorkspaceStatus | null> =>
        ipcRenderer.invoke('device-cards:workspace:get'),
      open: (
        context?: DeviceCardAuthoringContext
      ): Promise<DeviceCardWorkspaceStatus | null> =>
        ipcRenderer.invoke('device-cards:workspace:open', context),
      close: (): Promise<void> =>
        ipcRenderer.invoke('device-cards:workspace:close'),
      rebuild: (): Promise<DeviceCardWorkspaceStatus> =>
        ipcRenderer.invoke('device-cards:workspace:rebuild'),
      install: (): Promise<InstalledDeviceCard> =>
        ipcRenderer.invoke('device-cards:workspace:install'),
      exportCard: (): Promise<SavedFile | null> =>
        ipcRenderer.invoke('device-cards:workspace:export'),
      preview: (request: OpenDeviceCardWorkspaceRequest): Promise<void> =>
        ipcRenderer.invoke('device-cards:workspace:preview', request),
      onStatus: (
        listener: (status: DeviceCardWorkspaceStatus | null) => void
      ): (() => void) => {
        const wrapped = (
          _event: Electron.IpcRendererEvent,
          status: DeviceCardWorkspaceStatus | null
        ): void => listener(status)
        ipcRenderer.on('device-cards:workspaceStatus', wrapped)
        return () => ipcRenderer.removeListener(
          'device-cards:workspaceStatus',
          wrapped
        )
      }
    },
    open: (request: OpenDeviceCardRequest): Promise<void> =>
      ipcRenderer.invoke('device-cards:open', request),
    updateBounds: (bounds: DeviceCardBounds): Promise<void> =>
      ipcRenderer.invoke('device-cards:updateBounds', bounds),
    setOccluded: (source: string, occluded: boolean): Promise<void> =>
      ipcRenderer.invoke('device-cards:setOccluded', source, occluded),
    updateState: (state: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('device-cards:updateState', state),
    close: (): Promise<void> => ipcRenderer.invoke('device-cards:close'),
    resolveAction: (run: DeviceCardActionRun): Promise<void> =>
      ipcRenderer.invoke('device-cards:resolveAction', run),
    onActionRequest: (
      listener: (request: DeviceCardHostActionRequest) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        request: DeviceCardHostActionRequest
      ): void => listener(request)
      ipcRenderer.on('device-cards:actionRequest', wrapped)
      return () => ipcRenderer.removeListener(
        'device-cards:actionRequest',
        wrapped
      )
    }
  },
  runtime: {
    selectPath: (kind: LocalRuntimePathKind): Promise<string | null> =>
      ipcRenderer.invoke('runtime:selectPath', kind),
    getDefaultEnvironmentPath: (): Promise<string | null> =>
      ipcRenderer.invoke('runtime:getDefaultEnvironmentPath'),
    resolveGeneratedEdgeCommand: (
      config: LocalRuntimeLaunchConfig
    ): Promise<LocalRuntimeCommandPreview> =>
      ipcRenderer.invoke('runtime:resolveGeneratedEdgeCommand', config),
    getSnapshot: (): Promise<LocalRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:getSnapshot'),
    startSimulator: (
      config: LocalRuntimeLaunchConfig
    ): Promise<LocalRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:startSimulator', config),
    stopSimulator: (): Promise<LocalRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:stopSimulator'),
    startEdge: (
      config: LocalRuntimeLaunchConfig
    ): Promise<LocalRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:startEdge', config),
    stopEdge: (): Promise<LocalRuntimeSnapshot> =>
      ipcRenderer.invoke('runtime:stopEdge'),
    readLogs: (): Promise<LocalRuntimeLogsSnapshot> =>
      ipcRenderer.invoke('runtime:readLogs'),
    readLog: (query: LocalRuntimeLogQuery): Promise<LocalRuntimeLogBatch> =>
      ipcRenderer.invoke('runtime:readLog', query),
    openLogFile: (
      kind: LocalRuntimeProcessKind
    ): Promise<LocalRuntimeOpenLogResult> =>
      ipcRenderer.invoke('runtime:openLogFile', kind),
    onSnapshot: (
      listener: (snapshot: LocalRuntimeSnapshot) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        snapshot: LocalRuntimeSnapshot
      ): void => listener(snapshot)
      ipcRenderer.on('runtime:snapshot', wrapped)
      return () => ipcRenderer.removeListener('runtime:snapshot', wrapped)
    }
  },
  deviceProvisioning: {
    listCloudDevices: (
      cloudEnvironment: CloudEnvironment,
      query?: DeviceSquareListQuery
    ): Promise<DeviceSquarePage> =>
      ipcRenderer.invoke('device-provisioning:square:list', {
        cloudEnvironment,
        query
      }),
    getCloudDevice: (
      cloudEnvironment: CloudEnvironment,
      templateUuid: string
    ): Promise<DeviceSquareDetail> =>
      ipcRenderer.invoke('device-provisioning:square:detail', {
        cloudEnvironment,
        templateUuid
      }),
    list: (): Promise<LocalDeviceProvisioning[]> =>
      ipcRenderer.invoke('device-provisioning:list'),
    start: (
      input: StartLocalDeviceProvisioningInput
    ): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:start', input),
    downloadOnly: (
      input: StartLocalDeviceProvisioningInput
    ): Promise<DevicePackageDownloadSummary> =>
      ipcRenderer.invoke('device-provisioning:download', input),
    configure: (
      input: ConfigureLocalDeviceProvisioningInput
    ): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:configure', input),
    activate: (provisioningId: string): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:activate', provisioningId),
    retry: (provisioningId: string): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:retry', provisioningId),
    remove: (provisioningId: string): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:remove', provisioningId),
    restore: (provisioningId: string): Promise<LocalDeviceProvisioning> =>
      ipcRenderer.invoke('device-provisioning:restore', provisioningId),
    selectPath: (
      selection: DeviceProvisioningPathSelection
    ): Promise<string | null> =>
      ipcRenderer.invoke('device-provisioning:selectPath', selection),
    inspectWorkspace: (workspacePath: string): Promise<DevicePackageInspection> =>
      ipcRenderer.invoke('device-provisioning:inspect', workspacePath),
    uploadWorkspace: (
      request: DevicePackageUploadRequest
    ): Promise<DevicePackageUploadResult> =>
      ipcRenderer.invoke('device-provisioning:upload', request),
    onChanged: (
      listener: (items: LocalDeviceProvisioning[]) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        items: LocalDeviceProvisioning[]
      ): void => listener(items)
      ipcRenderer.on('device-provisioning:changed', wrapped)
      return () => ipcRenderer.removeListener(
        'device-provisioning:changed',
        wrapped
      )
    }
  },
  observability: {
    getStatus: (): Promise<ObservabilityStatus> =>
      ipcRenderer.invoke('observability:getStatus'),
    listTraces: (query?: TraceListQuery): Promise<TraceListResult> =>
      ipcRenderer.invoke('observability:listTraces', query),
    getTrace: (
      traceId: string,
      query?: TraceDetailQuery
    ): Promise<TraceDetailResult> =>
      ipcRenderer.invoke('observability:getTrace', traceId, query)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as unknown as { api: Api }).api = api
}

export type Api = typeof api
