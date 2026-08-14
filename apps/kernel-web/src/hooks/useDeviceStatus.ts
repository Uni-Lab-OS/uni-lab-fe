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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  useServices,
  type DeviceJointStateFrame
} from '@unilab/services'
import { useWorkbench } from '../context/WorkbenchContext'
import type {
  ConnectionStatus,
  DeviceStatus,
  WorkbenchSection
} from '../data/lab'

export interface UseDeviceStatusResult {
  // 以 deviceId 为键的实时状态表
  statusMap: Map<string, DeviceStatus>
  // WebSocket 是否已建立
  connected: boolean
  // 最近一次收到推送的时间戳(ms),无推送为 null
  lastUpdate: number | null
  /** 命令式高频关节流；不得把帧复制进 React state。 */
  subscribeJointState: (
    listener: (frame: DeviceJointStateFrame) => void
  ) => () => void
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

/**
 * 根据当前工作台切面管理旧设备状态订阅生命周期。
 *
 * @returns 设备状态映射、连接标志和最后更新时间。
 * @throws 实时服务未装配或 React Hook 使用非法时原样传播。
 */
function useDeviceStatusSubscription(): UseDeviceStatusResult {
  const { backendEnabled, connection, section } = useWorkbench()
  const services = useServices()
  const realtime = services.realtime
  const canSubscribeStatus = services.capabilities.devices.subscribeStatus
  const [statusMap, setStatusMap] = useState<Map<string, DeviceStatus>>(new Map())
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const jointStateListenersRef = useRef(
    new Set<(frame: DeviceJointStateFrame) => void>()
  )
  const subscribeJointState = useCallback((
    listener: (frame: DeviceJointStateFrame) => void
  ): (() => void) => {
    jointStateListenersRef.current.add(listener)
    return () => jointStateListenersRef.current.delete(listener)
  }, [])

  // 用 ref 保存最新状态表,避免每条推送都重建订阅
  const mapRef = useRef<Map<string, DeviceStatus>>(new Map())

  const canConnect = shouldSubscribeDeviceStatus({
    backendEnabled,
    connection,
    canSubscribeStatus,
    section
  })

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
      },
      onJointState: (frame) => {
        for (const listener of jointStateListenersRef.current) listener(frame)
      }
    })

    return () => {
      close()
      setConnected(false)
    }
  }, [canConnect, realtime])

  return useMemo(
    () => ({ statusMap, connected, lastUpdate, subscribeJointState }),
    [statusMap, connected, lastUpdate, subscribeJointState]
  )
}

/**
 * 判定当前工作台是否需要旧设备状态 WebSocket。
 *
 * @param input 后端开关、连接状态、能力与当前工作台切面。
 * @returns 只有仪器设备切面在能力就绪时返回 `true`。
 * @throws 无；输入是前端已规范化的状态。
 */
export function shouldSubscribeDeviceStatus(input: {
  backendEnabled: boolean
  connection: ConnectionStatus
  canSubscribeStatus: boolean
  section: WorkbenchSection
}): boolean {
  return input.backendEnabled &&
    input.connection === 'connected' &&
    input.canSubscribeStatus &&
    input.section === 'device'
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
