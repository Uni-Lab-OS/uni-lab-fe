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

interface DesktopApi {
  getVersion: () => Promise<string>
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
    updateState: (state: Record<string, unknown>) => Promise<void>
    close: () => Promise<void>
    resolveAction: (run: DeviceCardActionRun) => Promise<void>
    onActionRequest: (
      listener: (request: DeviceCardHostActionRequest) => void
    ) => () => void
  }
}

declare global {
  interface Window {
    api?: DesktopApi
  }
}

export {}
