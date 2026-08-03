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

interface DeviceStatusMessage {
  type: string
  data: {
    device_status?: Record<string, Record<string, unknown>>
    device_status_timestamps?: Record<string, number | Record<string, unknown>>
  }
}

export interface DeviceStatusHandlers {
  onDeviceStatus: (statuses: DeviceStatus[]) => void
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
  handlers: DeviceStatusHandlers
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
      const nextSocket = new WebSocket(toDeviceStatusUrl(baseUrl))
      socket = nextSocket
      nextSocket.onopen = () => handlers.onOpen?.()
      nextSocket.onmessage = (event) => {
        const parsed = parseMessage(event.data)
        if (!parsed || parsed.type !== 'device_status') return
        handlers.onDeviceStatus(mapStatuses(parsed.data))
      }
      nextSocket.onerror = () => {
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

export function createRealtimeService(backend: BackendConfig): RealtimeService {
  const disposers = new Set<() => void>()
  const realtimeBaseUrl = backend.realtimeUrl || backend.apiUrl

  return {
    subscribeDeviceStatus: (handlers) => {
      const close = connectDeviceStatus(realtimeBaseUrl, handlers)
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
