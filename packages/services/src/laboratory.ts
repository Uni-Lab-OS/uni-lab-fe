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
import type { DeviceCardActionRiskLevel } from '@unilab/device-card-sdk'
import {
  loadBackendActionDevices,
  loadBackendActionSchema,
  loadBackendDeviceActions,
  loadBackendDeviceCatalog,
  loadBackendOnlineDevices
} from './backendDevices'
import {
  getRuntimeDevices,
  mapRuntimeDeviceAction,
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
  /** Backend 设备物料所属的资源模板（ResourceTemplate）UUID；旧 Edge 目录可省略。 */
  resourceTemplateUuid?: string
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
  /** Backend 设备物料所属的资源模板（ResourceTemplate）UUID；旧 Edge 目录可省略。 */
  resourceTemplateUuid?: string
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
    /** 使用统一 v1 健康端点探测 Backend 或 Edge，并透传调用方取消信号。 */
    async ping(signal?: AbortSignal): Promise<boolean> {
      try {
        await http.request<unknown>('/api/v1/health', { signal })
        return true
      } catch {
        return false
      }
    },

    async getActionDevices(): Promise<DeviceActionTarget[]> {
      return loadBackendActionDevices(http)
    },

    async getDeviceCatalog(): Promise<DeviceCatalogItem[]> {
      return loadBackendDeviceCatalog(http)
    },

    async getOnlineDevices(signal?: AbortSignal): Promise<OnlineDevice[]> {
      return loadBackendOnlineDevices(http, signal)
    },

    async getDeviceActions(deviceId: string): Promise<DeviceAction[]> {
      return loadBackendDeviceActions(http, deviceId)
    },

    async getActionSchema(
      deviceId: string,
      actionName: string
    ): Promise<DeviceActionSchema> {
      return loadBackendActionSchema(http, deviceId, actionName)
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

/**
 * 创建只供桌面端本地 Driver/注册表诊断使用的富设备目录读取端口。
 * 正常产品界面必须使用 createLaboratoryService 的共享 DeviceOverview 合同。
 */
export function createLocalAuthoringLaboratoryService(http: HttpClient) {
  return {
    async getOnlineDevices(signal?: AbortSignal): Promise<OnlineDevice[]> {
      return (await getRuntimeDevices(http, signal))
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((device) => ({
          id: device.id,
          materialUuid: device.materialUuid,
          resourceTemplateUuid: device.deviceTypeId,
          deviceKey: device.deviceKey,
          namespace: device.namespace,
          machineName: device.name,
          online: device.online,
          actions: device.actions.map(mapRuntimeDeviceAction)
        }))
    }
  }
}
