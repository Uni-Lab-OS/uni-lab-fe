import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringTarget,
  DeviceCardAuthoringTargetSummary
} from '@unilab/device-card-sdk'
import {
  DEVICE_CARD_HOST_STATE_SCHEMA,
  filterDeviceCardRealtimeStateSchema,
  isDeviceDefinitionReference
} from '@unilab/device-card-sdk'

/**
 * 从领域设备包定义和当前实例能力生成 v2 开发上下文。
 *
 * @param target 带完整 PackageCatalog 来源的设备开发目标。
 * @param runtimeState 当前实例遥测样例。
 * @returns 可持久化到卡片项目的开发上下文。
 */
export function createDeviceCardAuthoringContext(
  target: DeviceCardAuthoringTarget,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  assertTarget(target)
  const stateSchema = buildFormalStateSchema(target.stateSchema)
  const sampleState = buildDeviceCardAuthoringSampleState(target, runtimeState)
  return {
    schemaVersion: 'device-card-authoring-context/v2',
    definition: structuredClone(target.definition),
    deviceTypeId: target.definition.fqid,
    deviceId: target.deviceId,
    title: target.title,
    actions: target.actions.map((action) => structuredClone(action)),
    stateSchema,
    sampleState,
    media: [...(target.media ?? [])]
  }
}
/**
 * 汇总设备开发目标的身份和正式合同可用性。
 *
 * @param target 待展示的设备开发目标。
 * @returns 不暴露运行时实现的 Agent 目标摘要。
 */
export function summarizeDeviceCardAuthoringTarget(
  target: DeviceCardAuthoringTarget
): DeviceCardAuthoringTargetSummary {
  const blocked = target.deviceId.trim().length === 0 ||
    target.definition.fqid.trim().length === 0
  const suppliedSchema = target.stateSchema
  const suppliedKeys = Object.keys(suppliedSchema ?? {})
  const formalKeys = Object.keys(
    filterDeviceCardRealtimeStateSchema(suppliedSchema ?? {})
  )
  const contractProvided = suppliedSchema !== undefined &&
    (suppliedKeys.length === 0 || formalKeys.length === suppliedKeys.length)
  return {
    deviceId: target.deviceId,
    definitionFqid: target.definition.fqid,
    deviceTypeId: target.definition.fqid,
    title: target.title,
    online: target.online,
    actionCount: target.actions.length,
    contextAvailability: blocked
      ? 'blocked'
      : contractProvided
        ? 'ready'
        : 'partial'
  }
}

export function buildDeviceCardAuthoringSampleState(
  target: Pick<DeviceCardAuthoringTarget, 'actions' | 'online' | 'sampleState' | 'stateSchema'>,
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
  const candidates = {
    ...(target.sampleState ?? {}),
    ...runtimeState,
    online,
    actionBusy
  }
  return buildSampleStateForSchema(
    buildFormalStateSchema(target.stateSchema),
    candidates
  )
}

export function inferDeviceCardStateSeeds(
  _actions: DeviceCardAuthoringTarget['actions']
): Record<string, unknown> {
  // Kept for source compatibility. Action inputs and outputs are command
  // contracts, never subscribable device state.
  return {}
}

function buildFormalStateSchema(
  suppliedSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...filterDeviceCardRealtimeStateSchema(
      structuredClone(suppliedSchema ?? {})
    ),
    ...structuredClone(DEVICE_CARD_HOST_STATE_SCHEMA)
  }
}

function buildSampleStateForSchema(
  stateSchema: Record<string, unknown>,
  candidates: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stateSchema).map(([key, schema]) => [
      key,
      Object.prototype.hasOwnProperty.call(candidates, key)
        ? candidates[key]
        : defaultForSchema(schema)
    ])
  )
}

/**
 * 关闭式校验卡片开发目标的身份与动作合同。
 *
 * @param target 待校验的设备开发目标。
 * @returns 无；不完整或重复声明时抛出错误。
 */
function assertTarget(target: DeviceCardAuthoringTarget): void {
  if (target.deviceId.trim().length === 0) {
    throw new Error('目标设备缺少稳定 Device ID。')
  }
  if (!isDeviceDefinitionReference(target.definition)) {
    throw new Error('目标设备缺少完整的 PackageCatalog definition 来源证据。')
  }
  if (target.title.trim().length === 0) {
    throw new Error('目标设备缺少显示名称。')
  }
  const names = new Set<string>()
  for (const action of target.actions) {
    if (!action.action.trim() || names.has(action.action)) {
      throw new Error('目标设备包含无效或重复的 Action。')
    }
    if (
      action.riskLevel !== 'normal' &&
      action.riskLevel !== 'dangerous' &&
      action.riskLevel !== 'emergency'
    ) {
      throw new Error('目标设备包含无效的 Action 风险等级。')
    }
    names.add(action.action)
  }
}

function defaultForSchema(schema: unknown): unknown {
  if (!isRecord(schema)) return null
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return structuredClone(schema.default)
  }
  const type = schema.type
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return {}
  if (type === 'string') return ''
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
