import {
  createBackendCore,
  createWorkflowRuntimeEvents,
  getCapabilityStatus,
  resolveServerCapabilities,
  type BackendCore,
  type CapabilityStatus,
  type ServerCapability,
} from '@unilab-fe/core'

export interface BackendConfig {
  readonly id: string
  readonly name: string
  readonly protocol: 'unilab/v1'
  readonly apiUrl: string
  readonly auth: 'none' | 'token' | 'oauth'
  readonly serverKind: 'backend' | 'edge'
  readonly workspaceMode: 'singleton' | 'laboratory'
  /**
   * 工站级接口的作用域。OS 目前 StationExecutionControl 的 station_id 恒为 "local"，
   * 还没有多工站支持；这里把它作为**部署事实**显式声明（可用 VITE_UNILAB_STATION_ID
   * 覆盖），而不是散落在组件里硬编码，等 OS 支持多工站后由 Profile 提供。
   */
  readonly stationId: string
}

export interface StudioBackend {
  readonly core: BackendCore
  readonly config: BackendConfig
  readonly getCapabilityStatus: (capability: ServerCapability) => CapabilityStatus
  readonly dispose: () => void
}

/**
 * 浏览器应用只通过这个 composition root 获取领域 port。
 * 默认走同源代理，生产环境可通过 VITE_UNILAB_API_URL 指向 Edge / OS。
 */
export function createStudioBackend(): StudioBackend {
  const backendId = import.meta.env.VITE_UNILAB_BACKEND_ID || 'local-python'
  const configuredBaseUrl =
    import.meta.env.VITE_UNILAB_API_URL || import.meta.env.VITE_EDGE_API_URL || '/__unilab_backend'
  // Core 的 HTTP/SSE adapter 需要绝对 URL；同源代理仍然保留原始路径。
  const baseUrl = new URL(configuredBaseUrl, window.location.origin).toString().replace(/\/$/, '')
  const config: BackendConfig = {
    id: backendId,
    name: 'Uni-Lab OS',
    protocol: 'unilab/v1',
    apiUrl: baseUrl,
    auth: 'none',
    serverKind: backendId === 'local-go' ? 'backend' : 'edge',
    workspaceMode: 'singleton',
    stationId: import.meta.env.VITE_UNILAB_STATION_ID || 'local',
  }
  const accessToken = () => window.sessionStorage.getItem('unilab.access_token')
  const capabilities = resolveServerCapabilities(config)
  const runtimeEvents = createWorkflowRuntimeEvents({
    baseUrl,
    getAccessToken: accessToken,
  })
  const core = createBackendCore(
    {
      baseUrl,
      timeoutMs: 12_000,
      getAccessToken: accessToken,
    },
    {
      runtimeEvents,
      stationId: config.stationId,
    },
  )
  return {
    config,
    core,
    getCapabilityStatus: (capability) => getCapabilityStatus(config, capabilities, capability),
    dispose: runtimeEvents.dispose,
  }
}
