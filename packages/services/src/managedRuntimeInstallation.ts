/** Desktop-managed Python runtime installation lifecycle shared by every shell. */
export type ManagedRuntimeInstallationPhase =
  | 'unavailable'
  | 'external'
  | 'not-installed'
  | 'installing'
  | 'ready'
  | 'failed'

export interface ManagedRuntimeInstallationSnapshot {
  phase: ManagedRuntimeInstallationPhase
  bundled: boolean
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
}

export interface ManagedRuntimeInstallationApi {
  getSnapshot: () => Promise<ManagedRuntimeInstallationSnapshot>
  install: () => Promise<ManagedRuntimeInstallationSnapshot>
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
  managed: false,
  runtimeVersion: null,
  platform: null,
  environmentPath: null,
  availableEnvironments: [],
  error: null
})
