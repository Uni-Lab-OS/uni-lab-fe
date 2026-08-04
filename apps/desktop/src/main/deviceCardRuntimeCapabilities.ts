import type { DeviceCardPermissions } from '@unilab/device-card-sdk'

export interface UnavailableDeviceCardCapabilities {
  actions: string[]
  state: string[]
  media: string[]
}

export function unavailableDeviceCardCapabilities(
  permissions: DeviceCardPermissions,
  available: {
    actions?: readonly string[]
    state?: readonly string[]
    media?: readonly string[]
  }
): UnavailableDeviceCardCapabilities {
  const actions = new Set(available.actions ?? [])
  const state = new Set(available.state ?? [])
  const media = new Set(available.media ?? [])
  return {
    actions: permissions.actions.filter((action) => !actions.has(action)),
    state: permissions.state.filter((key) => !state.has(key)),
    media: permissions.media.filter((key) => !media.has(key))
  }
}
