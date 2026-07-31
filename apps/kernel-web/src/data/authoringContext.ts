import type {
  DeviceCardAuthoringContext
} from '@unilab/device-card-sdk'
import type { DeviceCatalogItem } from '@unilab/services'

/**
 * Build Authoring Context for kit export / workspace open.
 * stateSchema must include fields cards may declare even when Edge has not
 * pushed them yet — infer seeds from action input schemas + runtime sample.
 */
export function createAuthoringContext(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  const sampleState = buildAuthoringSampleState(device, runtimeState)
  return {
    schemaVersion: 'device-card-authoring-context/v1',
    deviceTypeId: device.deviceTypeId,
    deviceId: device.deviceId,
    title: device.label,
    actions: device.actions.map((action) => ({
      action: action.actionName,
      label: action.label,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      busy: action.isBusy
    })),
    stateSchema: Object.fromEntries(
      Object.entries(sampleState).map(([key, value]) => [
        key,
        {
          type: jsonType(value),
          status: 'unresolved',
          source: Object.prototype.hasOwnProperty.call(runtimeState, key)
            ? 'runtime-sample'
            : 'action-inferred'
        }
      ])
    ),
    sampleState,
    media: []
  }
}

export function buildAuthoringSampleState(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): Record<string, unknown> {
  const actionBusyDefault = Object.fromEntries(
    device.actions.map((action) => [action.actionName, false])
  )
  const actionBusy =
    runtimeState.actionBusy && typeof runtimeState.actionBusy === 'object'
      ? runtimeState.actionBusy
      : actionBusyDefault
  const online =
    runtimeState.online === true || runtimeState.online === false
      ? runtimeState.online
      : device.online
  return {
    status: 'idle',
    ...inferStateSeedsFromActions(device.actions),
    ...runtimeState,
    online,
    actionBusy
  }
}

export function inferStateSeedsFromActions(
  actions: DeviceCatalogItem['actions']
): Record<string, unknown> {
  const seeds: Record<string, unknown> = {}
  for (const action of actions) {
    const input = action.inputSchema
    if (!input || typeof input !== 'object') continue
    if ('aspirate_position' in input) seeds.aspirate_position = 0
    if ('dispense_position' in input) seeds.dispense_position = 0
    // set_position uses `position` in the action contract; Edge topic is
    // current_position — declare the telemetry name cards actually subscribe.
    if ('position' in input) seeds.current_position = 0

    const output = action.outputSchema
    if (!output || typeof output !== 'object') continue
    for (const [key, schema] of Object.entries(output)) {
      if (key in seeds) continue
      seeds[key] = defaultForSchema(schema)
    }
  }
  return seeds
}

function defaultForSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null
  const type = (schema as { type?: unknown }).type
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return {}
  if (type === 'string') return ''
  return null
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value === 'object' ? 'object' : typeof value
}
