import type {
  ManagedWorkbenchAgent,
  ManagedWorkbenchAgentOptions,
  WorkbenchAgentIdentity
} from './agent-sidecar'
import type {
  WorkbenchPlcVariableTableCandidate
} from './plc-variable-tables'
import { WorkspaceHostWorkbenchSession } from './workspace-host-session'

export {
  MANAGED_WORKSPACE_SKILL_NAMES,
  resolveManagedWorkspaceSkillSource,
  seedManagedWorkspaceSkills,
  type ManagedWorkspaceSkillName,
  type ManagedWorkspaceSkillResult
} from './workspace-skills'
export { parseWorkspacePackageMountProjection } from './readiness'
export {
  createWorkbenchDiagnosticBundle,
  createWorkbenchStateBackup,
  prepareWorkbenchState,
  restoreWorkbenchStateBackup,
  WORKBENCH_STATE_SCHEMA_VERSION,
  WorkbenchStateError,
  type WorkbenchStateBackup,
  type WorkbenchStateManifest,
  type WorkbenchStatePreparation,
  type WorkbenchStateQuotas
} from './workbench-state'

export type WorkbenchSessionPhase =
  | 'idle'
  | 'validating'
  | 'starting'
  | 'waiting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface WorkbenchSessionDiagnostic {
  code:
    | 'invalid_workspace'
    | 'invalid_os_project'
    | 'python_environment_not_found'
    | 'port_conflict'
    | 'os_start_failed'
    | 'os_readiness_failed'
    | 'plc_connection_failed'
    | 'os_exited'
  message: string
  recovery: string
}

export type WorkbenchRuntimeMode = 'normal' | 'dry-run'
export type WorkbenchDomainMode = 'local' | 'backend'

export interface WorkbenchReleaseReceipt {
  releaseId: string
  targetAddress: string
  verified: true
  activated: boolean
  counts: {
    templates: number
    materials: number
    workflows: number
  }
}

export interface WorkbenchReleaseTargetInspection {
  targetAddress: string
  empty: boolean
  counts: {
    templates: number
    materials: number
    workflows: number
  }
}

export interface WorkbenchSessionIdentity {
  workspacePath: string
  osProjectPath: string
  osRuntimeSource: 'checkout' | 'environment'
  environmentPath: string
  graphPath: string
  graphFingerprint: string
  backendUrl: string
  pid: number
  generation: string
  logPath: string
  mode: WorkbenchRuntimeMode
  packageMounts: WorkspacePackageMountProjection | null
  agent: WorkbenchAgentIdentity | null
}

export type WorkbenchEnvironmentLogKind =
  | 'workspace-backend'
  | 'os'
  | 'plc-sim'
  | 'agent'
export type WorkbenchPlcHandshakeProfile = 'szlab' | 'xuse'

export interface WorkbenchPlcSimulatorConfiguration {
  projectPath: string
  variableTablePath: string
  handshakeProfile: WorkbenchPlcHandshakeProfile
}

export type WorkbenchPlcSimulatorPhase =
  | 'idle'
  | 'validating'
  | 'starting'
  | 'waiting'
  | 'ready'
  | 'stopping'
  | 'failed'

export interface WorkbenchPlcSimulatorSnapshot {
  phase: WorkbenchPlcSimulatorPhase
  message: string
  projectPath: string
  variableTablePath: string
  variableTableCandidates: readonly WorkbenchPlcVariableTableCandidate[]
  handshakeProfile: WorkbenchPlcHandshakeProfile
  pid: number | null
  guiUrl: string
  opcUaUrl: string
  logPath: string
  diagnostic: string | null
}

export interface WorkbenchEdgeRuntimeSnapshot {
  phase: WorkbenchSessionPhase
  message: string
  pid: number | null
  generation: string | null
  graphPath: string
  mode: WorkbenchRuntimeMode
  logPath: string
  diagnostic: string | null
}

export interface WorkspacePackageMount {
  packageId: string
  distributionName: string
  version: string
  namespace: string
  editable: boolean
  readOnly: boolean
  sourceKind: 'workspace'
  importRootUri: string
  packageRootUri: string
  contentDigest: string
  catalogDigest: string
}

export interface WorkspacePackageMountProjection {
  schemaVersion: 'workspace-package-mounts/v1'
  editablePackageId: string
  dependencyRevision: string
  catalogRevision: string
  mountRevision: string
  items: readonly WorkspacePackageMount[]
}

export interface WorkbenchSessionSnapshot {
  phase: WorkbenchSessionPhase
  message: string
  configuredGraphPath: string
  configuredExternalDevicesOnly: boolean
  configuredRuntimeMode: WorkbenchRuntimeMode
  configuredDomainMode: WorkbenchDomainMode
  configuredBackendUrl: string | null
  configuredSchedulerUrl: string | null
  identity: WorkbenchSessionIdentity | null
  agent: WorkbenchAgentIdentity | null
  diagnostic: WorkbenchSessionDiagnostic | null
  edgeRuntime: WorkbenchEdgeRuntimeSnapshot
  plcSimulator: WorkbenchPlcSimulatorSnapshot
}

/** Configuration accepted by the single production Workspace Host adapter. */
export interface ManagedLocalWorkbenchSessionOptions {
  workspacePath: string
  osProjectPath?: string
  environmentPath?: string
  graphPath?: string
  externalDevicesOnly?: boolean
  backendPort?: number
  hostLinkPort?: number
  readinessTimeoutMs?: number
  environment?: NodeJS.ProcessEnv
  homeDirectory?: string
  platform?: NodeJS.Platform
  enableAgent?: boolean
  agentAppPath?: string
  agentBrandIconPath?: string
  agentStarter?: (
    options: ManagedWorkbenchAgentOptions
  ) => Promise<ManagedWorkbenchAgent>
  plcSimulatorProjectPath?: string
  plcVariableTablePath?: string
  plcHandshakeProfile?: WorkbenchPlcHandshakeProfile
  plcSimulatorGuiPort?: number
  plcSimulatorOpcUaPort?: number
  runtimeMode?: WorkbenchRuntimeMode
  domainMode?: WorkbenchDomainMode
  backendAuthorityUrl?: string
  schedulerAuthorityUrl?: string
}

/**
 * Public lifecycle Interface consumed by browser, Theia and Electron callers.
 *
 * Implementations must not own Backend, Edge or PLC child processes directly;
 * those lifecycles belong exclusively to the OS Workspace Host.
 */
export interface WorkbenchSession {
  getSnapshot(): WorkbenchSessionSnapshot
  onDidChange(listener: (snapshot: WorkbenchSessionSnapshot) => void): {
    dispose(): void
  }
  start(): Promise<WorkbenchSessionSnapshot>
  startWorkspaceBackend(): Promise<WorkbenchSessionSnapshot>
  stopWorkspaceBackend(): Promise<WorkbenchSessionSnapshot>
  stop(): Promise<WorkbenchSessionSnapshot>
  stopAll(): Promise<WorkbenchSessionSnapshot>
  restart(): Promise<WorkbenchSessionSnapshot>
  rebuildLocalData(): Promise<WorkbenchSessionSnapshot>
  startAgent(): Promise<WorkbenchSessionSnapshot>
  stopAgent(): Promise<WorkbenchSessionSnapshot>
  restartAgent(): Promise<WorkbenchSessionSnapshot>
  readLogTail(maxBytes?: number): Promise<string>
  readEnvironmentLog(
    kind: WorkbenchEnvironmentLogKind,
    maxBytes?: number
  ): Promise<string>
  configureGraph(graphPath: string): Promise<WorkbenchSessionSnapshot>
  setExternalDevicesOnly(enabled: boolean): Promise<WorkbenchSessionSnapshot>
  configurePlcSimulator(
    configuration: string | WorkbenchPlcSimulatorConfiguration
  ): Promise<WorkbenchSessionSnapshot>
  refreshPlcVariableTables(): Promise<WorkbenchSessionSnapshot>
  startPlcSimulator(): Promise<WorkbenchSessionSnapshot>
  stopPlcSimulator(): Promise<WorkbenchSessionSnapshot>
  releaseEnvironmentPorts(
    target: 'os' | 'plc-sim'
  ): Promise<WorkbenchSessionSnapshot>
  setRuntimeMode(mode: WorkbenchRuntimeMode): Promise<WorkbenchSessionSnapshot>
  setDomainAuthority(mode: WorkbenchDomainMode): Promise<WorkbenchSessionSnapshot>
  setSchedulerUrl(url: string | null): Promise<WorkbenchSessionSnapshot>
  publishRelease(options?: {
    activate?: boolean
    backendUrl?: string
    resetTarget?: boolean
  }): Promise<WorkbenchReleaseReceipt>
  inspectReleaseTarget(
    backendUrl: string
  ): Promise<WorkbenchReleaseTargetInspection>
}

/** Create the sole production adapter backed by the OS-owned Workspace Host. */
export function createWorkspaceHostWorkbenchSession(
  options: ManagedLocalWorkbenchSessionOptions
): WorkspaceHostWorkbenchSession {
  return new WorkspaceHostWorkbenchSession(options)
}
