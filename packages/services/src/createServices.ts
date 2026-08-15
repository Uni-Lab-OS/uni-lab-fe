import type { BackendConfig } from './backends'
import {
  getCapabilityStatus,
  resolveServerCapabilities,
  type CapabilityStatus,
  type ServerCapabilities,
  type ServerCapability
} from './capabilities'
import { createHttpClient, type CreateHttpClientOptions } from './http'
import {
  createLaboratoryService,
  type LaboratoryService
} from './laboratory'
import {
  createDeviceActionTaskRuntime,
  type DeviceActionTaskRuntimePort
} from './deviceActionTasks'
import {
  createDeviceSquareService,
  type DeviceSquareService
} from './deviceSquare'
import {
  createRealtimeService,
  type RealtimeService
} from './realtime'
import {
  createMaterialService,
  type MaterialService
} from './materials'
import {
  createInventoryReadPort,
  type InventoryPort
} from './inventory'
import {
  createWorkflowRuntime,
  type WorkflowRuntimePort
} from './workflow'

export interface Services {
  backend: BackendConfig
  capabilities: ServerCapabilities
  getCapabilityStatus: (capability: ServerCapability) => CapabilityStatus
  laboratory: LaboratoryService
  deviceActionTasks: DeviceActionTaskRuntimePort
  deviceSquare: DeviceSquareService
  materials: MaterialService
  inventory: InventoryPort
  realtime: RealtimeService
  workflow: WorkflowRuntimePort
  dispose: () => void
}

export interface CreateServicesOptions {
  backend: BackendConfig
  fetcher?: CreateHttpClientOptions['fetcher']
  getAccessToken?: CreateHttpClientOptions['getAccessToken']
  traceRequest?: CreateHttpClientOptions['traceRequest']
}

/**
 * 创建前端服务组合根（Composition Root），并保证每类业务接口只有一个具体适配器实例。
 *
 * @param options 当前 Backend 配置、可选 Fetch 边界和访问令牌读取函数。
 * @returns 已装配设备、物料、实时与工作流服务的统一对象。
 */
export function createServices(options: CreateServicesOptions): Services {
  // HTTP 客户端是当前服务端配置下所有公开 API 适配器共享的传输边界。
  const http = createHttpClient(options)
  // 实时服务拥有会话级连接，必须由 Services.dispose 统一释放。
  const realtime = createRealtimeService(options.backend, options.traceRequest)
  // 能力快照决定物料服务是否允许读取公共物料图（MaterialGraph）。
  const capabilities = resolveServerCapabilities(options.backend)
  // 物料服务（Material Service）是公共物料图 wire 解码与访问的唯一实例。
  const materials = createMaterialService(
    http,
    options.backend,
    capabilities
  )
  // 工作流运行时（Workflow Runtime）复用同一个物料服务实例，不再建立私有库存适配器。
  const workflow = createWorkflowRuntime(http, options.backend, {
    materialGraph: materials,
    traceRequest: options.traceRequest
  })

  return {
    backend: options.backend,
    capabilities,
    getCapabilityStatus: (capability) =>
      getCapabilityStatus(options.backend, capabilities, capability),
    laboratory: createLaboratoryService(http, options.backend),
    deviceActionTasks: createDeviceActionTaskRuntime(http),
    deviceSquare: createDeviceSquareService(http),
    materials,
    inventory: createInventoryReadPort(http, options.backend),
    realtime,
    workflow,
    dispose: () => {
      realtime.dispose()
      workflow.dispose()
    }
  }
}
