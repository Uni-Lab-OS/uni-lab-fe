import { deviceCardRealtimeStateKeys } from '@unilab/device-card-sdk'

/**
 * Presentation order is intentionally different from permission order.
 * Device properties are more useful than Host metadata; when a device has no
 * property contract, online is the safest scalar Host status to show first.
 */
export function deviceCardPresentationStateKeys(
  schema: Record<string, unknown>
): string[] {
  const realtimeKeys = deviceCardRealtimeStateKeys(schema)
  const deviceKeys = realtimeKeys.filter(
    (key) => stateSource(schema[key]) !== 'host'
  )
  const deviceScalarKeys = deviceKeys.filter((key) =>
    isDeviceCardScalarStateDefinition(schema[key])
  )
  const deviceContainerKeys = deviceKeys.filter((key) =>
    !isDeviceCardScalarStateDefinition(schema[key])
  )
  const orderedDeviceKeys = [...deviceScalarKeys, ...deviceContainerKeys]
  const online = realtimeKeys.includes('online') &&
    !orderedDeviceKeys.includes('online')
    ? ['online']
    : []
  const selected = new Set([...orderedDeviceKeys, ...online])
  return [
    ...orderedDeviceKeys,
    ...online,
    ...realtimeKeys.filter((key) => !selected.has(key))
  ]
}

export function isDeviceCardScalarStateDefinition(value: unknown): boolean {
  if (!isRecord(value)) return true
  return value.type !== 'object' && value.type !== 'array'
}

function stateSource(value: unknown): string | undefined {
  return isRecord(value) && typeof value.source === 'string'
    ? value.source
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
