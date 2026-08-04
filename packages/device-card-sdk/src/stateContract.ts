export const DEVICE_CARD_HOST_STATE_SCHEMA = {
  online: {
    type: 'boolean',
    source: 'host',
    status: 'resolved'
  },
  actionBusy: {
    type: 'object',
    source: 'host',
    status: 'resolved'
  }
} as const

const REALTIME_SOURCES = new Set([
  'driver',
  'host',
  'legacy-registry'
])
const PREVIEW_ONLY_SOURCES = new Set(['action-inferred', 'runtime-sample'])

/**
 * State permissions represent values that the Host Bridge can subscribe to.
 * Formal state must carry provenance assigned by the trusted Host context.
 * Project-only V1 compatibility is handled by the Builder preview policy and
 * must never broaden live permissions.
 */
export function isDeviceCardRealtimeStateDefinition(
  value: unknown
): boolean {
  if (!isRecord(value)) return false
  const source = typeof value.source === 'string' ? value.source : undefined
  const status = typeof value.status === 'string' ? value.status : undefined

  if (!source || !status) return false
  if (source && PREVIEW_ONLY_SOURCES.has(source)) return false
  if (status === 'unresolved') return false
  if (source && !REALTIME_SOURCES.has(source)) return false
  if (status && status !== 'resolved') return false
  return true
}

export function filterDeviceCardRealtimeStateSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema).filter(([, definition]) =>
      isDeviceCardRealtimeStateDefinition(definition)
    )
  )
}

export function deviceCardRealtimeStateKeys(
  schema: Record<string, unknown>
): string[] {
  return Object.keys(filterDeviceCardRealtimeStateSchema(schema)).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
