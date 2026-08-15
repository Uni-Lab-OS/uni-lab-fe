import type { BackendConfig } from './backends'
import { ServiceError } from './errors'

export interface HttpClient {
  request: <ResponseValue>(
    path: string,
    init?: RequestInit
  ) => Promise<ResponseValue>
}

export interface ApiEnvelope<Value> {
  code?: number
  data: Value
  message?: string
  error?: {
    code?: string
    message?: string
    msg?: string
    info?: unknown
    retryable?: boolean
  }
}

type ApiCommandEnvelope = Omit<ApiEnvelope<unknown>, 'data'> & {
  data?: unknown
}

export interface CreateHttpClientOptions {
  backend: BackendConfig
  fetcher?: typeof fetch
  getAccessToken?: () => string | null | Promise<string | null>
  timeoutMs?: number
  traceRequest?: HttpRequestTraceReporter
}

export type HttpRequestTransport = 'http' | 'sse' | 'websocket'
export type HttpRequestTraceReporter = (
  event: HttpRequestTraceEvent
) => void | Promise<void>

export interface HttpRequestTraceEvent {
  transport: HttpRequestTransport
  method: string
  path: string
  traceId: string
  spanId: string
  traceparent: string
  startedAtUnixMs: number
  durationMs: number
  statusCode?: number
  outcome: 'ok' | 'error' | 'cancelled' | 'open'
}

export interface ActiveHttpRequestTrace {
  transport: HttpRequestTransport
  method: string
  path: string
  traceId: string
  spanId: string
  traceparent: string
  startedAtUnixMs: number
}

/**
 * 创建绑定单一后端权威配置的 HTTP 客户端。
 *
 * @param options 后端地址、Fetch 边界、令牌、超时和可选追踪上报器。
 * @returns 统一处理超时、鉴权、Backend/Edge 错误封装与追踪的请求端口。
 */
export function createHttpClient(options: CreateHttpClientOptions): HttpClient {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000

  return {
    request: async <ResponseValue>(
      path: string,
      init: RequestInit = {}
    ): Promise<ResponseValue> => {
      const controller = new AbortController()
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
      const token = await options.getAccessToken?.()
      const headers = new Headers(init.headers)
      if (token) headers.set('Authorization', token)
      const requestUrl = endpoint(options.backend.apiUrl, path)
      const requestTrace = options.backend.serverKind === 'edge'
        ? createHttpRequestTrace(
            requestUrl,
            init.method ?? 'GET',
            'http'
          )
        : undefined
      if (requestTrace) headers.set('traceparent', requestTrace.traceparent)
      let statusCode: number | undefined
      let outcome: HttpRequestTraceEvent['outcome'] = 'error'

      try {
        const response = await fetcher(requestUrl, {
          ...init,
          headers,
          signal: init.signal ?? controller.signal
        })
        statusCode = response.status
        if (!response.ok) {
          let problem: unknown
          try {
            problem = await response.json()
          } catch {
            problem = null
          }
          const problemRecord = asRecord(problem)
          const detail = asRecord(problemRecord.detail)
          const errorEnvelope = asRecord(problemRecord.error)
          const message = String(
            errorEnvelope.message ||
            errorEnvelope.msg ||
            detail.detail ||
            problemRecord.message ||
            problemRecord.detail ||
            `请求失败: ${response.status} ${response.statusText}`
          )
          throw new ServiceError({
            code: String(
              errorEnvelope.code ||
              detail.code ||
              problemRecord.code ||
              'HTTP_REQUEST_FAILED'
            ),
            message,
            status: response.status,
            retryable:
              typeof errorEnvelope.retryable === 'boolean'
                ? errorEnvelope.retryable
                : response.status >= 500
          })
        }
        const result = (await response.json()) as ResponseValue
        outcome = 'ok'
        return result
      } catch (error) {
        if (error instanceof ServiceError) throw error
        const isAbort = error instanceof DOMException && error.name === 'AbortError'
        throw new ServiceError({
          code: isAbort ? 'HTTP_REQUEST_TIMEOUT' : 'HTTP_REQUEST_FAILED',
          message: isAbort ? '请求超时' : error instanceof Error ? error.message : '请求失败',
          retryable: true
        })
      } finally {
        globalThis.clearTimeout(timeout)
        if (requestTrace) {
          reportHttpRequestTrace(options.traceRequest, finishHttpRequestTrace(
            requestTrace,
            outcome,
            statusCode
          ))
        }
      }
    }
  }
}

export function createHttpRequestTrace(
  url: string,
  method: string,
  transport: HttpRequestTransport
): ActiveHttpRequestTrace {
  const traceId = randomHex(16)
  const spanId = randomHex(8)
  return {
    transport,
    method: method.toUpperCase(),
    path: new URL(url).pathname,
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
    startedAtUnixMs: Date.now()
  }
}

export function finishHttpRequestTrace(
  trace: ActiveHttpRequestTrace,
  outcome: HttpRequestTraceEvent['outcome'],
  statusCode?: number
): HttpRequestTraceEvent {
  return {
    ...trace,
    durationMs: Math.max(0, Date.now() - trace.startedAtUnixMs),
    ...(statusCode === undefined ? {} : { statusCode }),
    outcome
  }
}

export function reportHttpRequestTrace(
  reporter: HttpRequestTraceReporter | undefined,
  event: HttpRequestTraceEvent
): void {
  if (!reporter) return
  try {
    void Promise.resolve(reporter(event)).catch(() => undefined)
  } catch {
    // 可观测性必须 fail-open，不得改变业务请求结果。
  }
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  if (bytes.every((value) => value === 0)) bytes[bytes.length - 1] = 1
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

/**
 * 解包 Backend/Edge 共享响应，并保留 HTTP 200 中的业务拒绝事实。
 *
 * @param http 已绑定当前后端权威的 HTTP 客户端。
 * @param path 公开 API 路径。
 * @param init 可选请求方法、请求头、请求体和取消信号。
 * @returns 服务端 data 字段中的权威 DTO。
 * @throws error.message、Backend error.msg、非零 code 或缺失 data 时抛出 ServiceError。
 */
export async function requestData<Value>(
  http: HttpClient,
  path: string,
  init?: RequestInit
): Promise<Value> {
  const envelope = await http.request<ApiEnvelope<Value>>(path, init)
  assertSuccessfulEnvelope(envelope)
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw new ServiceError({
      code: 'INVALID_API_RESPONSE',
      message: '服务端响应缺少 data 字段',
      retryable: false
    })
  }
  return envelope.data
}

/**
 * 校验没有返回资源主体的 Backend/Edge 命令响应。
 * @param http 已绑定当前后端权威的 HTTP 客户端。
 * @param path 公开命令 API 路径。
 * @param init 请求方法、请求体和取消信号。
 * @returns 服务端明确接受命令后完成；成功响应可以省略 data。
 */
export async function requestCommand(
  http: HttpClient,
  path: string,
  init?: RequestInit
): Promise<void> {
  const envelope = await http.request<ApiCommandEnvelope>(path, init)
  assertSuccessfulEnvelope(envelope)
}

/** 校验统一信封中的业务错误，不要求只读资源命令必须返回 data。 */
function assertSuccessfulEnvelope(envelope: ApiCommandEnvelope): void {
  if (envelope.error) {
    throw new ServiceError({
      code: envelope.error.code || (
        envelope.code == null
          ? 'API_REQUEST_REJECTED'
          : `API_${envelope.code}`
      ),
      message: envelope.error.message || envelope.error.msg ||
        envelope.message || '服务端拒绝请求',
      retryable: envelope.error.retryable === true
    })
  }
  if (envelope.code != null && envelope.code !== 0) {
    throw new ServiceError({
      code: 'API_REQUEST_REJECTED',
      message: envelope.message || `后端返回错误码 ${envelope.code}`,
      retryable: false
    })
  }
}

function endpoint(baseUrl: string, path: string): string {
  if (!baseUrl) {
    throw new ServiceError({
      code: 'BACKEND_NOT_CONFIGURED',
      message: '后端地址尚未配置'
    })
  }
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}
