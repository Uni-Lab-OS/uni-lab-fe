import type { DeviceCardActionRiskLevel } from '@unilab/device-card-sdk'

import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'
import type {
  DeviceAction,
  DeviceActionInputSchema,
  DeviceActionSchema,
  DeviceCatalogItem,
  ResourceNode
} from './laboratory'

interface RuntimeActionTemplate {
  actionRef: string
  actionName: string
  deviceId: string
  label: string
  typeName: string
  isBusy: boolean
  currentJobId: string | null
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  riskLevel: DeviceCardActionRiskLevel
}

export interface RuntimeDeviceCatalogItem {
  id: string
  materialUuid: string
  deviceTypeId?: string
  deviceKey: string
  namespace: string
  name: string
  online: boolean
  stateSchema?: Record<string, unknown>
  actions: RuntimeActionTemplate[]
}

/** 把 Edge 设备目录 wire 对象映射为前端设备目录项。 */
export function mapRuntimeDeviceCatalogItem(
  raw: Record<string, unknown>
): DeviceCatalogItem {
  const deviceId = runtimeString(raw.id)
  return {
    deviceId,
    materialUuid: runtimeString(raw.materialUuid),
    // 新目录提供 Driver 类型；保留旧 Edge 的实例 id 回退。
    deviceTypeId: runtimeString(
      raw.deviceTypeId ?? raw.typeId ?? raw.className
    ) || deviceId,
    deviceKey: runtimeString(raw.deviceKey),
    namespace: runtimeString(raw.namespace),
    label: runtimeString(raw.name) || deviceId,
    online: Boolean(raw.online),
    stateSchema: Object.prototype.hasOwnProperty.call(raw, 'stateSchema')
      ? normalizeDeviceStateSchema(raw.stateSchema)
      : undefined,
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((value) => {
          const action = asRuntimeRecord(value)
          const actionRef = runtimeString(action.actionRef)
          const separator = actionRef.lastIndexOf('.')
          return {
            actionName: runtimeString(action.id) ||
              (separator >= 0 ? actionRef.slice(separator + 1) : actionRef),
            actionRef,
            label: runtimeString(action.name) || runtimeString(action.id),
            typeName: runtimeString(action.typeName),
            inputSchema: asRuntimeRecord(action.inputSchema),
            outputSchema: asRuntimeRecord(action.outputSchema),
            riskLevel: actionRiskLevel(action.riskLevel),
            isBusy: Boolean(action.busy)
          }
        })
      : []
  }
}

/** 把 Edge Action 模板映射为设备卡片可调试动作。 */
export function mapRuntimeDeviceAction(
  template: RuntimeActionTemplate
): DeviceAction {
  const schema = normalizeInputSchema(template.inputSchema)
  return {
    actionName: template.actionName,
    actionRef: template.actionRef,
    displayName: template.label,
    label: template.label,
    typeName: template.typeName,
    isBusy: template.isBusy,
    busyStatusKnown: true,
    currentJobId: template.currentJobId,
    schema,
    inputSchema: mapActionSchema(schema.properties),
    outputSchema: mapActionSchema(template.outputSchema),
    riskLevel: template.riskLevel
  }
}

/** 把 Edge Action 模板映射为表单 schema 与默认值。 */
export function mapRuntimeDeviceActionSchema(
  template: RuntimeActionTemplate
): DeviceActionSchema {
  const schema = normalizeInputSchema(template.inputSchema)
  return {
    schema,
    goalDefault: defaultsFromInputSchema(schema),
    actionType: template.typeName || template.actionRef,
    isBusy: template.isBusy,
    currentJobId: template.currentJobId
  }
}

/** 递归映射 Edge 资源投影，保留父子层级与空间坐标。 */
export function mapRuntimeResource(raw: Record<string, unknown>): ResourceNode {
  const pos = isRecord(raw.position) ? raw.position : {}
  return {
    id: runtimeString(raw.id),
    uuid: runtimeString(raw.uuid),
    name: runtimeString(raw.name),
    type: runtimeString(raw.type),
    className: runtimeString(raw.class),
    parent: raw.parent == null ? null : runtimeString(raw.parent),
    config: isRecord(raw.config) ? raw.config : {},
    data: isRecord(raw.data) ? raw.data : {},
    position: { x: runtimeNumber(pos.x), y: runtimeNumber(pos.y), z: runtimeNumber(pos.z) },
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => mapRuntimeResource(asRuntimeRecord(child)))
      : []
  }
}

/**
 * 从 Local Backend 的 authoring 诊断目录读取并收窄运行设备。
 *
 * @param http 服务使用的 HTTP Client。
 * @param signal 可选请求取消信号。
 * @returns 已过滤无身份/无引用动作的本地 Driver 诊断设备集合。
 */
export async function getRuntimeDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<RuntimeDeviceCatalogItem[]> {
  const raw = await requestData<Record<string, unknown>>(
    http,
    '/api/v1/authoring/device-catalog',
    { signal }
  )
  const items = Array.isArray(raw.items) ? raw.items : []
  return items.flatMap((value) => {
    const item = asRuntimeRecord(value)
    const deviceId = runtimeString(item.id)
    if (!deviceId) return []
    const actions = Array.isArray(item.actions)
      ? item.actions.flatMap((value) => {
          const action = asRuntimeRecord(value)
          const actionName = runtimeString(action.id)
          const actionRef = runtimeString(action.actionRef)
          if (!actionName || !actionRef) return []
          return [{
            actionRef,
            actionName,
            deviceId,
            label: runtimeString(action.name) || actionName,
            typeName: runtimeString(action.typeName) || actionRef,
            isBusy: Boolean(action.busy),
            currentJobId: optionalRuntimeString(action.currentJobId),
            inputSchema: asRuntimeRecord(action.inputSchema),
            outputSchema: asRuntimeRecord(action.outputSchema),
            riskLevel: actionRiskLevel(action.riskLevel)
          }]
        })
      : []
    return [{
      id: deviceId,
      materialUuid: runtimeString(item.materialUuid),
      deviceTypeId: optionalRuntimeString(item.deviceTypeId) ?? undefined,
      deviceKey: runtimeString(item.deviceKey),
      namespace: runtimeString(item.namespace),
      name: runtimeString(item.name) || deviceId,
      online: Boolean(item.online),
      stateSchema: Object.prototype.hasOwnProperty.call(item, 'stateSchema')
        ? normalizeDeviceStateSchema(item.stateSchema)
        : undefined,
      actions
    }]
  })
}

/** 把未知 wire 值转换为字符串，nullish 值归为空字符串。 */
export function runtimeString(value: unknown): string {
  return value == null ? '' : String(value)
}

/** 把未知 wire 数组收窄为非空字符串数组。 */
export function runtimeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(runtimeString).filter(Boolean)
    : []
}

/** 把未知 wire 值安全收窄为普通对象。 */
export function asRuntimeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** 把 Action schema 的 properties 映射为字段定义。 */
function mapActionSchema(
  value: unknown
): Record<string, DeviceActionInputSchema> {
  const schema = asRuntimeRecord(value)
  return Object.fromEntries(
    Object.entries(schema).map(([name, definition]) => [
      name,
      asRuntimeRecord(definition) as DeviceActionInputSchema
    ])
  )
}

/** 把旧平面入参 schema 归一化为 JSON Schema object。 */
function normalizeInputSchema(
  inputSchema: Record<string, unknown>
): Record<string, unknown> {
  if (inputSchema.type === 'object' && isRecord(inputSchema.properties)) {
    return inputSchema
  }
  return { type: 'object', properties: inputSchema }
}

/** 从入参 schema 提取显式默认值。 */
function defaultsFromInputSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const properties = asRuntimeRecord(schema.properties)
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) => {
      const definition = asRuntimeRecord(value)
      return Object.prototype.hasOwnProperty.call(definition, 'default')
        ? [[name, definition.default]]
        : []
    })
  )
}

/** 把未知数值转换为有限数，非法值回退为零。 */
function runtimeNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

/** 把未知字符串收窄为非空字符串或 null。 */
function optionalRuntimeString(value: unknown): string | null {
  const valueString = runtimeString(value).trim()
  return valueString || null
}

/** 校验并返回设备动作风险等级。 */
function actionRiskLevel(value: unknown): DeviceCardActionRiskLevel {
  if (value === undefined || value === null || value === '' || value === 'normal') {
    return 'normal'
  }
  if (value === 'dangerous' || value === 'emergency') return value
  throw new ServiceError({
    code: 'INVALID_ACTION_RISK_LEVEL',
    message: `Edge 返回了无效的 Action 风险等级：${String(value)}`,
    retryable: false
  })
}

/** 判断未知值是否为非数组普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** 把旧 registry/package-catalog 来源名称归一化为 driver。 */
function normalizeDeviceStateSchema(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(asRuntimeRecord(value)).map(([key, definition]) => {
      if (!isRecord(definition)) return [key, definition]
      const source = definition.source
      return [
        key,
        source === 'registry' || source === 'package-catalog'
          ? { ...definition, source: 'driver' }
          : { ...definition }
      ]
    })
  )
}
