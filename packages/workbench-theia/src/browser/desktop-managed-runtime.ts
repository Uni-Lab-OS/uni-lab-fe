import {
  UNAVAILABLE_MANAGED_RUNTIME_INSTALLATION,
  type ManagedRuntimeInstallationApi,
  type ManagedRuntimeInstallationSnapshot
} from '@unilab/services'

export type DesktopManagedRuntimeApi = ManagedRuntimeInstallationApi
export type { ManagedRuntimeInstallationSnapshot }

export const UNAVAILABLE_MANAGED_RUNTIME =
  UNAVAILABLE_MANAGED_RUNTIME_INSTALLATION

export function desktopManagedRuntimeApi(): DesktopManagedRuntimeApi | null {
  return (globalThis as typeof globalThis & {
    api?: { managedRuntime?: DesktopManagedRuntimeApi }
  }).api?.managedRuntime ?? null
}
