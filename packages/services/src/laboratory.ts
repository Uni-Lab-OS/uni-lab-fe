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
  loadBackendDeviceActionDeclarations,
  loadBackendDeviceActions,
  loadBackendDeviceCatalog,
  loadBackendOnlineDevices
} from './backendDevices'
import type {
  WorkflowActionCatalogReader
} from './workflowActionCatalogStore'
import {
  getRuntimeDevices,
  mapRuntimeDeviceAction,
  mapRuntimeDeviceActionSchema,
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
  /** Edge 连接事实；旧服务未返回时由 adapter 从 online 兼容恢复。 */
  edgeStatus?: DeviceEdgeStatus
  /** 当前调度器是否允许向设备派发新作业。 */
  dispatchable?: boolean
  /** 在线但不可派发时的权威安全阻断原因。 */
  dispatchBlockReason?: string | null
  /** 当前设备级执行占用摘要；null/undefined 表示当前服务未提供该投影。 */
  executionOccupancies?: DeviceExecutionOccupancy[] | null
  actions: DeviceAction[]
}

export interface OnlineDeviceReadOptions {
  /** 启动恢复阶段可跳过 Edge 全量动作占用，发现在线设备后再完整补读。 */
  includeActionStatuses?: boolean
}

/** 设备实例直接声明的动作；可执行模板合同由 WorkflowActionCatalog 独立提供。 */
export interface DeviceActionDeclaration {
  actionName: string
  typeName: string
  isBusy: boolean
  currentJobId: string | null
}

/** 实验操作节点库使用的轻量设备与动作声明快照。 */
export interface DeviceActionDeclarationDevice {
  id: string
  materialUuid: string
  resourceTemplateUuid: string
  deviceKey: string
  namespace: string
  machineName: string
  online: boolean
  edgeStatus: DeviceEdgeStatus
  dispatchable: boolean
  dispatchBlockReason: string | null
  actions: DeviceActionDeclaration[]
}

export type DeviceEdgeStatus = 'registered' | 'online' | 'offline'

export type DeviceExecutionOccupancyState =
  | 'reserved'
  | 'running'
  | 'uncertain'

export interface DeviceExecutionOccupancy {
  leaseUuid: string | null
  workflowTaskUuid: string | null
  workflowNodeJobUuid: string
  state: DeviceExecutionOccupancyState
  actionName: string | null
  acquiredAt: string | null
}

export interface DeviceAction {
  actionName: string
  actionRef: string
  displayName: string
  label: string
  typeName: string
  isBusy: boolean
  /** 当前 Authority 是否明确提供动作占用状态；省略表示旧调用方已有可靠状态。 */
  busyStatusKnown?: boolean
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
  edgeStatus?: DeviceEdgeStatus
  dispatchable?: boolean
  dispatchBlockReason?: string | null
  executionOccupancies?: DeviceExecutionOccupancy[] | null
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

/**
 * 创建统一实验室服务，服务端差异只在 adapter 内收敛。
 *
 * @param http 已绑定所选服务地址的 HTTP 客户端。
 * @param backend 当前 Backend/Edge Profile 与能力身份。
 * @returns 供产品界面使用的统一实验室服务端口。
 */
export function createLaboratoryService(
  http: HttpClient,
  backend: BackendConfig,
  readActionCatalog?: WorkflowActionCatalogReader
) {
  const usesRuntimeDeviceCatalog =
    backend.id === 'local-go' || backend.id === 'local-python'

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
      if (usesRuntimeDeviceCatalog) {
        return (await loadRuntimeOnlineDevices(http))
          .filter((device) => device.actions.length > 0)
          .map((device) => ({ deviceId: device.id, label: device.machineName }))
      }
      return loadBackendActionDevices(http)
    },

    async getDeviceCatalog(): Promise<DeviceCatalogItem[]> {
      if (usesRuntimeDeviceCatalog) {
        return (await loadRuntimeOnlineDevices(http)).map(mapRuntimeDeviceCatalog)
      }
      return loadBackendDeviceCatalog(
        http,
        backend.serverKind,
        readActionCatalog
      )
    },

    async getOnlineDevices(
      signal?: AbortSignal,
      options: OnlineDeviceReadOptions = {}
    ): Promise<OnlineDevice[]> {
      if (usesRuntimeDeviceCatalog) {
        return loadRuntimeOnlineDevices(http, signal)
      }
      return loadBackendOnlineDevices(
        http,
        signal,
        backend.serverKind,
        readActionCatalog,
        options.includeActionStatuses ?? true
      )
    },

    async getDeviceActionDeclarations(
      signal?: AbortSignal
    ): Promise<DeviceActionDeclarationDevice[]> {
      if (usesRuntimeDeviceCatalog) {
        return (await loadRuntimeOnlineDevices(http, signal)).map(
          mapRuntimeDeviceActionDeclaration
        )
      }
      return loadBackendDeviceActionDeclarations(http, signal)
    },

    async getDeviceActions(deviceId: string): Promise<DeviceAction[]> {
      if (usesRuntimeDeviceCatalog) {
        const device = (await loadRuntimeOnlineDevices(http))
          .find((candidate) => candidate.id === deviceId)
        return device?.actions ?? []
      }
      return loadBackendDeviceActions(
        http,
        deviceId,
        backend.serverKind,
        readActionCatalog
      )
    },

    async getActionSchema(
      deviceId: string,
      actionName: string
    ): Promise<DeviceActionSchema> {
      if (usesRuntimeDeviceCatalog) {
        const device = (await loadRuntimeOnlineDevices(http))
          .find((candidate) => candidate.id === deviceId)
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
        return mapRuntimeDeviceActionSchema(action)
      }
      return loadBackendActionSchema(
        http,
        deviceId,
        actionName,
        backend.serverKind,
        readActionCatalog
      )
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

async function loadRuntimeOnlineDevices(
  http: HttpClient,
  signal?: AbortSignal
): Promise<OnlineDevice[]> {
  const runtimeDevices = await getRuntimeDevices(http, signal)
  const inventoryTemplateIds = runtimeDevices.some((device) =>
    device.deviceTypeId != null &&
    !RESOURCE_TEMPLATE_UUID.test(device.deviceTypeId)
  )
    ? await loadInventoryResourceTemplateIds(http, signal)
    : new Map<string, string>()
  return runtimeDevices
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((device) => ({
      id: device.id,
      materialUuid: device.materialUuid,
      resourceTemplateUuid:
        inventoryTemplateIds.get(device.id) ??
        inventoryTemplateIds.get(device.deviceKey) ??
        device.deviceTypeId,
      deviceKey: device.deviceKey,
      namespace: device.namespace,
      machineName: device.name,
      online: device.online,
      edgeStatus: device.online ? 'online' : 'offline',
      dispatchable: device.online,
      dispatchBlockReason: null,
      actions: device.actions.map(mapRuntimeDeviceAction)
    }))
}

const RESOURCE_TEMPLATE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 用库存设备实例的资源模板 UUID 补齐本地 authoring 目录里的类名身份。
 *
 * 本地 Edge 把 `deviceTypeId` 写成 `community.szlab_poly_studio.xxx`，
 * 而动作目录按库存 UUID 区分实机/仿真同名动作。
 */
async function loadInventoryResourceTemplateIds(
  http: HttpClient,
  signal?: AbortSignal
): Promise<Map<string, string>> {
  try {
    const raw = await requestData<unknown>(http, '/api/v1/devices', { signal })
    if (!Array.isArray(raw)) return new Map()
    const resolved = new Map<string, string>()
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      const binding = record.binding && typeof record.binding === 'object'
        && !Array.isArray(record.binding)
        ? record.binding as Record<string, unknown>
        : null
      const material = record.material && typeof record.material === 'object'
        && !Array.isArray(record.material)
        ? record.material as Record<string, unknown>
        : null
      const templateId = typeof material?.resource_template_uuid === 'string'
        ? material.resource_template_uuid
        : ''
      const localId = typeof binding?.local_id === 'string' ? binding.local_id : ''
      if (RESOURCE_TEMPLATE_UUID.test(templateId) && localId) {
        resolved.set(localId, templateId)
      }
    }
    return resolved
  } catch {
    return new Map()
  }
}

function mapRuntimeDeviceCatalog(device: OnlineDevice): DeviceCatalogItem {
  return {
    deviceId: device.id,
    materialUuid: device.materialUuid,
    resourceTemplateUuid: device.resourceTemplateUuid,
    deviceTypeId: device.resourceTemplateUuid ?? device.id,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    label: device.machineName,
    online: device.online,
    edgeStatus: device.edgeStatus,
    dispatchable: device.dispatchable,
    dispatchBlockReason: device.dispatchBlockReason,
    actions: device.actions.map((action) => ({
      actionName: action.actionName,
      actionRef: action.actionRef,
      label: action.displayName,
      typeName: action.typeName,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      riskLevel: action.riskLevel,
      isBusy: action.isBusy
    }))
  }
}

function mapRuntimeDeviceActionDeclaration(
  device: OnlineDevice
): DeviceActionDeclarationDevice {
  return {
    id: device.id,
    materialUuid: device.materialUuid,
    resourceTemplateUuid: device.resourceTemplateUuid ?? device.id,
    deviceKey: device.deviceKey,
    namespace: device.namespace,
    machineName: device.machineName,
    online: device.online,
    edgeStatus: device.edgeStatus ?? (device.online ? 'online' : 'offline'),
    dispatchable: device.dispatchable ?? device.online,
    dispatchBlockReason: device.dispatchBlockReason ?? null,
    actions: device.actions.map((action) => ({
      actionName: action.actionName,
      typeName: action.typeName,
      isBusy: action.isBusy,
      currentJobId: action.currentJobId
    }))
  }
}

/**
 * 创建桌面端本地 Driver/注册表诊断使用的富设备目录读取端口。
 * 与 createLaboratoryService 的本地适配共用同一套 OS authoring 目录映射。
 */
export function createLocalAuthoringLaboratoryService(http: HttpClient) {
  return {
    async getOnlineDevices(signal?: AbortSignal): Promise<OnlineDevice[]> {
      return loadRuntimeOnlineDevices(http, signal)
    }
  }
}
