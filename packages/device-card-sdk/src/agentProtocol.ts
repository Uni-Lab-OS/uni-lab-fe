import type {
  DeviceCardActionContract,
  DeviceCardAuthoringProfile,
  DeviceDefinitionReference,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard
} from './contracts'

export const DEVICE_CARD_AGENT_PROTOCOL_VERSION = 1 as const
export const DEVICE_CARD_AGENT_RESULT_SCHEMA =
  'device-card-agent-result/v1' as const

export type DeviceCardAuthoringContextAvailability =
  | 'ready'
  | 'partial'
  | 'blocked'

export interface DeviceCardAuthoringTarget {
  deviceId: string
  definition: DeviceDefinitionReference
  title: string
  online: boolean
  actions: DeviceCardActionContract[]
  /** undefined means the OS did not provide a formal state contract; {} is an authoritative action-only device. */
  stateSchema?: Record<string, unknown>
  sampleState?: Record<string, unknown>
  media?: string[]
}

export interface DeviceCardAuthoringTargetSummary {
  deviceId: string
  definitionFqid: string
  /** @deprecated 使用 definitionFqid。 */
  deviceTypeId: string
  title: string
  online: boolean
  actionCount: number
  contextAvailability: DeviceCardAuthoringContextAvailability
}

export type DeviceCardAgentErrorCode =
  | 'INVALID_ARGUMENT'
  | 'ELECTRON_NOT_RUNNING'
  | 'PROTOCOL_MISMATCH'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_DENIED'
  | 'OS_UNAVAILABLE'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_ID_MISSING'
  | 'DEVICE_TYPE_UNRESOLVED'
  | 'DIRECTORY_NOT_EMPTY'
  | 'DIRECTORY_OUTSIDE_GRANT'
  | 'WORKSPACE_ACTIVE'
  | 'WORKSPACE_NOT_FOUND'
  | 'BUILD_FAILED'
  | 'CURRENT_SOURCE_NOT_READY'
  | 'APPROVAL_TIMEOUT'
  | 'INTERNAL_ERROR'

export interface DeviceCardAgentErrorPayload {
  code: DeviceCardAgentErrorCode
  message: string
  retryable: boolean
  details: Record<string, unknown>
}

export interface DeviceCardAuthoringSession {
  schemaVersion: 'device-card-authoring-session/v1'
  sessionId: string
  deviceId: string
  definitionFqid: string
  /** @deprecated 使用 definitionFqid。 */
  deviceTypeId: string
  profile: DeviceCardAuthoringProfile
  projectDir: string
  contextPath: string
  manifestPath: string
  diagnosticsPath: string
  state: DeviceCardWorkspaceStatus['state']
  revision: number
  previewMode: 'mock'
  createdAt: string
  versions: DeviceCardAuthoringVersions
}

export interface DeviceCardAuthoringSessionStatus {
  session: DeviceCardAuthoringSession
  workspace: DeviceCardWorkspaceStatus
}

export interface ExportedDeviceCardKit {
  path: string
  fileName: string
  authoringContextDigest: string
  bytes: number
  versions: DeviceCardAuthoringVersions
}

export interface ExportedDeviceCardSource {
  path: string
  bytes: number
  sourceHash: string
}

export interface DeviceCardInstallApproval {
  approvalId: string
  status: 'approved' | 'denied'
  installed?: InstalledDeviceCard
}

export interface DeviceCardAuthoringVersions {
  protocolVersion: 1
  kitVersion: 1
  sdkVersion: string
  toolingVersion: string
  hostProtocolVersion: 1
  uiCatalogVersion: string
  builderVersion?: string
}

export interface DeviceCardAgentBridgeDescriptor {
  schemaVersion: 'device-card-agent-bridge/v1'
  protocolVersion: 1
  endpoint: string
  capabilityToken: string
  electronPid: number
  createdAt: string
}

export interface DeviceCardAgentEnvironmentInfo {
  bridge: {
    enabled: boolean
    protocolVersion: 1
  }
  cli: {
    installed: boolean
    compatible: boolean
    installPath: string
    onPath: boolean
    command: string
  }
  recentRequests?: DeviceCardAgentRequestRecord[]
}

export interface DeviceCardAgentRequestRecord {
  requestId: string
  method: DeviceCardAgentMethod
  requestedAt: string
  status: 'success' | 'error'
}

export interface DeviceCardAgentHandshake {
  protocolVersion: 1
  clientVersion: string
  clientPid: number
  nonce: string
  capabilityToken: string
}

export interface DeviceCardAuthoringTargetRequest {
  requestId: string
}

export type DeviceCardAuthoringTargetResponse =
  | {
      requestId: string
      ok: true
      targets: DeviceCardAuthoringTarget[]
    }
  | {
      requestId: string
      ok: false
      message: string
    }

export type DeviceCardAgentMethod =
  | 'authoring.targets.list'
  | 'authoring.kit.export'
  | 'authoring.session.prepare'
  | 'authoring.session.attach'
  | 'authoring.session.get'
  | 'authoring.session.recheck'
  | 'authoring.session.export'
  | 'authoring.session.install.request'
  | 'authoring.session.close'

export interface DeviceCardAgentRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: 'agent.handshake' | DeviceCardAgentMethod
  params: Record<string, unknown>
}

export interface DeviceCardAgentRpcSuccess {
  jsonrpc: '2.0'
  id: string
  result: unknown
}

export interface DeviceCardAgentRpcFailure {
  jsonrpc: '2.0'
  id: string
  error: DeviceCardAgentErrorPayload
}

export type DeviceCardAgentRpcResponse =
  | DeviceCardAgentRpcSuccess
  | DeviceCardAgentRpcFailure

export type DeviceCardAgentResult<T> =
  | {
      schemaVersion: typeof DEVICE_CARD_AGENT_RESULT_SCHEMA
      ok: true
      result: T
    }
  | {
      schemaVersion: typeof DEVICE_CARD_AGENT_RESULT_SCHEMA
      ok: false
      error: DeviceCardAgentErrorPayload
    }
