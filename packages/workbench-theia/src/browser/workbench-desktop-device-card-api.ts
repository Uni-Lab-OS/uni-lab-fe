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

export interface WorkbenchSavedFile {
  path: string
}

export interface WorkbenchDesktopFileApi {
  saveBinary(input: {
    content: Uint8Array
    defaultName?: string
  }): Promise<WorkbenchSavedFile | null>
}

export interface WorkbenchDesktopDeviceCardApi {
  list(): Promise<InstalledDeviceCard[]>
  importCard(): Promise<InstalledDeviceCard | null>
  agent: {
    getInfo(): Promise<DeviceCardAgentEnvironmentInfo>
    installCli(): Promise<DeviceCardAgentEnvironmentInfo>
    removeCli(): Promise<DeviceCardAgentEnvironmentInfo>
    setBridgeEnabled(enabled: boolean): Promise<DeviceCardAgentEnvironmentInfo>
  }
  authoring: {
    prepare(input: {
      deviceId: string
      profile: DeviceCardAuthoringProfile
    }): Promise<DeviceCardAuthoringSessionStatus | null>
    get(): Promise<DeviceCardAuthoringSessionStatus | null>
    reveal(path: string): Promise<void>
    onTargetRequest(
      listener: (request: DeviceCardAuthoringTargetRequest) => void
    ): () => void
    resolveTargetRequest(response: DeviceCardAuthoringTargetResponse): void
  }
  workspace: {
    get(): Promise<DeviceCardWorkspaceStatus | null>
    open(
      context?: DeviceCardAuthoringContext
    ): Promise<DeviceCardWorkspaceStatus | null>
    close(): Promise<void>
    rebuild(): Promise<DeviceCardWorkspaceStatus>
    install(): Promise<InstalledDeviceCard>
    exportCard(): Promise<WorkbenchSavedFile | null>
    preview(request: OpenDeviceCardWorkspaceRequest): Promise<void>
    onStatus(
      listener: (status: DeviceCardWorkspaceStatus | null) => void
    ): () => void
  }
  open(request: OpenDeviceCardRequest): Promise<void>
  updateBounds(bounds: DeviceCardBounds): Promise<void>
  setOccluded(source: string, occluded: boolean): Promise<void>
  updateState(state: Record<string, unknown>): Promise<void>
  close(): Promise<void>
  resolveAction(run: DeviceCardActionRun): Promise<void>
  onActionRequest(
    listener: (request: DeviceCardHostActionRequest) => void
  ): () => void
}

export interface WorkbenchDesktopCardBridge {
  deviceCards?: WorkbenchDesktopDeviceCardApi
  file?: WorkbenchDesktopFileApi
}

/**
 * 从 Electron preload 边界读取设备卡能力，不把桌面全局对象扩散到业务组件。
 *
 * @returns 桌面设备卡和文件能力；普通浏览器中返回空对象。
 */
export function getWorkbenchDesktopCardBridge(): WorkbenchDesktopCardBridge {
  const scope = globalThis as typeof globalThis & {
    api?: WorkbenchDesktopCardBridge
  }
  return {
    deviceCards: scope.api?.deviceCards,
    file: scope.api?.file
  }
}
