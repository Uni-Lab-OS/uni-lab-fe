import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendProvider'

export interface BackendQueryState<Value> {
  readonly data: Value | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  readonly reload: () => void
}

export interface BackendQueryOptions {
  /**
   * 跟随全局 runtime invalidation 重读。事件只表示“需要重读”，
   * 不携带状态，也不允许用来做乐观 patch。
   */
  readonly live?: boolean
}

/** 轻量 query 边界：负责请求代际、错误呈现和重新加载，不复制领域状态机。 */
export function useBackendQuery<Value>(
  key: string,
  loader: (backend: ReturnType<typeof useBackend>['backend']) => Promise<Value>,
  options: BackendQueryOptions = {},
): BackendQueryState<Value> {
  const { backend, reportSuccess, reportError, runtimeRevision } = useBackend()
  const [state, setState] = useState<Omit<BackendQueryState<Value>, 'reload'>>({
    loading: true,
    data: undefined,
    error: undefined,
  })
  const [revision, setRevision] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  // 失效重读沿用同一代请求；只有还没有数据时才回到骨架屏，
  // 避免运行期间持续刷新导致整页闪烁。
  const liveRevision = options.live ? runtimeRevision : 0

  useEffect(() => {
    let active = true
    setState((current) => ({
      ...current,
      loading: current.data === undefined,
      error: undefined,
    }))
    void loaderRef
      .current(backend)
      .then((data) => {
        if (!active) return
        reportSuccess()
        setState({ data, loading: false, error: undefined })
      })
      .catch((cause: unknown) => {
        if (!active) return
        const error = cause instanceof Error ? cause : new Error('请求失败')
        reportError(error)
        setState({ data: undefined, loading: false, error })
      })
    return () => {
      active = false
    }
  }, [backend, key, reportError, reportSuccess, revision, liveRevision])

  return { ...state, reload }
}
