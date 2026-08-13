export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type DeviceCardAuthoringProfile =
  | 'web-component-lite-v1'
  | 'vue-web-component-v1'
  | 'react-web-component-v1'

/** Manifest uiFeatures 中用于声明本地关节模型预览能力的稳定键。 */
export const DEVICE_CARD_JOINT_PREVIEW_FEATURE = 'joint-preview'

export interface DeviceCardPermissions {
  state: string[]
  actions: string[]
  media: string[]
}

export interface DevicePackageDistributionReference {
  name: string
  normalizedName: string
  version: string
}

export interface DevicePackageCatalogReference {
  schemaVersion: '1'
  distribution: DevicePackageDistributionReference
  importPackage: string
  namespace: string
  contentDigest: string
  catalogDigest: string
}

export interface DeviceDefinitionReference {
  fqid: string
  version: string
  contentHash: string
  sourceIdentity: string
  title: string
  description: string
  category: string[]
  manufacturer: string
  packageCatalog: DevicePackageCatalogReference
}

export interface DeviceCardAuthoredAgainst {
  definitionVersion: string
  definitionContentHash: string
  packageCatalogDigest: string
}

export interface DeviceCardDefinitionTarget {
  definitionFqid: string
  authoredAgainst: DeviceCardAuthoredAgainst
}

export interface LegacyDeviceCardManifest {
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

export interface DeviceCardManifestV2 {
  schemaVersion: 2
  id: string
  version: string
  title: string
  targets: DeviceCardDefinitionTarget[]
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

export type DeviceCardManifest = LegacyDeviceCardManifest | DeviceCardManifestV2

export interface DeviceCardDescriptor {
  deviceId: string | null
  /** 当前设备对应的 Material 实例；Mock 关节预览只能写入该实例。 */
  materialId: string | null
  definitionFqid: string
  definition?: DeviceDefinitionReference
  /** @deprecated 使用 definitionFqid；该别名仅供 v1 卡片源码读取。 */
  deviceTypeId: string
  title: string
}

/**
 * 卡片与 Host 之间的本地关节预览帧。数值统一采用 URDF/ROS SI 单位：
 * revolute/continuous 为 rad，prismatic 为 m。
 */
export interface DeviceCardJointPreviewFrame {
  materialId: string
  jointStates: Readonly<Record<string, number>>
  updatedAt: number
  modelRevision?: string
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

export interface LegacyDeviceCardAuthoringContext {
  schemaVersion: 'device-card-authoring-context/v1'
  deviceTypeId: string
  deviceId?: string
  title: string
  actions: DeviceCardActionContract[]
  stateSchema: Record<string, unknown>
  sampleState: Record<string, unknown>
  media: string[]
}

export interface DeviceCardAuthoringContextV2 {
  schemaVersion: 'device-card-authoring-context/v2'
  definition: DeviceDefinitionReference
  /** @deprecated 使用 definition.fqid；该别名只帮助旧工具显示目标。 */
  deviceTypeId: string
  deviceId: string
  title: string
  actions: DeviceCardActionContract[]
  stateSchema: Record<string, unknown>
  sampleState: Record<string, unknown>
  media: string[]
}

export type DeviceCardAuthoringContext =
  | LegacyDeviceCardAuthoringContext
  | DeviceCardAuthoringContextV2

export interface DeviceCardRuntimeSnapshot {
  mode: 'mock' | 'live'
  device: DeviceCardDescriptor
  state: Record<string, unknown>
  config: JsonObject
  /** 仅用于 Mock 视图恢复，不是设备实时反馈。 */
  jointPreview?: DeviceCardJointPreviewFrame
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
  /** 更新当前 Material 的本地 Mock 姿态；Live 会话必须拒绝。 */
  setJointPreview?: (
    jointStates: Readonly<Record<string, number>>
  ) => Promise<DeviceCardJointPreviewFrame>
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
  definitionTargets: DeviceCardDefinitionTarget[]
  definitionFqids: string[]
  /** v1 Artifact 的显式遗留匹配输入；新卡片必须为空。 */
  legacyDeviceTypes: string[]
  /** @deprecated 使用 definitionFqids。 */
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
  availableActions?: DeviceCardActionContract[]
  availableState?: string[]
  availableMedia?: string[]
}

export type DeviceCardWorkspaceState = 'building' | 'ready' | 'error'

export interface DeviceCardWorkspaceCard {
  id: string
  version: string
  title: string
  definitionTargets: DeviceCardDefinitionTarget[]
  definitionFqids: string[]
  legacyDeviceTypes: string[]
  /** @deprecated 使用 definitionFqids。 */
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
