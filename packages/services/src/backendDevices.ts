import type {
  DeviceAction,
  DeviceActionInputSchema,
  DeviceActionSchema,
  DeviceActionTarget,
  DeviceCatalogItem,
  OnlineDevice
} from './laboratory'
import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'
import { loadWorkflowActionCatalog } from './workflowActionCatalog'
import type { WorkflowActionNodeTemplate } from './workflowActionCatalogTypes'

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
  const { devices, templates } = await loadBackendDeviceContext(http)
  return devices.map((device) => ({
    deviceId: device.id,
    materialUuid: device.id,
    resourceTemplateUuid: device.deviceTypeId,
    deviceTypeId: device.deviceTypeId,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    label: device.label,
    online: device.online,
    actions: device.actions.map((action) => {
      const template = matchActionTemplate(device, action, templates)
      return {
        actionName: action.actionName,
        actionRef: action.actionRef,
        label: template?.displayName ?? action.label,
        typeName: action.typeName,
        inputSchema: templateInputSchema(template),
        outputSchema: templateOutputSchema(template),
        riskLevel: 'normal',
        isBusy: false
      }
    })
  }))
}

/** 读取 Backend 可展示的在线设备集合；signal 只控制本次 REST 恢复请求。 */
export async function loadBackendOnlineDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<OnlineDevice[]> {
  const { devices, templates } = await loadBackendDeviceContext(http, signal)
  return devices.map((device) => ({
    id: device.id,
    materialUuid: device.id,
    resourceTemplateUuid: device.deviceTypeId,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    machineName: device.label,
    online: device.online,
    actions: device.actions.map((action) => mapBackendDeviceAction(
      action,
      matchActionTemplate(device, action, templates)
    ))
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
  const { devices, templates } = await loadBackendDeviceContext(http)
  const device = devices
    .find((candidate) => candidate.id === deviceId)
  return (device?.actions ?? []).map((action) => mapBackendDeviceAction(
    action,
    device ? matchActionTemplate(device, action, templates) : null
  ))
}

/**
 * 读取 Backend 设备动作的可编辑输入边界。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param deviceId 设备物料 UUID。
 * @param actionName Edge 为该设备实例声明的动作名。
 * @returns 设备声明与节点模板唯一匹配后得到的输入 schema、默认值和动作类型。
 */
export async function loadBackendActionSchema(
  http: HttpClient,
  deviceId: string,
  actionName: string
): Promise<DeviceActionSchema> {
  const { devices, templates } = await loadBackendDeviceContext(http)
  const device = devices.find((candidate) => candidate.id === deviceId)
  const action = device?.actions.find(
    (candidate) => candidate.actionName === actionName
  )
  if (!action) {
    throw new ServiceError({
      code: 'ACTION_NOT_FOUND',
      message: `未找到设备动作：${deviceId}.${actionName}`,
      status: 404,
      retryable: false
    })
  }
  const template = device
    ? matchActionTemplate(device, action, templates)
    : null
  if (!template) {
    throw new ServiceError({
      code: 'ACTION_TEMPLATE_NOT_FOUND',
      message: `设备动作缺少唯一节点模板：${deviceId}.${actionName}`,
      status: 409,
      retryable: true
    })
  }
  return {
    schema: template.schema,
    goalDefault: template.goalDefault,
    actionType: action.typeName,
    isBusy: false,
    currentJobId: null
  }
}

/** 一次读取同一 Authority 的设备实例与动作模板，供正常产品界面组合。 */
async function loadBackendDeviceContext(
  http: HttpClient,
  signal?: AbortSignal
): Promise<{
  devices: BackendDevice[]
  templates: WorkflowActionNodeTemplate[]
}> {
  const [devices, catalog] = await Promise.all([
    loadBackendDevices(http, signal),
    loadWorkflowActionCatalog(http, signal)
  ])
  return { devices, templates: catalog.actionTemplates }
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
function mapBackendDeviceAction(
  action: BackendDeviceAction,
  template: WorkflowActionNodeTemplate | null
): DeviceAction {
  return {
    actionName: action.actionName,
    actionRef: action.actionRef,
    displayName: template?.displayName ?? action.label,
    label: template?.displayName ?? action.label,
    typeName: action.typeName,
    isBusy: false,
    currentJobId: null,
    schema: template?.schema ?? emptyInputSchema(),
    inputSchema: templateInputSchema(template),
    outputSchema: templateOutputSchema(template),
    riskLevel: 'normal'
  }
}

/** 按设备模板、动作名与动作类型唯一关联动作模板；冲突或缺失都失败关闭。 */
function matchActionTemplate(
  device: BackendDevice,
  action: BackendDeviceAction,
  templates: WorkflowActionNodeTemplate[]
): WorkflowActionNodeTemplate | null {
  const matches = templates.filter((template) =>
    template.resourceTemplateUuid === device.deviceTypeId &&
    template.name === action.actionName &&
    template.actionType === action.typeName
  )
  return matches.length === 1 ? matches[0] ?? null : null
}

/** 从平面或类型化动作合同提取设备表单字段。 */
function templateInputSchema(
  template: WorkflowActionNodeTemplate | null
): Record<string, DeviceActionInputSchema> {
  if (!template) return {}
  const properties = recordOrNull(template.schema.properties)
  const goal = recordOrNull(properties?.goal)
  const fields = recordOrNull(goal?.properties) ?? properties
  return inputFields(fields)
}

/** 从类型化动作合同提取结果字段；平面 Backend 参数合同没有输出 schema。 */
function templateOutputSchema(
  template: WorkflowActionNodeTemplate | null
): Record<string, DeviceActionInputSchema> {
  if (!template) return {}
  const properties = recordOrNull(template.schema.properties)
  const result = recordOrNull(properties?.result)
  return inputFields(recordOrNull(result?.properties))
}

/** 只保留普通对象形式的 JSON Schema 属性。 */
function inputFields(
  value: Record<string, unknown> | null
): Record<string, DeviceActionInputSchema> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, schema]) =>
      isRecord(schema)
        ? [[name, schema as DeviceActionInputSchema]]
        : []
    )
  )
}

/** 收窄可选普通对象。 */
function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
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
