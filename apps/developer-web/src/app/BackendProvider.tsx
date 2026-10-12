import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createStudioBackend } from './backend'
import type { StudioBackend } from './backend'

export type BackendConnection = 'unknown' | 'connected' | 'error'

/**
 * 全局 runtime SSE 只发失效通知。一次运行期间事件密度可以到每秒数条，而任务列表
 * 投影有几百 KB，所以这里按固定窗口节流后统一重读 REST 权威投影，而不是每条事件
 * 各发一次请求。首个事件仍然立即生效，只有连续事件才会被折叠进同一个窗口。
 */
const RUNTIME_INVALIDATION_THROTTLE_MS = 1000

interface BackendContextValue {
  readonly backend: StudioBackend
  readonly connection: BackendConnection
  readonly reportSuccess: () => void
  readonly reportError: (error: unknown) => void
  /**
   * 每次全局 runtime invalidation 后递增。订阅运行时事实的 query 把它放进
   * 重读依赖；它本身不是状态 patch，权威状态仍只来自 REST 投影。
   */
  readonly runtimeRevision: number
}

const BackendContext = createContext<BackendContextValue | null>(null)

export function BackendProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => createStudioBackend(), [])
  useEffect(() => () => backend.dispose(), [backend])
  const [connection, setConnection] = useState<BackendConnection>('unknown')
  const [runtimeRevision, setRuntimeRevision] = useState(0)
  const reportSuccess = useCallback(() => setConnection('connected'), [])
  const reportError = useCallback(() => setConnection('error'), [])

  useEffect(() => {
    const port = backend.core.workflowRuntimeEvents
    if (!port) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastInvalidatedAt = 0
    const invalidate = (): void => {
      const elapsed = Date.now() - lastInvalidatedAt
      if (elapsed >= RUNTIME_INVALIDATION_THROTTLE_MS) {
        lastInvalidatedAt = Date.now()
        setRuntimeRevision((value) => value + 1)
        return
      }
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        lastInvalidatedAt = Date.now()
        setRuntimeRevision((value) => value + 1)
      }, RUNTIME_INVALIDATION_THROTTLE_MS - elapsed)
    }
    const subscription = port.subscribe(invalidate)
    return () => {
      if (timer !== null) clearTimeout(timer)
      subscription.dispose()
    }
  }, [backend])

  const value = useMemo<BackendContextValue>(
    () => ({
      backend,
      connection,
      reportSuccess,
      reportError,
      runtimeRevision,
    }),
    [connection, backend, reportError, reportSuccess, runtimeRevision],
  )
  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}

export function useBackend(): BackendContextValue {
  const context = useContext(BackendContext)
  if (!context) throw new Error('useBackend 必须在 BackendProvider 内使用')
  return context
}
