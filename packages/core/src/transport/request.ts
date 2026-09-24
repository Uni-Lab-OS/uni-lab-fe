export type TransportMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface TransportRequest {
  readonly method: TransportMethod
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface TransportResponse<Value> {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly data: Value
}

export interface RequestTransport {
  request<Value>(request: TransportRequest): Promise<TransportResponse<Value>>
}

export interface TransportErrorOptions {
  readonly code: string
  readonly message: string
  readonly status?: number
  readonly retryable?: boolean
  readonly cause?: unknown
}

export class TransportError extends Error {
  readonly code: string
  readonly status?: number
  readonly retryable: boolean

  constructor(options: TransportErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'TransportError'
    this.code = options.code
    this.status = options.status
    this.retryable = options.retryable ?? false
  }
}
