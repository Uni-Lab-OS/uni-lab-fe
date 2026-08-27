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

interface UseDevicesResult {
  devices: ManagedDevice[]
  loading: boolean
  error: string | null
  lastUpdated: number | null
  refresh: () => Promise<void>
}

export function useDevices({
  services,
  backendEnabled,
  connection,
  active = true
}: {
  services: Services
  backendEnabled: boolean
  connection: DeviceManagementConnection
  active?: boolean
}): UseDevicesResult {
  const client = services.laboratory
  const canListActions = services.capabilities.devices.listActions
  const isOnline = active && backendEnabled && connection === 'connected'
  const [devices, setDevices] = useState<ManagedDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const recoveryAttemptRef = useRef(0)

  const refresh = useCallback(async (
    signal?: AbortSignal,
    includeActionStatuses = true
  ) => {
    if (!active) return
    if (!backendEnabled) {
      setDevices([])
      setError(null)
      setLastUpdated(null)
      return
    }
    if (!canListActions) {
      setDevices([])
      setError(
        services.getCapabilityStatus('devices.listActions').reason
          ?? '当前服务不支持 Action 目录'
      )
      setLastUpdated(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      let list = await client.getOnlineDevices(signal, {
        includeActionStatuses
      })
      if (signal?.aborted) return
      const lightweightDevices = presentEdgeDevices(list)
      if (
        !includeActionStatuses &&
        lightweightDevices.some((device) => device.online)
      ) {
        // 轻量恢复发现设备上线后只做一次完整补读，恢复可靠的动作占用事实。
        list = await client.getOnlineDevices(signal)
        if (signal?.aborted) return
      }
      setDevices(presentEdgeDevices(list))
      setLastUpdated(Date.now())
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : '获取设备列表失败')
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [active, backendEnabled, canListActions, client, services])

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
      void refresh(undefined, false)
    }, delay)
    return () => globalThis.clearTimeout(timer)
  }, [backendEnabled, connection, devices, isOnline, lastUpdated, refresh])

  return { devices, loading, error, lastUpdated, refresh }
}
