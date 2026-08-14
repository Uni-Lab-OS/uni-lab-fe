/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: Uni-Lab-OS WebSocket 客户端封装(设备状态订阅)
 * Context: 订阅 Edge FastAPI /api/v1/ws/device_status（约 1Hz）
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import type { BackendConfig } from './backends'
import type { DeviceStatus } from './laboratory'
import {
  createHttpRequestTrace,
  finishHttpRequestTrace,
  reportHttpRequestTrace,
  type HttpRequestTraceReporter
} from './http'

interface RealtimeMessage {
  type?: unknown
  action?: unknown
  data?: unknown
}

export interface DeviceJointStateFrame {
  deviceId: string
  topologyDigest: string
  bootId: string
  sequence: number
  observedAt: number
  staleAfterSeconds: number
  jointStates: Readonly<Record<string, number>>
}

export interface DeviceStatusHandlers {
  onDeviceStatus: (statuses: DeviceStatus[]) => void
  /** 高频关节快照；调用方必须写入独立 scene runtime，不能进入 React 状态树。 */
  onJointState?: (frame: DeviceJointStateFrame) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: string) => void
}

/** Edge mounts the api router at /api/v1; route is /ws/device_status. */
export function toDeviceStatusUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  const wsBase = trimmed.replace(/^http/, 'ws')
  if (wsBase.endsWith('/api/v1/ws/device_status')) return wsBase
  if (wsBase.endsWith('/ws/device_status')) {
    return wsBase.replace(/\/ws\/device_status$/, '/api/v1/ws/device_status')
  }
  return `${wsBase}/api/v1/ws/device_status`
}

// 建立设备状态订阅连接,返回关闭函数
export function connectDeviceStatus(
  baseUrl: string,
  handlers: DeviceStatusHandlers,
  traceRequest?: HttpRequestTraceReporter
): () => void {
  let closedByCaller = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null

  const scheduleReconnect = (): void => {
    if (closedByCaller || reconnectTimer !== null) return
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, 1_000)
  }

  const openSocket = (): void => {
    if (closedByCaller) return
    try {
      const socketUrl = toDeviceStatusUrl(baseUrl)
      const requestTrace = createHttpRequestTrace(socketUrl, 'GET', 'websocket')
      const tracedUrl = new URL(socketUrl)
      tracedUrl.searchParams.set('traceparent', requestTrace.traceparent)
      let traceReported = false
      // Electron/Theia can expose a WebSocket-compatible constructor that only
      // accepts the legacy string overload. Passing a URL object may establish
      // TCP and still abort before the HTTP upgrade, producing an opaque retry
      // loop. Normalize at this transport boundary for browser and desktop.
      const nextSocket = new WebSocket(tracedUrl.toString())
      socket = nextSocket
      nextSocket.onopen = () => {
        reportHttpRequestTrace(traceRequest, finishHttpRequestTrace(
          requestTrace,
          'open',
          101
        ))
        traceReported = true
        handlers.onOpen?.()
      }
      nextSocket.onmessage = (event) => {
        const parsed = parseMessage(event.data)
        if (!parsed) return
        if (parsed.type === 'device_status') {
          handlers.onDeviceStatus(mapStatuses(parsed.data))
          return
        }
        if (
          parsed.type === 'push_joint_state'
          || parsed.action === 'push_joint_state'
        ) {
          const frame = mapJointState(parsed.data)
          if (frame) handlers.onJointState?.(frame)
        }
      }
      nextSocket.onerror = () => {
        if (!traceReported) {
          reportHttpRequestTrace(traceRequest, finishHttpRequestTrace(
            requestTrace,
            'error'
          ))
          traceReported = true
        }
        handlers.onError?.('设备状态 WebSocket 连接出错')
      }
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null
        if (closedByCaller) return
        handlers.onClose?.()
        scheduleReconnect()
      }
    } catch {
      handlers.onError?.('设备状态 WebSocket 连接出错')
      handlers.onClose?.()
      scheduleReconnect()
    }
  }

  openSocket()

  return () => {
    closedByCaller = true
    if (reconnectTimer !== null) {
      globalThis.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    socket?.close()
    socket = null
  }
}

export interface RealtimeService {
  subscribeDeviceStatus: (handlers: DeviceStatusHandlers) => () => void
  dispose: () => void
}

export function createRealtimeService(
  backend: BackendConfig,
  traceRequest?: HttpRequestTraceReporter
): RealtimeService {
  const disposers = new Set<() => void>()
  const realtimeBaseUrl = backend.realtimeUrl || backend.apiUrl

  return {
    subscribeDeviceStatus: (handlers) => {
      const close = connectDeviceStatus(
        realtimeBaseUrl,
        handlers,
        backend.serverKind === 'edge' ? traceRequest : undefined
      )
      disposers.add(close)
      return () => {
        close()
        disposers.delete(close)
      }
    },
    dispose: () => {
      for (const close of disposers) close()
      disposers.clear()
    }
  }
}

// 解析消息文本为结构体;失败返回 null
function parseMessage(raw: unknown): RealtimeMessage | null {
  if (typeof raw !== 'string') return null
  try {
    const obj = JSON.parse(raw)
    if (isRecord(obj)) return obj
    return null
  } catch {
    return null
  }
}

// 将推送的 device_status 字典拍平为数组
function mapStatuses(data: unknown): DeviceStatus[] {
  if (!isRecord(data)) return []
  const statusMap = isRecord(data.device_status) ? data.device_status : {}
  const timestamps = isRecord(data.device_status_timestamps)
    ? data.device_status_timestamps
    : {}
  return Object.entries(statusMap).map(([deviceId, status]) => ({
    deviceId,
    status: isRecord(status) ? status : {},
    timestamp: deviceTimestamp(timestamps[deviceId])
  }))
}

function mapJointState(data: unknown): DeviceJointStateFrame | null {
  if (!isRecord(data) || !isRecord(data.joint_states)) return null
  const deviceId = boundedString(data.device_id, 200)
  const topologyDigest = boundedString(data.topology_digest, 200)
  const bootId = boundedString(data.boot_id, 200)
  const sequence = finiteNonNegativeInteger(data.sequence)
  const observedAtSeconds = finiteNonNegativeNumber(data.observed_at)
  const staleAfterSeconds = finiteNonNegativeNumber(data.stale_after_s)
  if (
    deviceId === null
    || topologyDigest === null
    || bootId === null
    || sequence === null
    || observedAtSeconds === null
    || staleAfterSeconds === null
  ) return null

  const entries = Object.entries(data.joint_states)
  if (entries.length === 0 || entries.length > 128) return null
  const jointStates: Record<string, number> = {}
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim()
    if (
      !name
      || name.length > 200
      || typeof rawValue !== 'number'
      || !Number.isFinite(rawValue)
      || Math.abs(rawValue) > 1_000_000
    ) return null
    jointStates[name] = rawValue
  }

  return Object.freeze({
    deviceId,
    topologyDigest,
    bootId,
    sequence,
    observedAt: Math.round(observedAtSeconds * 1_000),
    staleAfterSeconds,
    jointStates: Object.freeze(jointStates)
  })
}

function deviceTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nums = Object.values(value).flatMap((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) return [item]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nested = (item as { timestamp?: unknown }).timestamp
        if (typeof nested === 'number' && Number.isFinite(nested)) return [nested]
      }
      return []
    })
    if (nums.length > 0) return Math.max(...nums)
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function finiteNonNegativeInteger(value: unknown): number | null {
  const normalized = finiteNonNegativeNumber(value)
  return normalized !== null && Number.isSafeInteger(normalized)
    ? normalized
    : null
}
