import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isBackendUnavailableError, type RuntimeReadiness } from '@unilab-fe/core'
import { createStudioBackend } from './backend'
import type { StudioBackend } from './backend'

/** starting：后端尚未就绪或不可达（冷启动、未启动、代理连不上），区别于业务错误。 */
export type BackendConnection = 'unknown' | 'connected' | 'starting' | 'error'

const READINESS_POLL_MS = 3_000

interface BackendContextValue {
  readonly backend: StudioBackend
  readonly connection: BackendConnection
  /** 后端启动中时最近一次读取到的阶段与进度；无法读取时为 status=unknown。 */
  readonly startup: RuntimeReadiness | null
  /** 开始等待后端就绪的时刻（毫秒时间戳）；未在等待时为 null。 */
  readonly waitingSince: number | null
  /** 后端由启动中转为就绪时递增，查询据此自动重新加载。 */
  readonly readyEpoch: number
  readonly reportSuccess: () => void
  readonly reportError: (error: unknown) => void
}

const BackendContext = createContext<BackendContextValue | null>(null)

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => createStudioBackend(), [])
  useEffect(() => () => backend.dispose(), [backend])
  const [connection, setConnection] = useState<BackendConnection>('unknown')
  const [startup, setStartup] = useState<RuntimeReadiness | null>(null)
  const [readyEpoch, setReadyEpoch] = useState(0)
  const [polling, setPolling] = useState(false)
  const [waitingSince, setWaitingSince] = useState<number | null>(null)
  const reportSuccess = useCallback(() => {
    setConnection('connected')
    setStartup(null)
  }, [])
  const reportError = useCallback((error: unknown) => {
    if (isBackendUnavailableError(error)) {
      setConnection('starting')
      setPolling(true)
      setWaitingSince((value) => value ?? Date.now())
      return
    }
    setConnection('error')
  }, [])

  // 启动中时轮询 readiness：显示阶段与进度；就绪后通知所有查询重新加载。
  useEffect(() => {
    if (!polling) return
    let active = true
    let timer: number | undefined
    const poll = async () => {
      try {
        const readiness = await backend.core.runtimeReadiness.getReadiness()
        if (!active) return
        if (readiness.status === 'ready') {
          setPolling(false)
          setStartup(null)
          setConnection('connected')
          setWaitingSince(null)
          setReadyEpoch((value) => value + 1)
          return
        }
        setStartup(readiness)
      } catch {
        if (!active) return
        setStartup({ status: 'unknown', label: '等待 OS 服务响应' })
      }
      timer = window.setTimeout(() => void poll(), READINESS_POLL_MS)
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [backend, polling])

  const value = useMemo<BackendContextValue>(
    () => ({ backend, connection, startup, waitingSince, readyEpoch, reportSuccess, reportError }),
    [connection, backend, startup, waitingSince, readyEpoch, reportError, reportSuccess],
  )
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}

export function useBackend(): BackendContextValue {
  const context = useContext(BackendContext)
  if (!context) throw new Error('useBackend 必须在 BackendProvider 内使用')
  return context
}

/** 供通用展示组件读取启动状态；不在 BackendProvider 内时返回 null。 */
export function useOptionalBackend(): BackendContextValue | null {
  return useContext(BackendContext)
}
