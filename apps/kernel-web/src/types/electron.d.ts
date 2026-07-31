import type { AuthSession } from './auth'
import type {
  DeviceCardActionRun,
  DeviceCardAuthoringContext,
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
