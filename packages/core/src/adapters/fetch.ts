import {
  TransportError,
  type RequestTransport,
  type TransportRequest,
  type TransportResponse,
} from '../transport/request'

export interface FetchTransportOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
  readonly getAccessToken?: () => string | null | Promise<string | null>
  readonly timeoutMs?: number
}

export function createFetchTransport(options: FetchTransportOptions): RequestTransport {
  const fetcher = options.fetcher ?? fetch

  return {
    request: async <Value>(request: TransportRequest): Promise<TransportResponse<Value>> => {
      const controller = new AbortController()
      const timeoutMs = request.timeoutMs ?? options.timeoutMs ?? 8_000
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      request.signal?.addEventListener('abort', abort, { once: true })

      try {
        const headers = new Headers(request.headers)
        const token = await options.getAccessToken?.()
        if (token) headers.set('Authorization', token)

        let body: BodyInit | undefined
        if (request.body !== undefined) {
          if (typeof request.body === 'string') {
            body = request.body
            if (!headers.has('content-type')) {
              headers.set('content-type', 'application/json')
            }
          } else if (isPassthroughBody(request.body)) {
            // multipart 的 boundary 只能由运行时生成，显式 content-type 会让
            // 服务端无法解析文件字段。
            body = request.body
            headers.delete('content-type')
          } else {
            body = JSON.stringify(request.body)
            if (!headers.has('content-type')) {
              headers.set('content-type', 'application/json')
            }
          }
        }

        const response = await fetcher(joinUrl(options.baseUrl, request.url), {
          method: request.method,
          headers,
          body,
          signal: controller.signal,
        })
        const data = await readResponseBody(response)

        if (!response.ok) {
          throw new TransportError({
            code: responseCode(data) ?? 'HTTP_REQUEST_FAILED',
            message: responseMessage(data) ?? `HTTP ${response.status}`,
            status: response.status,
            retryable: response.status >= 500,
            cause: data,
          })
        }

        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          data: data as Value,
        }
      } catch (error) {
        if (error instanceof TransportError) throw error
        const aborted = controller.signal.aborted
        throw new TransportError({
          code: aborted ? 'HTTP_REQUEST_ABORTED' : 'HTTP_REQUEST_FAILED',
          message: aborted ? '请求已中止或超时' : errorMessage(error),
          retryable: !aborted,
          cause: error,
        })
      } finally {
        globalThis.clearTimeout(timeout)
        request.signal?.removeEventListener('abort', abort)
      }
    },
  }
}

/** 文件上传等二进制载荷必须原样交给 fetch，不能被 JSON 序列化。 */
function isPassthroughBody(body: unknown): body is BodyInit {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function responseCode(value: unknown): string | undefined {
  const record = asRecord(value)
  const error = asRecord(record?.error)
  return stringValue(error?.code) ?? stringValue(record?.code)
}

function responseMessage(value: unknown): string | undefined {
  const record = asRecord(value)
  const error = asRecord(record?.error)
  return stringValue(error?.message) ?? stringValue(error?.msg) ?? stringValue(record?.message)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}
