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

interface DeviceStatusMessage {
  type: string
  data: {
    device_status?: Record<string, Record<string, unknown>>
    device_status_timestamps?: Record<string, number | Record<string, unknown>>
  }
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface DeviceStatusHandlers {
  onDeviceStatus: (statuses: DeviceStatus[]) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: string) => void
}

export interface JointStateFrame {
  node_uuid: string
  joint_states: Readonly<Record<string, number>>
}

export interface JointStateDiagnostic {
  code: 'invalid_joint_state_frame'
  message: string
}

export interface JointStateHandlers {
  onJointState: (frame: JointStateFrame) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: string) => void
  onDiagnostic?: (diagnostic: JointStateDiagnostic) => void
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

/** Edge exposes instance-scoped joint frames on a dedicated realtime route. */
export function toJointStateUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  const wsBase = trimmed.replace(/^http/, 'ws')
  if (wsBase.endsWith('/api/v1/ws/joint_states')) return wsBase
  if (wsBase.endsWith('/ws/joint_states')) {
    return wsBase.replace(/\/ws\/joint_states$/, '/api/v1/ws/joint_states')
  }
  return `${wsBase}/api/v1/ws/joint_states`
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
      const nextSocket = new WebSocket(tracedUrl)
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
        if (!parsed || parsed.type !== 'device_status') return
        handlers.onDeviceStatus(mapStatuses(parsed.data))
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

/** Subscribe to typed joint frames without coupling them to Material Graph reads. */
export function connectJointStates(
  baseUrl: string,
  handlers: JointStateHandlers,
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
      const socketUrl = toJointStateUrl(baseUrl)
      const requestTrace = createHttpRequestTrace(socketUrl, 'GET', 'websocket')
      const tracedUrl = new URL(socketUrl)
      tracedUrl.searchParams.set('traceparent', requestTrace.traceparent)
      let traceReported = false
      const nextSocket = new WebSocket(tracedUrl)
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
        let frame: JointStateFrame
        try {
          frame = parseJointStateMessage(event.data)
        } catch (cause) {
          handlers.onDiagnostic?.({
            code: 'invalid_joint_state_frame',
            message: cause instanceof Error ? cause.message : String(cause)
          })
          return
        }
        handlers.onJointState(frame)
      }
      nextSocket.onerror = () => {
        if (!traceReported) {
          reportHttpRequestTrace(traceRequest, finishHttpRequestTrace(
            requestTrace,
            'error'
          ))
          traceReported = true
        }
        handlers.onError?.('关节状态 WebSocket 连接出错')
      }
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null
        if (closedByCaller) return
        handlers.onClose?.()
        scheduleReconnect()
      }
    } catch {
      handlers.onError?.('关节状态 WebSocket 连接出错')
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
  subscribeJointState: (handlers: JointStateHandlers) => () => void
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
    subscribeJointState: (handlers) => {
      const close = connectJointStates(
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

export function parseJointStateMessage(raw: unknown): JointStateFrame {
  if (typeof raw !== 'string') {
    throw new Error('joint-state frame must be JSON text')
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('joint-state frame must contain valid JSON')
  }
  if (!isPlainRecord(value)) {
    throw new Error('joint-state frame must be an object')
  }
  const keys = Object.keys(value)
  if (
    keys.length !== 2 ||
    !keys.includes('node_uuid') ||
    !keys.includes('joint_states')
  ) {
    throw new Error('joint-state frame must contain only node_uuid and joint_states')
  }
  if (
    typeof value.node_uuid !== 'string' ||
    !CANONICAL_UUID.test(value.node_uuid)
  ) {
    throw new Error('joint-state node_uuid must be a canonical UUID')
  }
  if (!isPlainRecord(value.joint_states)) {
    throw new Error('joint-state joint_states must be an object')
  }
  const jointStates: Record<string, number> = {}
  for (const [jointName, position] of Object.entries(value.joint_states)) {
    if (!jointName.trim() || jointName !== jointName.trim()) {
      throw new Error('joint-state names must be non-empty trimmed strings')
    }
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      throw new Error(`joint-state ${jointName} must be a finite number`)
    }
    jointStates[jointName] = position
  }
  return {
    node_uuid: value.node_uuid,
    joint_states: jointStates
  }
}

// 解析消息文本为结构体;失败返回 null
function parseMessage(raw: unknown): DeviceStatusMessage | null {
  if (typeof raw !== 'string') return null
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as DeviceStatusMessage
    return null
  } catch {
    return null
  }
}

// 将推送的 device_status 字典拍平为数组
function mapStatuses(data: DeviceStatusMessage['data']): DeviceStatus[] {
  const statusMap = data.device_status ?? {}
  const timestamps = data.device_status_timestamps ?? {}
  return Object.entries(statusMap).map(([deviceId, status]) => ({
    deviceId,
    status,
    timestamp: deviceTimestamp(timestamps[deviceId])
  }))
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
