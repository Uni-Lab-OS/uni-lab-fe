import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringTarget,
  DeviceCardAuthoringTargetSummary
} from '@unilab/device-card-sdk'

export function createDeviceCardAuthoringContext(
  target: DeviceCardAuthoringTarget,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  assertTarget(target)
  const sampleState = buildDeviceCardAuthoringSampleState(target, runtimeState)
  const suppliedSchema = target.stateSchema ?? {}
  const stateSchema = Object.keys(suppliedSchema).length > 0
    ? structuredClone(suppliedSchema)
    : Object.fromEntries(
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
      )
  return {
    schemaVersion: 'device-card-authoring-context/v1',
    deviceTypeId: target.deviceTypeId,
    deviceId: target.deviceId,
    title: target.title,
    actions: target.actions.map((action) => structuredClone(action)),
    stateSchema,
    sampleState,
    media: [...(target.media ?? [])]
  }
}
export function summarizeDeviceCardAuthoringTarget(
  target: DeviceCardAuthoringTarget
): DeviceCardAuthoringTargetSummary {
  const blocked = target.deviceId.trim().length === 0 ||
    target.deviceTypeId.trim().length === 0
  return {
    deviceId: target.deviceId,
    deviceTypeId: target.deviceTypeId,
    title: target.title,
    online: target.online,
    actionCount: target.actions.length,
    contextAvailability: blocked
      ? 'blocked'
      : target.stateSchema && Object.keys(target.stateSchema).length > 0
        ? 'ready'
        : 'partial'
  }
}

export function buildDeviceCardAuthoringSampleState(
  target: Pick<DeviceCardAuthoringTarget, 'actions' | 'online' | 'sampleState'>,
  runtimeState: Record<string, unknown> = {}
): Record<string, unknown> {
  const actionBusyDefault = Object.fromEntries(
    target.actions.map((action) => [action.action, Boolean(action.busy)])
  )
  const actionBusy = isRecord(runtimeState.actionBusy)
    ? runtimeState.actionBusy
    : actionBusyDefault
  const online = typeof runtimeState.online === 'boolean'
    ? runtimeState.online
    : target.online
  return {
    status: 'idle',
    ...inferDeviceCardStateSeeds(target.actions),
    ...(target.sampleState ?? {}),
    ...runtimeState,
    online,
    actionBusy
  }
}

export function inferDeviceCardStateSeeds(
  actions: DeviceCardAuthoringTarget['actions']
): Record<string, unknown> {
  const seeds: Record<string, unknown> = {}
  for (const action of actions) {
    const input = action.inputSchema
    if ('aspirate_position' in input) seeds.aspirate_position = 0
    if ('dispense_position' in input) seeds.dispense_position = 0
    if ('position' in input) seeds.current_position = 0
    for (const [key, schema] of Object.entries(action.outputSchema)) {
      if (!(key in seeds)) seeds[key] = defaultForSchema(schema)
    }
  }
  return seeds
}

function assertTarget(target: DeviceCardAuthoringTarget): void {
  if (target.deviceId.trim().length === 0) {
    throw new Error('目标设备缺少稳定 Device ID。')
  }
  if (target.deviceTypeId.trim().length === 0) {
    throw new Error('目标设备缺少稳定 Device Type。')
  }
  if (target.title.trim().length === 0) {
    throw new Error('目标设备缺少显示名称。')
  }
  const names = new Set<string>()
  for (const action of target.actions) {
    if (!action.action.trim() || names.has(action.action)) {
      throw new Error('目标设备包含无效或重复的 Action。')
    }
    names.add(action.action)
  }
}

function defaultForSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return null
  const type = schema.type
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
