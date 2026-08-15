import type { ManagedDevice } from './deviceCatalog'
import type { DeviceManagementConnection } from './types'

const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000, 10_000] as const

/**
 * Return the next bounded refresh delay for a startup catalog that has not
 * observed any dispatchable device yet.
 *
 * A successful all-offline (or empty) snapshot is common while the OS is
 * ready but its Edge is still registering. Once any device is online the
 * panel returns to explicit/manual refresh and does not poll the full action
 * catalog indefinitely.
 */
export function deviceCatalogRecoveryDelay({
  attempt,
  backendEnabled,
  connection,
  lastUpdated,
  devices
}: {
  attempt: number
  backendEnabled: boolean
  connection: DeviceManagementConnection
  lastUpdated: number | null
  devices: readonly Pick<ManagedDevice, 'online'>[]
}): number | null {
  if (
    !backendEnabled ||
    connection !== 'connected' ||
    lastUpdated === null ||
    devices.some(device => device.online)
  ) return null
  return RECOVERY_DELAYS_MS[attempt] ?? null
}
