export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type DeviceCardAuthoringProfile =
  | 'web-component-lite-v1'
  | 'vue-web-component-v1'
  | 'react-web-component-v1'

export interface DeviceCardPermissions {
  state: string[]
  actions: string[]
  media: string[]
}

export interface DeviceCardManifest {
  schemaVersion: 1
  id: string
  version: string
  title: string
  deviceTypes: string[]
  sdkVersion: string
  hostProtocolVersion: 1
  authoringProfile: DeviceCardAuthoringProfile
  entry: string
  uiFeatures: string[]
  permissions: DeviceCardPermissions
  config?: {
    version: number
    defaults: JsonObject
    schema: JsonObject
  }
}

export interface DeviceCardDescriptor {
  deviceId: string | null
  deviceTypeId: string
  title: string
}

export interface DeviceCardActionContract {
  action: string
  label: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  busy?: boolean
}

export interface DeviceCardAuthoringContext {
  schemaVersion: 'device-card-authoring-context/v1'
  deviceTypeId: string
  deviceId?: string
  title: string
  actions: DeviceCardActionContract[]
  stateSchema: Record<string, unknown>
  sampleState: Record<string, unknown>
  media: string[]
}

export interface DeviceCardRuntimeSnapshot {
  mode: 'mock' | 'live'
  device: DeviceCardDescriptor
  state: Record<string, unknown>
  config: JsonObject
  theme: 'light' | 'dark'
  locale: string
}

export type DeviceCardActionStatus =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'RUNNING'
  | 'DONE'
  | 'ERROR'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'REJECTED'

export interface DeviceCardActionRun {
  requestId: string
  action: string
  status: DeviceCardActionStatus
  result?: JsonValue
  error?: string
}

export interface DeviceCardBridge {
  getContext: () => Promise<DeviceCardRuntimeSnapshot>
  subscribeState: (
    keys: readonly string[],
    listener: (state: Record<string, unknown>) => void
  ) => () => void
  callAction: (
    action: string,
    params?: Record<string, unknown>
  ) => Promise<DeviceCardActionRun>
  saveConfig: (patch: JsonObject) => Promise<JsonObject>
  log: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface DeviceCardDefinition {
  element: CustomElementConstructor
}

export interface InstalledDeviceCard {
  key: string
  id: string
  version: string
  title: string
  deviceTypes: string[]
  authoringProfile: DeviceCardAuthoringProfile
  installedAt: string
}

export interface DeviceCardBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OpenDeviceCardRequest {
  key: string
  bounds: DeviceCardBounds
  context: DeviceCardRuntimeSnapshot
  availableActions?: string[]
}

export interface DeviceCardHostActionRequest {
  requestId: string
  deviceId: string
  action: string
  params: Record<string, unknown>
}

export interface DeviceCardDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

declare global {
  interface Window {
    unilabCard?: DeviceCardBridge
  }
}
