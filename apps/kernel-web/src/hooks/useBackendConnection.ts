/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 后端连接管理 hook(健康探测 + REST 客户端实例)
 * Context: 在线模式下探测 Uni-Lab-OS 连通性并更新全局连接状态
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useCallback, useEffect, useRef } from 'react'
import { useServices, type LaboratoryService } from '@unilab/services'
import { useWorkbench } from '../context/WorkbenchContext'

const HEALTH_CHECK_INTERVAL_MS = 3_000

interface UseBackendConnectionResult {
  client: LaboratoryService
  isOnline: boolean
  reconnect: () => Promise<void>
  disconnect: () => void
}

// 管理后端连接:根据 baseUrl 创建客户端,在线模式下自动探测连通性
export function useBackendConnection(): UseBackendConnectionResult {
  const { backendEnabled, connection, setConnection } = useWorkbench()
  const client = useServices().laboratory
  const reconnectControllerRef = useRef<AbortController | null>(null)
  const stopProbeRef = useRef<(() => void) | null>(null)

  const reconnect = useCallback(async () => {
    reconnectControllerRef.current?.abort()
    const controller = new AbortController()
    reconnectControllerRef.current = controller
    setConnection('connecting')
    const ok = await client.ping(controller.signal)
    if (!controller.signal.aborted) {
      setConnection(ok ? 'connected' : 'error')
    }
    if (reconnectControllerRef.current === controller) {
      reconnectControllerRef.current = null
    }
  }, [client, setConnection])

  const disconnect = useCallback(() => {
    reconnectControllerRef.current?.abort()
    reconnectControllerRef.current = null
    stopProbeRef.current?.()
    setConnection('disconnected')
  }, [setConnection])

  // 保持健康探测，避免 Edge 断开后界面仍停留在已连接状态。
  useEffect(() => {
    if (!backendEnabled) return
    const controller = new AbortController()
    let cancelled = false
    let hasConnected = false
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null

    const scheduleNextProbe = (): void => {
      if (cancelled || controller.signal.aborted) return
      timer = globalThis.setTimeout(() => {
        void probe()
      }, HEALTH_CHECK_INTERVAL_MS)
    }

    const probe = async (): Promise<void> => {
      const ok = await client.ping(controller.signal)
      if (cancelled || controller.signal.aborted) return
      if (ok) {
        hasConnected = true
        setConnection('connected')
      } else {
        setConnection(hasConnected ? 'disconnected' : 'error')
      }
      scheduleNextProbe()
    }

    const stopProbe = (): void => {
      cancelled = true
      controller.abort()
      if (timer != null) globalThis.clearTimeout(timer)
    }
    stopProbeRef.current = stopProbe
    setConnection('connecting')
    void probe()
    return () => {
      stopProbe()
      if (stopProbeRef.current === stopProbe) stopProbeRef.current = null
    }
  }, [backendEnabled, client, setConnection])

  return {
    client,
    isOnline: backendEnabled && connection === 'connected',
    reconnect,
    disconnect
  }
}
