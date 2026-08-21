import {
  createServices,
  getDefaultBackend,
  type BackendConfig,
  type Services
} from '@unilab/services'

export const WORKBENCH_CONNECTION_STORAGE_KEY =
  'unilab.workbench.connection-mode.v1'
export const WORKBENCH_LOCAL_PROXY_PREFIX = '/__unilab_local'
export const WORKBENCH_BACKEND_PROXY_PREFIX = '/__unilab_backend'

export type WorkbenchConnectionMode = 'local' | 'backend'
export type WorkbenchAuthorityProfile =
  | 'local_scheduler'
  | 'backend_controlled'

export interface WorkbenchConnectionTarget {
  mode: WorkbenchConnectionMode
  authorityProfile: WorkbenchAuthorityProfile
  /** Runtime 实体、缓存、SSE cursor 与 pending mutation 的隔离身份。 */
  sourceId: string
  /** 固定 Local Authoring Projection 的隔离身份。 */
  authoringSourceId: string
  title: string
  description: string
  endpointLabel: string
  cacheKey: string
  backend: BackendConfig
}

export interface WorkbenchConnectionTargets {
  local: WorkbenchConnectionTarget
  backend: WorkbenchConnectionTarget
}

interface InitialWorkbenchConnectionEnvironment {
  search: string
  storedMode?: string | null
}

interface WorkbenchConnectionTargetEnvironment {
  managedLocalUrl?: string | null
  /** @deprecated 兼容旧调用方；该地址现在属于 Workspace Backend。 */
  managedEdgeUrl?: string | null
  browserOrigin?: string
}

/**
 * 解析 Workbench 首次使用的调度权威选择。
 * @param environment 当前查询串与用户上次确认的公开模式身份。
 * @returns 显式查询优先、其次持久偏好、最终保持本地 Workspace Backend 的模式。
 */
export function resolveInitialWorkbenchConnectionMode(
  environment: InitialWorkbenchConnectionEnvironment
): WorkbenchConnectionMode {
  const search = new URLSearchParams(environment.search)
  const explicitMode = parseWorkbenchConnectionMode(
    search.get('workbenchConnection')
  )
  if (explicitMode) return explicitMode
  const backendId = search.get('backend')
  if (backendId === 'local-go') return 'backend'
  if (backendId === 'local-python') return 'local'
  return parseWorkbenchConnectionMode(environment.storedMode) ?? 'local'
}

/**
 * 构造 Workbench 可选的两套统一服务目标。
 * @param environment Workbench 托管 Workspace Backend 地址与当前浏览器同源地址。
 * @returns 互相隔离、分别声明本地调度和后端控制权威的目标集合。
 */
export function createWorkbenchConnectionTargets(
  environment: WorkbenchConnectionTargetEnvironment
): WorkbenchConnectionTargets {
  const localUrl = normalizeEndpoint(
    environment.managedLocalUrl ?? environment.managedEdgeUrl,
    getDefaultBackend('local-python').apiUrl
  )
  const backendUrl = workbenchBackendProxyUrl(environment.browserOrigin)
  const localApiUrl = environment.browserOrigin
    ? workbenchLocalProxyUrl(environment.browserOrigin)
    : localUrl
  const localBackend: BackendConfig = {
    ...getDefaultBackend('local-python'),
    name: '本地调试',
    apiUrl: localApiUrl,
    realtimeUrl: toRealtimeUrl(localUrl)
  }
  const backend: BackendConfig = {
    ...getDefaultBackend('local-go'),
    name: 'Backend + Scheduler',
    apiUrl: backendUrl
  }
  const authoringSourceId = `authoring:${localUrl}`
  return {
    local: {
      mode: 'local',
      authorityProfile: 'local_scheduler',
      sourceId: `runtime:local:${localUrl}`,
      authoringSourceId,
      title: '本地调试',
      description: '常驻 Workspace Backend 持有本地物料、工作流与任务事实。',
      endpointLabel: localUrl,
      cacheKey: `runtime:local:${localUrl}`,
      backend: localBackend
    },
    backend: {
      mode: 'backend',
      authorityProfile: 'backend_controlled',
      sourceId: `runtime:backend:${backendUrl}`,
      authoringSourceId,
      title: 'Backend + Scheduler',
      description: 'Backend 负责管理任务与作业，已注册 Edge 只负责执行。',
      endpointLabel: WORKBENCH_BACKEND_PROXY_PREFIX,
      cacheKey: `runtime:backend:${backendUrl}`,
      backend
    }
  }
}

/**
 * 创建绑定一个已确认调度权威目标的统一前端服务集合。
 * @param target 包含 profile、地址和缓存身份的 Workbench 连接目标。
 * @returns 设备、物料、工作流和库存共用的 Services 组合根。
 */
export function createWorkbenchServices(
  target: WorkbenchConnectionTarget
): Services {
  return createServices({ backend: target.backend })
}

/**
 * 序列化用户确认的 Workbench 连接模式。
 * @param mode 公开的 Local 或 Backend Authority 选择，不含地址与凭证。
 * @returns 可直接写入浏览器存储的稳定字符串。
 */
export function serializeWorkbenchConnectionMode(
  mode: WorkbenchConnectionMode
): string {
  return mode
}

/**
 * 校验一个外部字符串是否为公开连接模式。
 * @param value 查询参数或浏览器存储中的不可信值。
 * @returns 有效模式；未知值返回 null，调用方据此失败关闭。
 */
function parseWorkbenchConnectionMode(
  value: string | null | undefined
): WorkbenchConnectionMode | null {
  if (value === 'edge') return 'local'
  return value === 'local' || value === 'backend' ? value : null
}

/**
 * 生成 Theia 页面同源的 Backend 代理地址。
 * @param browserOrigin 当前浏览器 Origin；测试或 SSR 缺失时使用 Backend 缺省地址。
 * @returns 可交给统一 HTTP 适配器的绝对 API 根地址。
 */
function workbenchBackendProxyUrl(browserOrigin: string | undefined): string {
  if (!browserOrigin) return getDefaultBackend('local-go').apiUrl
  try {
    return new URL(WORKBENCH_BACKEND_PROXY_PREFIX, browserOrigin)
      .toString()
      .replace(/\/$/u, '')
  } catch {
    return getDefaultBackend('local-go').apiUrl
  }
}

/**
 * 生成只转发 Workspace Backend 的同源代理地址。
 * @param browserOrigin 当前 Theia 页面 Origin。
 * @returns 本地权威专用代理；缺少 Origin 时回退到运行时直连地址。
 */
function workbenchLocalProxyUrl(browserOrigin: string | undefined): string {
  if (!browserOrigin) return getDefaultBackend('local-python').apiUrl
  try {
    return new URL(WORKBENCH_LOCAL_PROXY_PREFIX, browserOrigin)
      .toString()
      .replace(/\/$/u, '')
  } catch {
    return getDefaultBackend('local-python').apiUrl
  }
}

/**
 * 规范当前端点，避免结尾斜杠形成不同缓存身份。
 * @param value 会话发布的候选 HTTP 根地址。
 * @param fallback 会话尚未启动时使用的 profile 缺省地址。
 * @returns 去除结尾斜杠的地址。
 */
function normalizeEndpoint(
  value: string | null | undefined,
  fallback: string
): string {
  return (value?.trim() || fallback).replace(/\/$/u, '')
}

/**
 * 从 Workspace Backend HTTP 根地址派生同主机实时地址。
 * @param apiUrl 已规范化的 Workspace Backend HTTP 地址。
 * @returns ws 或 wss 根地址；非法地址保持原值以便后续探测明确失败。
 */
function toRealtimeUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString().replace(/\/$/u, '')
  } catch {
    return apiUrl
  }
}
