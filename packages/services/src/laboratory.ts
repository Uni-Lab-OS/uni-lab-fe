/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: Uni-Lab-OS REST 客户端封装(设备/资源/任务)
 * Context: 对接 Edge v1 health、device catalog 与 resource projection
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { requestData, type HttpClient } from './http'
import { ServiceError } from './errors'
import type { BackendConfig } from './backends'

export interface DeviceActionTarget {
  deviceId: string
  label: string
}

export interface OnlineDevice {
  id: string
  deviceKey: string
  namespace: string
  machineName: string
  online: boolean
  actions: DeviceAction[]
}

export interface DeviceAction {
  actionName: string
  actionRef: string
  displayName: string
  label: string
  typeName: string
  isBusy: boolean
  currentJobId: string | null
  schema: Record<string, unknown> | null
  inputSchema: Record<string, DeviceActionInputSchema>
  outputSchema: Record<string, DeviceActionInputSchema>
}

export interface DeviceActionUnlockResult {
  status: 'unlocked' | 'already_unlocked'
  deviceId: string
  actionName: string
  releasedJobIds: string[]
  cancelRequestedJobIds: string[]
}

export interface DeviceActionInputSchema {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  required?: boolean
  minimum?: number
  maximum?: number
}

export interface DeviceActionSchema {
  schema: Record<string, unknown>
  goalDefault: Record<string, unknown>
  actionType: string
  isBusy: boolean
  currentJobId: string | null
}

export interface DeviceStatus {
  deviceId: string
  status: Record<string, unknown>
  timestamp: number
}

export interface DeviceCatalogAction {
  actionName: string
  actionRef: string
  label: string
  typeName: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  isBusy: boolean
}

export interface DeviceCatalogItem {
  deviceId: string
  deviceTypeId: string
  deviceKey: string
  namespace: string
  label: string
  online: boolean
  actions: DeviceCatalogAction[]
}

export interface ResourceNode {
  id: string
  uuid: string
  name: string
  type: string
  className: string
  parent: string | null
  config: Record<string, unknown>
  data: Record<string, unknown>
  position: { x: number; y: number; z: number }
  children: ResourceNode[]
}

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
}

interface RuntimeDeviceCatalogItem {
  id: string
  deviceKey: string
  namespace: string
  name: string
  online: boolean
  actions: RuntimeActionTemplate[]
}

export function createLaboratoryService(
  http: HttpClient,
  backend: BackendConfig
) {
  return {
    async ping(signal?: AbortSignal): Promise<boolean> {
      try {
        await http.request<unknown>('/api/v1/health', { signal })
        return true
      } catch {
        return false
      }
    },

    async getActionDevices(): Promise<DeviceActionTarget[]> {
      return (await getRuntimeDevices(http))
        .filter((device) => device.actions.length > 0)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((device) => ({ deviceId: device.id, label: device.id }))
    },

    async getDeviceCatalog(): Promise<DeviceCatalogItem[]> {
      const raw = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/devices'
      )
      const items = Array.isArray(raw.items) ? raw.items : []
      return items.map((value) => mapDeviceCatalogItem(asRecord(value)))
    },

    async getOnlineDevices(signal?: AbortSignal): Promise<OnlineDevice[]> {
      return (await getRuntimeDevices(http, signal))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((device) => ({
          id: device.id,
          deviceKey: device.deviceKey,
          namespace: device.namespace,
          machineName: device.name,
          online: device.online,
          actions: device.actions.map(mapDeviceAction)
        }))
    },

    async getDeviceActions(deviceId: string): Promise<DeviceAction[]> {
      const device = (await getRuntimeDevices(http)).find(
        (candidate) => candidate.id === deviceId
      )
      return (device?.actions ?? []).map(mapDeviceAction)
    },

    async getActionSchema(
      deviceId: string,
      actionName: string
    ): Promise<DeviceActionSchema> {
      const actionRef = `${deviceId}.${actionName}`
      const template = (await getRuntimeDevices(http))
        .flatMap((device) => device.actions)
        .find((candidate) => candidate.actionRef === actionRef)
      if (!template) {
        throw new ServiceError({
          code: 'ACTION_NOT_FOUND',
          message: `未找到 Action：${actionRef}`,
          status: 404,
          retryable: false
        })
      }
      return mapDeviceActionSchema(template)
    },

    async forceUnlockDeviceAction(input: {
      deviceId: string
      actionName: string
      expectedJobId: string
    }): Promise<DeviceActionUnlockResult> {
      const response = await requestData<Record<string, unknown>>(
        http,
        `/api/v1/devices/${encodeURIComponent(input.deviceId)}`
          + `/actions/${encodeURIComponent(input.actionName)}/commands`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: 'force_unlock',
            expectedJobId: input.expectedJobId,
            reason: 'operator_confirmed_device_safe'
          })
        }
      )
      const status = str(response.status)
      if (status !== 'unlocked' && status !== 'already_unlocked') {
        throw new ServiceError({
          code: 'INVALID_DEVICE_UNLOCK_RESPONSE',
          message: '设备解锁响应状态无效',
          retryable: false
        })
      }
      return {
        status,
        deviceId: str(response.deviceId) || input.deviceId,
        actionName: str(response.actionName) || input.actionName,
        releasedJobIds: stringArray(response.releasedJobIds),
        cancelRequestedJobIds: stringArray(
          response.cancelRequestedJobIds
        )
      }
    },

    async getResources(): Promise<ResourceNode[]> {
      const raw = await requestData<Record<string, unknown>[]>(
        http,
        '/api/v1/resources'
      )
      return raw.map(mapResource)
    }
  }
}

export type LaboratoryService = ReturnType<typeof createLaboratoryService>

function mapDeviceCatalogItem(
  raw: Record<string, unknown>
): DeviceCatalogItem {
  const deviceId = str(raw.id)
  return {
    deviceId,
    // 当前 OS device-catalog/v1 只有实例 id；兼容未来补充的类型字段。
    deviceTypeId: str(raw.deviceTypeId ?? raw.typeId ?? raw.className) || deviceId,
    deviceKey: str(raw.deviceKey),
    namespace: str(raw.namespace),
    label: str(raw.name) || deviceId,
    online: Boolean(raw.online),
    actions: Array.isArray(raw.actions)
      ? raw.actions.map((value) => {
          const action = asRecord(value)
          const actionRef = str(action.actionRef)
          const separator = actionRef.lastIndexOf('.')
          return {
            actionName: str(action.id) ||
              (separator >= 0 ? actionRef.slice(separator + 1) : actionRef),
            actionRef,
            label: str(action.name) || str(action.id),
            typeName: str(action.typeName),
            inputSchema: asRecord(action.inputSchema),
            outputSchema: asRecord(action.outputSchema),
            isBusy: Boolean(action.busy)
          }
        })
      : []
  }
}

function mapDeviceAction(template: RuntimeActionTemplate): DeviceAction {
  const schema = normalizeInputSchema(template.inputSchema)
  return {
    actionName: template.actionName,
    actionRef: template.actionRef,
    displayName: template.label,
    label: template.label,
    typeName: template.typeName,
    isBusy: template.isBusy,
    currentJobId: template.currentJobId,
    schema,
    inputSchema: mapActionSchema(schema.properties),
    outputSchema: mapActionSchema(template.outputSchema)
  }
}

function mapDeviceActionSchema(
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

function mapResource(raw: Record<string, unknown>): ResourceNode {
  const pos = isRecord(raw.position) ? raw.position : {}
  return {
    id: str(raw.id),
    uuid: str(raw.uuid),
    name: str(raw.name),
    type: str(raw.type),
    className: str(raw.class),
    parent: raw.parent == null ? null : str(raw.parent),
    config: isRecord(raw.config) ? raw.config : {},
    data: isRecord(raw.data) ? raw.data : {},
    position: { x: num(pos.x), y: num(pos.y), z: num(pos.z) },
    children: Array.isArray(raw.children)
      ? raw.children.map((child) => mapResource(asRecord(child)))
      : []
  }
}

async function getRuntimeDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<RuntimeDeviceCatalogItem[]> {
  const raw = await requestData<Record<string, unknown>>(
    http,
    '/api/v1/devices',
    { signal }
  )
  const items = Array.isArray(raw.items) ? raw.items : []
  return items.flatMap((value) => {
    const item = asRecord(value)
    const deviceId = str(item.id)
    if (!deviceId) return []
    const actions = Array.isArray(item.actions)
      ? item.actions.flatMap((value) => {
          const action = asRecord(value)
          const actionName = str(action.id)
          const actionRef = str(action.actionRef)
          if (!actionName || !actionRef) return []
          return [
            {
              actionRef,
              actionName,
              deviceId,
              label: str(action.name) || actionName,
              typeName: str(action.typeName) || actionRef,
              isBusy: Boolean(action.busy),
              currentJobId: optionalString(action.currentJobId),
              inputSchema: asRecord(action.inputSchema),
              outputSchema: asRecord(action.outputSchema)
            }
          ]
        })
      : []
    return [
      {
        id: deviceId,
        deviceKey: str(item.deviceKey),
        namespace: str(item.namespace),
        name: str(item.name) || deviceId,
        online: Boolean(item.online),
        actions
      }
    ]
  })
}

function mapActionSchema(
  value: unknown
): Record<string, DeviceActionInputSchema> {
  const schema = asRecord(value)
  return Object.fromEntries(
    Object.entries(schema).map(([name, definition]) => [
      name,
      asRecord(definition) as DeviceActionInputSchema
    ])
  )
}

function normalizeInputSchema(
  inputSchema: Record<string, unknown>
): Record<string, unknown> {
  if (inputSchema.type === 'object' && isRecord(inputSchema.properties)) {
    return inputSchema
  }
  return {
    type: 'object',
    properties: inputSchema
  }
}

function defaultsFromInputSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const properties = asRecord(schema.properties)
  return Object.fromEntries(
    Object.entries(properties).flatMap(([name, value]) => {
      const definition = asRecord(value)
      return Object.prototype.hasOwnProperty.call(definition, 'default')
        ? [[name, definition.default]]
        : []
    })
  )
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function optionalString(value: unknown): string | null {
  const valueString = str(value).trim()
  return valueString || null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(str).filter(Boolean)
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
