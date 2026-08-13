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
import type {
  DeviceCardActionRiskLevel,
  DeviceDefinitionReference
} from '@unilab/device-card-sdk'
import {
  loadBackendActionDevices,
  loadBackendActionSchema,
  loadBackendDeviceActions,
  loadBackendDeviceCatalog,
  loadBackendOnlineDevices
} from './backendDevices'
import {
  asRuntimeRecord,
  getRuntimeDevices,
  mapRuntimeDeviceAction,
  mapRuntimeDeviceActionSchema,
  mapRuntimeDeviceCatalogItem,
  mapRuntimeResource,
  runtimeString,
  runtimeStringArray
} from './laboratoryRuntimeAdapter'

export interface DeviceActionTarget {
  deviceId: string
  label: string
}

export interface OnlineDevice {
  id: string
  materialUuid: string
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
  riskLevel: DeviceCardActionRiskLevel
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
  riskLevel: DeviceCardActionRiskLevel
  isBusy: boolean
}

export interface DeviceCatalogItem {
  deviceId: string
  materialUuid: string
  /** PackageCatalog 权威投影的规范设备定义；缺失时卡片开发与 Live 失败关闭。 */
  definition: DeviceDefinitionReference | null
  definitionFqid: string | null
  /** @deprecated 只供设备管理兼容显示；设备卡片不得用它替代 definitionFqid。 */
  deviceTypeId: string
  deviceKey: string
  namespace: string
  label: string
  online: boolean
  /** Formal Driver/Host property contract. Runtime samples never extend it. */
  stateSchema?: Record<string, unknown>
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

export function createLaboratoryService(
  http: HttpClient,
  backend: BackendConfig
) {
  return {
    async ping(signal?: AbortSignal): Promise<boolean> {
      try {
        const path = backend.serverKind === 'backend' ? '/health' : '/api/v1/health'
        await http.request<unknown>(path, { signal })
        return true
      } catch {
        return false
      }
    },

    async getActionDevices(): Promise<DeviceActionTarget[]> {
      if (backend.serverKind === 'backend') return loadBackendActionDevices(http)
      return (await getRuntimeDevices(http))
        .filter((device) => device.actions.length > 0)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((device) => ({ deviceId: device.id, label: device.id }))
    },

    async getDeviceCatalog(): Promise<DeviceCatalogItem[]> {
      if (backend.serverKind === 'backend') return loadBackendDeviceCatalog(http)
      const raw = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/devices'
      )
      const items = Array.isArray(raw.items) ? raw.items : []
      return items.map((value) => (
        mapRuntimeDeviceCatalogItem(asRuntimeRecord(value))
      ))
    },

    async getOnlineDevices(signal?: AbortSignal): Promise<OnlineDevice[]> {
      if (backend.serverKind === 'backend') return loadBackendOnlineDevices(http, signal)
      return (await getRuntimeDevices(http, signal))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((device) => ({
          id: device.id,
          materialUuid: device.materialUuid,
          deviceKey: device.deviceKey,
          namespace: device.namespace,
          machineName: device.name,
          online: device.online,
          actions: device.actions.map(mapRuntimeDeviceAction)
        }))
    },

    async getDeviceActions(deviceId: string): Promise<DeviceAction[]> {
      if (backend.serverKind === 'backend') return loadBackendDeviceActions(http, deviceId)
      const device = (await getRuntimeDevices(http)).find(
        (candidate) => candidate.id === deviceId
      )
      return (device?.actions ?? []).map(mapRuntimeDeviceAction)
    },

    async getActionSchema(
      deviceId: string,
      actionName: string
    ): Promise<DeviceActionSchema> {
      if (backend.serverKind === 'backend') return loadBackendActionSchema(http, deviceId, actionName)
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
      return mapRuntimeDeviceActionSchema(template)
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
      const status = runtimeString(response.status)
      if (status !== 'unlocked' && status !== 'already_unlocked') {
        throw new ServiceError({
          code: 'INVALID_DEVICE_UNLOCK_RESPONSE',
          message: '设备解锁响应状态无效',
          retryable: false
        })
      }
      return {
        status,
        deviceId: runtimeString(response.deviceId) || input.deviceId,
        actionName: runtimeString(response.actionName) || input.actionName,
        releasedJobIds: runtimeStringArray(response.releasedJobIds),
        cancelRequestedJobIds: runtimeStringArray(
          response.cancelRequestedJobIds
        )
      }
    },

    async getResources(): Promise<ResourceNode[]> {
      const raw = await requestData<Record<string, unknown>[]>(
        http,
        '/api/v1/resources'
      )
      return raw.map(mapRuntimeResource)
    }
  }
}

export type LaboratoryService = ReturnType<typeof createLaboratoryService>
