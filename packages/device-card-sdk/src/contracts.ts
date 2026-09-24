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
  /** 引用 template 卡片源码；领域仓只需 manifest + 可选 overlay（如 branding）。 */
  templateCard?: string
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

export type DeviceCardActionRiskLevel =
  | 'normal'
  | 'dangerous'
  | 'emergency'

export interface DeviceCardActionContract {
  action: string
  label: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  riskLevel: DeviceCardActionRiskLevel
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

/** 卡片运行时 config 扩展字段；由 Host 从收窄后 manifest 注入，领域仓无需填写。 */
export type DeviceCardRuntimeConfig = JsonObject & {
  allowedActions?: string[]
  allowedState?: string[]
}

export interface DeviceCardRuntimeSnapshot {
  mode: 'mock' | 'live'
  device: DeviceCardDescriptor
  state: Record<string, unknown>
  /** 含 manifest defaults 与 Host 注入的 allowedActions / allowedState。 */
  config: DeviceCardRuntimeConfig
  theme: 'light' | 'dark'
  locale: string
}

export type DeviceCardManualExclusiveState = 'idle' | 'busy' | 'exclusive'

export interface DeviceCardManualExclusiveSnapshot {
  localDeviceId: string
  state: DeviceCardManualExclusiveState
  exclusive: boolean
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
  /** Listener receives the complete current snapshot for the requested keys. */
  subscribeState: (
    keys: readonly string[],
    listener: (state: Record<string, unknown>) => void
  ) => () => void
  callAction: (
    action: string,
    params?: Record<string, unknown>
  ) => Promise<DeviceCardActionRun>
  saveConfig: (patch: JsonObject) => Promise<JsonObject>
  readManualExclusive: () => Promise<DeviceCardManualExclusiveSnapshot>
  acquireManualExclusive: () => Promise<DeviceCardManualExclusiveSnapshot>
  releaseManualExclusive: () => Promise<DeviceCardManualExclusiveSnapshot>
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

/** 领域包卡片 ``authoring-context.json`` 与 ``mock.json`` 合成的离线预览快照。 */
export interface DevicePackageCardAuthoringPreview {
  deviceTypeId: string
  deviceId?: string
  title: string
  actions: DeviceCardActionContract[]
  stateSchema: Record<string, unknown>
  sampleState: Record<string, unknown>
}

/** 当前领域包按约定目录发布、可由桌面 Workbench 构建的设备卡片源码。 */
export interface DevicePackageCardProject {
  projectDir: string
  id: string
  version: string
  title: string
  deviceTypes: string[]
  /** 来自 ``authoring-context.json``，供 Backend 不可用时离线匹配设备。 */
  deviceId?: string
  /** 供 Workbench 在无运行实例时渲染 mock 预览界面。 */
  authoringPreview?: DevicePackageCardAuthoringPreview
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
  availableActions?: DeviceCardActionContract[]
  availableState?: string[]
  availableMedia?: string[]
  availableUiFeatures?: string[]
}

export type DeviceCardWorkspaceState = 'building' | 'ready' | 'error'

export interface DeviceCardWorkspaceCard {
  id: string
  version: string
  title: string
  deviceTypes: string[]
  authoringProfile: DeviceCardAuthoringProfile
  sourceHash: string
}

export interface DeviceCardWorkspaceStatus {
  schemaVersion: 'device-card-workspace-status/v1'
  projectDir: string
  projectName: string
  state: DeviceCardWorkspaceState
  revision: number
  updatedAt: string
  diagnosticsPath: string
  diagnostics: DeviceCardDiagnostic[]
  card?: DeviceCardWorkspaceCard
}

export interface OpenDeviceCardWorkspaceRequest {
  bounds: DeviceCardBounds
  context: DeviceCardRuntimeSnapshot
  availableActions?: DeviceCardActionContract[]
  availableState?: string[]
  availableMedia?: string[]
  availableUiFeatures?: string[]
}

export interface DeviceCardHostActionRequest {
  requestId: string
  deviceId: string
  action: string
  params: Record<string, unknown>
}

export type DeviceCardManualExclusiveOperation =
  | 'read'
  | 'acquire'
  | 'release'

export interface DeviceCardHostManualExclusiveRequest {
  requestId: string
  deviceId: string
  operation: DeviceCardManualExclusiveOperation
}

export interface DeviceCardHostManualExclusiveResult {
  requestId: string
  ok: boolean
  snapshot?: DeviceCardManualExclusiveSnapshot
  error?: string
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
