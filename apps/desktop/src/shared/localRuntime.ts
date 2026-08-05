export type LocalRuntimePathKind =
  | 'graph'
  | 'os'
  | 'szlab'
  | 'environment'
  | 'simulator'
  | 'edgeExecutable'

export type LocalRuntimeEdgeCommandMode = 'generated' | 'custom'

export interface LocalRuntimeCustomEdgeCommand {
  executable: string
  args: string[]
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

export const IDLE_LOCAL_RUNTIME_SNAPSHOT: LocalRuntimeSnapshot = {
  phase: 'idle',
  message: 'PLC-Sim 与领域侧 Edge 均未启动',
  simulatorRunning: false,
  bridgeRunning: false,
  edgeRunning: false
}
