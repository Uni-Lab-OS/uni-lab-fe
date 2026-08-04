import type { DeviceCatalogItem, DeviceStatus } from '@unilab/services'

export function buildDeviceCardRuntimeState(
  device: DeviceCatalogItem,
  statusMap: ReadonlyMap<string, DeviceStatus>
): Record<string, unknown> {
  const live = statusMap.get(device.deviceId)?.status ?? {}

  return {
    ...decodeDriverContainerState(live, device.stateSchema),
    online: device.online,
    actionBusy: Object.fromEntries(
      device.actions.map((action) => [action.actionName, action.isBusy])
    )
  }
}

function decodeDriverContainerState(
  state: Record<string, unknown>,
  stateSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!stateSchema) return state
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [
      key,
      decodeDriverContainerValue(value, stateSchema[key])
    ])
  )
}

function decodeDriverContainerValue(value: unknown, definition: unknown): unknown {
  if (typeof value !== 'string' || !isRecord(definition)) return value
  if (definition.type !== 'object' && definition.type !== 'array') return value
  try {
    const parsed: unknown = JSON.parse(value)
    if (definition.type === 'array' && Array.isArray(parsed)) return parsed
    if (definition.type === 'object' && isRecord(parsed)) return parsed
  } catch {
    return value
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
