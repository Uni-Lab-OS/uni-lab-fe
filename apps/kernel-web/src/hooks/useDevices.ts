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
import { useCallback, useEffect, useState } from 'react'
import { useServices } from '@unilab/services'
import { useWorkbench } from '../context/WorkbenchContext'
import {
  presentEdgeDevices,
  type ManagedDevice
} from '../data/deviceCatalog'

interface UseDevicesResult {
  devices: ManagedDevice[]
  loading: boolean
  error: string | null
  lastUpdated: number | null
  refresh: () => Promise<void>
}

export function useDevices(): UseDevicesResult {
  const { backendEnabled, connection } = useWorkbench()
  const services = useServices()
  const client = services.laboratory
  const canListActions = services.capabilities.devices.listActions
  const isOnline = backendEnabled && connection === 'connected'
  const [devices, setDevices] = useState<ManagedDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
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
      const list = await client.getOnlineDevices(signal)
      if (signal?.aborted) return
      setDevices(presentEdgeDevices(list))
      setLastUpdated(Date.now())
    } catch (err) {
      if (signal?.aborted) return
      setError(err instanceof Error ? err.message : '获取设备列表失败')
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [backendEnabled, canListActions, client, services])

  // Edge 连通后立即刷新，并低频同步设备上线与动作忙闲变化。
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
    const timer = globalThis.setInterval(() => {
      void refresh(controller.signal)
    }, 5_000)
    return () => {
      controller.abort()
      globalThis.clearInterval(timer)
    }
  }, [connection, isOnline, refresh])

  return { devices, loading, error, lastUpdated, refresh }
}
