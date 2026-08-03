/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 设备实时状态订阅 hook(在线模式下连接 /api/v1/ws/device_status)
 * Context: 设备方向实时状态灯,离线不连接,连接状态与更新时间对外暴露
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { useServices } from '@unilab/services'
import { useWorkbench } from '../context/WorkbenchContext'
import type { DeviceStatus } from '../data/lab'

export interface UseDeviceStatusResult {
  // 以 deviceId 为键的实时状态表
  statusMap: Map<string, DeviceStatus>
  // WebSocket 是否已建立
  connected: boolean
  // 最近一次收到推送的时间戳(ms),无推送为 null
  lastUpdate: number | null
}

const DeviceStatusContext = createContext<UseDeviceStatusResult | null>(null)

export function DeviceStatusProvider({
  children
}: {
  children: ReactNode
}): ReactElement {
  const value = useDeviceStatusSubscription()
  return createElement(DeviceStatusContext.Provider, { value }, children)
}

// 订阅设备实时状态:仅在线模式连接 /api/v1/ws/device_status,离线返回空表
export function useDeviceStatus(): UseDeviceStatusResult {
  const value = useContext(DeviceStatusContext)
  if (!value) {
    throw new Error('useDeviceStatus 必须在 DeviceStatusProvider 内使用。')
  }
  return value
}

function useDeviceStatusSubscription(): UseDeviceStatusResult {
  const { backendEnabled, connection } = useWorkbench()
  const services = useServices()
  const realtime = services.realtime
  const canSubscribeStatus = services.capabilities.devices.subscribeStatus
  const [statusMap, setStatusMap] = useState<Map<string, DeviceStatus>>(new Map())
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)

  // 用 ref 保存最新状态表,避免每条推送都重建订阅
  const mapRef = useRef<Map<string, DeviceStatus>>(new Map())

  const canConnect =
    backendEnabled &&
    connection === 'connected' &&
    canSubscribeStatus

  useEffect(() => {
    if (!canConnect) {
      mapRef.current = new Map()
      setStatusMap(new Map())
      setConnected(false)
      setLastUpdate(null)
      return
    }

    const close = realtime.subscribeDeviceStatus({
      onOpen: () => setConnected(true),
      onClose: () => {
        mapRef.current = new Map()
        setStatusMap(new Map())
        setConnected(false)
        setLastUpdate(null)
      },
      onDeviceStatus: (statuses) => {
        const next = new Map<string, DeviceStatus>()
        statuses.forEach((item) => next.set(item.deviceId, item))
        mapRef.current = next
        setStatusMap(next)
        setLastUpdate(Date.now())
      }
    })

    return () => {
      close()
      setConnected(false)
    }
  }, [canConnect, realtime])

  return useMemo(
    () => ({ statusMap, connected, lastUpdate }),
    [statusMap, connected, lastUpdate]
  )
}

// 在状态表中按设备的多种标识(uuid/deviceKey/nodeName)查找状态
export function findDeviceStatus(
  statusMap: Map<string, DeviceStatus>,
  keys: Array<string | null | undefined>
): DeviceStatus | null {
  for (const key of keys) {
    if (key && statusMap.has(key)) return statusMap.get(key) ?? null
  }
  return null
}
