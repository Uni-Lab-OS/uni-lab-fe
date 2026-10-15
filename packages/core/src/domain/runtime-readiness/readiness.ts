import { TransportError, type RequestTransport } from '../../transport/request'

/**
 * OS 运行时就绪状态。设备包控制台在冷启动装配期间返回 status=starting 与阶段、进度；
 * 通用 OS 只在就绪后监听并返回 status=ready。未声明的字段保持缺省。
 */
export interface RuntimeReadiness {
  readonly status: 'ready' | 'starting' | 'failed' | 'unknown'
  readonly phase?: string
  readonly label?: string
  readonly progress?: { readonly done: number; readonly total: number }
  readonly elapsedS?: number
  readonly error?: string
}

export function decodeRuntimeReadiness(value: unknown): RuntimeReadiness {
  const record = asRecord(value) ?? {}
  const status = record.status
  const progress = asRecord(record.progress)
  const done = progress?.done
  const total = progress?.total
  return {
    status:
      status === 'ready' || status === 'starting' || status === 'failed' ? status : 'unknown',
    ...(typeof record.phase === 'string' ? { phase: record.phase } : {}),
    ...(typeof record.label === 'string' && record.label ? { label: record.label } : {}),
    ...(typeof done === 'number' && typeof total === 'number' && total > 0
      ? { progress: { done, total } }
      : {}),
    ...(typeof record.elapsed_s === 'number' ? { elapsedS: record.elapsed_s } : {}),
    ...(typeof record.error === 'string' && record.error ? { error: record.error } : {}),
  }
}

export class RuntimeReadinessClient {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async getReadiness(): Promise<RuntimeReadiness> {
    try {
      const response = await this.transport.request<unknown>({
        method: 'GET',
        url: `${this.apiPrefix}/readiness`,
        timeoutMs: 5_000,
      })
      return decodeRuntimeReadiness(response.data)
    } catch (error) {
      // 启动服务对非 readiness 接口返回 503；readiness 本身失败时附带的进度仍可读取。
      const readiness = error instanceof TransportError ? asRecord(asRecord(error.cause)?.readiness) : undefined
      if (readiness) return decodeRuntimeReadiness(readiness)
      throw error
    }
  }
}

/**
 * 判断错误是否表示“后端尚未就绪或不可达”，而非业务失败：
 * 启动服务的 OS_STARTING、网关类 502/503/504、开发代理连不上后端时的空响应 500，
 * 以及未收到任何 HTTP 响应的网络错误。用于显示“OS 启动中”而不是“数据加载失败”。
 */
export function isBackendUnavailableError(error: unknown): boolean {
  if (!(error instanceof TransportError)) return false
  if (error.code === 'OS_STARTING') return true
  if (error.code === 'HTTP_REQUEST_ABORTED') return false
  if (error.status === undefined) return error.code === 'HTTP_REQUEST_FAILED'
  if (error.status === 502 || error.status === 503 || error.status === 504) return true
  return error.status === 500 && isEmptyBody(error.cause)
}

function isEmptyBody(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
