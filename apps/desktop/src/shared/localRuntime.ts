export type LocalRuntimePathKind =
  | 'graph'
  | 'os'
  | 'szlab'
  | 'environment'
  | 'simulator'

export interface LocalRuntimeLaunchConfig {
  graphPath: string
  osProjectPath: string
  szlabProjectPath: string
  environmentPath: string
  simulatorProjectPath: string
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
