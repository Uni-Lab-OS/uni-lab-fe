import type {
  DeviceAction,
  DeviceActionSchema,
  DeviceActionTarget,
  DeviceCatalogItem,
  OnlineDevice
} from './laboratory'
import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

interface BackendDevice {
  id: string
  deviceTypeId: string
  deviceKey: string
  namespace: string
  label: string
  online: boolean
  actions: BackendDeviceAction[]
}

interface BackendDeviceAction {
  actionName: string
  actionRef: string
  label: string
  typeName: string
}

/**
 * 读取 Backend 设备目录，并投影为设备卡片使用的目录合同。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @returns 设备物料、Edge 绑定、在线状态及当前声明动作的只读目录。
 */
export async function loadBackendDeviceCatalog(
  http: HttpClient
): Promise<DeviceCatalogItem[]> {
  return (await loadBackendDevices(http)).map((device) => ({
    deviceId: device.id,
    materialUuid: device.id,
    // Backend 当前只给出 ResourceTemplate UUID，不能冒充 PackageCatalog FQID。
    definition: null,
    definitionFqid: null,
    deviceTypeId: device.deviceTypeId,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    label: device.label,
    online: device.online,
    actions: device.actions.map((action) => ({
      actionName: action.actionName,
      actionRef: action.actionRef,
      label: action.label,
      typeName: action.typeName,
      inputSchema: {},
      outputSchema: {},
      riskLevel: 'normal',
      isBusy: false
    }))
  }))
}

/** 读取 Backend 可展示的在线设备集合；signal 只控制本次 REST 恢复请求。 */
export async function loadBackendOnlineDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<OnlineDevice[]> {
  return (await loadBackendDevices(http, signal)).map((device) => ({
    id: device.id,
    materialUuid: device.id,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    machineName: device.label,
    online: device.online,
    actions: device.actions.map(mapBackendDeviceAction)
  }))
}

/** 读取至少声明一个动作的 Backend 设备目标。 */
export async function loadBackendActionDevices(
  http: HttpClient
): Promise<DeviceActionTarget[]> {
  return (await loadBackendDevices(http))
    .filter((device) => device.actions.length > 0)
    .map((device) => ({ deviceId: device.id, label: device.label }))
}

/** 读取一个 Backend 设备实例当前声明的动作。 */
export async function loadBackendDeviceActions(
  http: HttpClient,
  deviceId: string
): Promise<DeviceAction[]> {
  const device = (await loadBackendDevices(http))
    .find((candidate) => candidate.id === deviceId)
  return (device?.actions ?? []).map(mapBackendDeviceAction)
}

/**
 * 读取 Backend 设备动作的可编辑输入边界。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param deviceId 设备物料 UUID。
 * @param actionName Edge 为该设备实例声明的动作名。
 * @returns 当前只读目录可证明的空输入 schema 与精确动作类型；不推断模板参数。
 */
export async function loadBackendActionSchema(
  http: HttpClient,
  deviceId: string,
  actionName: string
): Promise<DeviceActionSchema> {
  const action = (await loadBackendDeviceActions(http, deviceId))
    .find((candidate) => candidate.actionName === actionName)
  if (!action) {
    throw new ServiceError({
      code: 'ACTION_NOT_FOUND',
      message: `未找到设备动作：${deviceId}.${actionName}`,
      status: 404,
      retryable: false
    })
  }
  return {
    schema: action.schema ?? emptyInputSchema(),
    goalDefault: {},
    actionType: action.typeName,
    isBusy: false,
    currentJobId: null
  }
}

/** 解码 Backend `/devices` 数组，并把设备身份固定为 Material UUID。 */
async function loadBackendDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<BackendDevice[]> {
  const raw = await requestData<unknown>(http, '/api/v1/devices', { signal })
  if (!Array.isArray(raw) || raw.some((item) => !isRecord(item))) {
    throw invalidDeviceCatalog('data must be an object array')
  }
  return (raw as Record<string, unknown>[])
    .map(mapBackendDevice)
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** 投影单个 Backend DeviceOverview，保留 Edge 与物料权威身份。 */
function mapBackendDevice(raw: Record<string, unknown>): BackendDevice {
  const binding = recordValue(raw.binding, 'binding')
  const material = recordValue(raw.material, 'material')
  const id = requiredString(material.uuid, 'material.uuid')
  const deviceKey = requiredString(binding.local_id, 'binding.local_id')
  const namespace = requiredString(binding.edge_uuid, 'binding.edge_uuid')
  const deviceTypeId = requiredString(
    material.resource_template_uuid,
    'material.resource_template_uuid'
  )

  return {
    id,
    deviceTypeId,
    deviceKey,
    namespace,
    label: optionalString(material.name) ??
      optionalString(binding.name) ?? deviceKey,
    online: raw.dispatchable === true,
    actions: recordArray(raw.actions, 'actions').map((action) => {
      const actionName = requiredString(action.name, 'actions[].name')
      const typeName = requiredString(action.type, 'actions[].type')
      return {
        actionName,
        actionRef: `${id}.${actionName}`,
        label: actionName,
        typeName
      }
    })
  }
}

/** 把只读动作声明映射为设备卡片动作；运行能力由 capability 继续关闭。 */
function mapBackendDeviceAction(action: BackendDeviceAction): DeviceAction {
  return {
    actionName: action.actionName,
    actionRef: action.actionRef,
    displayName: action.label,
    label: action.label,
    typeName: action.typeName,
    isBusy: false,
    currentJobId: null,
    schema: emptyInputSchema(),
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'normal'
  }
}

/** 返回明确的空对象输入 schema，避免把未知参数误报为可执行。 */
function emptyInputSchema(): Record<string, unknown> {
  return { type: 'object', properties: {} }
}

/** 读取必填普通对象。 */
function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidDeviceCatalog(`${field} must be an object`)
  return value
}

/** 读取普通对象数组。 */
function recordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw invalidDeviceCatalog(`${field} must be an object array`)
  }
  return value as Record<string, unknown>[]
}

/** 读取必填非空字符串。 */
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw invalidDeviceCatalog(`${field} must be a non-empty string`)
  return result
}

/** 读取可选非空字符串。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 判断未知 JSON 值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** 创建可诊断、不可重试的 Backend 设备目录合同错误。 */
function invalidDeviceCatalog(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_DEVICE_CATALOG',
    message: `Backend 设备目录响应无效：${detail}`,
    retryable: false
  })
}
