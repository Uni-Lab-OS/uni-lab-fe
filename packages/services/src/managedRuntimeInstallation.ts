/** Desktop-managed Python runtime installation lifecycle shared by every shell. */
export type ManagedRuntimeInstallationPhase =
  | 'unavailable'
  | 'external'
  | 'not-installed'
  | 'upgrade-required'
  | 'installing'
  | 'ready'
  | 'failed'

export type ManagedRuntimeInstallationErrorCode =
  | 'upgrade-required'
  | 'payload-invalid'
  | 'installation-failed'
  | 'health-check-failed'
  | 'unknown'

export type ManagedRuntimeInstallationProgressStage =
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'validating'

export interface ManagedRuntimeInstallationProgress {
  stage: ManagedRuntimeInstallationProgressStage
  downloadedBytes: number | null
  totalBytes: number | null
  percentage: number | null
}

export interface ManagedRuntimeInstallationSnapshot {
  phase: ManagedRuntimeInstallationPhase
  bundled: boolean
  delivery?: 'bundled' | 'download' | null
  managed: boolean
  runtimeVersion: string | null
  platform: string | null
  environmentPath: string | null
  availableEnvironments: Array<{
    kind: 'managed' | 'external'
    label: string
    path: string
  }>
  error: string | null
  previousRuntimeVersion?: string | null
  previousEnvironmentPath?: string | null
  errorCode?: ManagedRuntimeInstallationErrorCode | null
  errorLogPath?: string | null
  progress?: ManagedRuntimeInstallationProgress | null
}

export interface ManagedRuntimeInstallationApi {
  getSnapshot: () => Promise<ManagedRuntimeInstallationSnapshot>
  install: () => Promise<ManagedRuntimeInstallationSnapshot>
  openDiagnosticLog: () => Promise<boolean>
  selectEnvironment: (
    path: string
  ) => Promise<ManagedRuntimeInstallationSnapshot>
  chooseEnvironment: () => Promise<ManagedRuntimeInstallationSnapshot>
  onSnapshot: (
    listener: (snapshot: ManagedRuntimeInstallationSnapshot) => void
  ) => () => void
}

export const UNAVAILABLE_MANAGED_RUNTIME_INSTALLATION:
ManagedRuntimeInstallationSnapshot = Object.freeze({
  phase: 'unavailable',
  bundled: false,
  delivery: null,
  managed: false,
  runtimeVersion: null,
  platform: null,
  environmentPath: null,
  availableEnvironments: [],
  error: null,
  previousRuntimeVersion: null,
  previousEnvironmentPath: null,
  errorCode: null,
  errorLogPath: null,
  progress: null
})
