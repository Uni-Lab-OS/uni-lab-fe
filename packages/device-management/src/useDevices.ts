/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 设备列表数据 hook(仅展示 Edge 上报设备)
 * Context: 设备方向 MVP,处理 loading/error/empty
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Services } from '@unilab/services'
import {
  presentEdgeDevices,
  type ManagedDevice
} from './deviceCatalog'
import type { DeviceManagementConnection } from './types'
import { deviceCatalogRecoveryDelay } from './deviceCatalogRecovery'

const UNKNOWN_RESOLUTION_REFRESH_ATTEMPTS = 12
const UNKNOWN_RESOLUTION_REFRESH_DELAY_MS = 250

interface UseDevicesResult {
  devices: ManagedDevice[]
  loading: boolean
  error: string | null
  lastUpdated: number | null
  refresh: () => Promise<ManagedDevice[]>
}

/**
 * 补读设备目录，直到指定设备完成物理结算（PhysicalSettlement）并恢复派发。
 *
 * @param deviceKey 当前 Edge 注册的本地设备身份。
 * @param refresh 返回同一次权威设备快照的目录刷新函数。
 * @returns 在限定补读窗口内观察到设备可派发时返回 true，否则返回 false。
 * @throws 目录读取失败时保留原始异常，由操作入口展示真实错误。
 */
export async function waitForDeviceDispatchable(
  deviceKey: string,
  refresh: () => Promise<readonly Pick<ManagedDevice, 'deviceKey' | 'dispatchable'>[]>
): Promise<boolean> {
  for (let attempt = 0; attempt < UNKNOWN_RESOLUTION_REFRESH_ATTEMPTS; attempt += 1) {
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, UNKNOWN_RESOLUTION_REFRESH_DELAY_MS))
    if ((await refresh()).some(
      (device) => device.deviceKey === deviceKey && device.dispatchable
    )) return true
  }
  return false
}

export function useDevices({
  services,
  backendEnabled,
  connection
}: {
  services: Services
  backendEnabled: boolean
  connection: DeviceManagementConnection
}): UseDevicesResult {
  const client = services.laboratory
  const canListActions = services.capabilities.devices.listActions
  const isOnline = backendEnabled && connection === 'connected'
  const [devices, setDevices] = useState<ManagedDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const recoveryAttemptRef = useRef(0)

  /**
   * 重新读取设备目录，并把同一权威快照返回给状态收敛检查。
   *
   * @param signal 可选的页面生命周期取消信号。
   * @returns 当前 Edge 设备目录；读取失败或取消时返回空目录并更新页面错误状态。
   */
  const refresh = useCallback(async (
    signal?: AbortSignal
  ): Promise<ManagedDevice[]> => {
    if (!backendEnabled) {
      setDevices([])
      setError(null)
      setLastUpdated(null)
      return []
    }
    if (!canListActions) {
      setDevices([])
      setError(
        services.getCapabilityStatus('devices.listActions').reason
          ?? '当前服务不支持 Action 目录'
      )
      setLastUpdated(null)
      return []
    }
    setLoading(true)
    setError(null)
    try {
      const list = await client.getOnlineDevices(signal)
      if (signal?.aborted) return []
      const presented = presentEdgeDevices(list)
      setDevices(presented)
      setLastUpdated(Date.now())
      return presented
    } catch (err) {
      if (signal?.aborted) return []
      setError(err instanceof Error ? err.message : '获取设备列表失败')
      setDevices([])
      return []
    } finally {
      setLoading(false)
    }
  }, [backendEnabled, canListActions, client, services])

  // Edge 连通后只读取一次完整设备目录。动作运行状态由当前 active 动作节点的
  // Task recovery 单独补读，避免定时请求 /devices 时轮询所有设备的动作节点。
  useEffect(() => {
    if (!isOnline) {
      if (connection === 'error' || connection === 'disconnected') {
        setDevices([])
        setLastUpdated(null)
      }
      return
    }
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => {
      controller.abort()
    }
  }, [connection, isOnline, refresh])

  // Workspace Backend may become ready before its Edge has registered device
  // bindings. Recover that bounded startup window automatically; once any
  // device is dispatchable, avoid polling the full device/action catalog.
  useEffect(() => {
    const delay = deviceCatalogRecoveryDelay({
      attempt: recoveryAttemptRef.current,
      backendEnabled,
      connection,
      lastUpdated,
      devices
    })
    if (delay === null) {
      if (!isOnline || devices.some(device => device.online)) {
        recoveryAttemptRef.current = 0
      }
      return
    }
    const timer = globalThis.setTimeout(() => {
      recoveryAttemptRef.current += 1
      void refresh()
    }, delay)
    return () => globalThis.clearTimeout(timer)
  }, [backendEnabled, connection, devices, isOnline, lastUpdated, refresh])

  return { devices, loading, error, lastUpdated, refresh }
}
