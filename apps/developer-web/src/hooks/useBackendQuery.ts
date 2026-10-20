import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendProvider'
import {
  fetchQuery,
  isQueryFresh,
  peekQuery,
  watchRuntimeInvalidation,
  type QueryFreshness,
} from './queryCache'

export interface BackendQueryState<Value> {
  readonly data: Value | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  readonly reload: () => void
}

type Backend = ReturnType<typeof useBackend>['backend']

export type BackendQueryOptions = QueryFreshness

/**
 * 轻量 query 边界：负责请求代际、错误呈现和重新加载，不复制领域状态机。
 * 页面切换会卸载并重建查询；按后端实例隔离的会话缓存（见 queryCache）让切回页面时先显示
 * 上次的数据：新鲜期内不再请求，过期则后台刷新（stale-while-revalidate）。
 * reload（刷新按钮、失效通知）与后端就绪总是重新读取。
 */
export function useBackendQuery<Value>(
  key: string,
  loader: (backend: Backend) => Promise<Value>,
  options: BackendQueryOptions = {},
): BackendQueryState<Value> {
  const { backend, reportSuccess, reportError, readyEpoch } = useBackend()
  const [state, setState] = useState<Omit<BackendQueryState<Value>, 'reload'>>(() => {
    const cached = peekQuery<Value>(backend, key)
    return cached
      ? { loading: false, data: cached.value, error: undefined }
      : { loading: true, data: undefined, error: undefined }
  })
  const [revision, setRevision] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const freshnessRef = useRef(options)
  freshnessRef.current = options
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  // 区分“挂载/换 key”（可用新鲜缓存、复用在途请求）与 reload/后端就绪（必须重新读取）。
  const triggerRef = useRef({ revision, readyEpoch })

  useEffect(() => {
    let active = true
    const force =
      triggerRef.current.revision !== revision || triggerRef.current.readyEpoch !== readyEpoch
    triggerRef.current = { revision, readyEpoch }
    const freshness = freshnessRef.current
    if (freshness.invalidateOnRuntimeEvents) watchRuntimeInvalidation(backend)
    const cached = peekQuery<Value>(backend, key)
    if (cached) {
      // 已有缓存：不再出现骨架屏，后台刷新完成后替换。
      setState({ loading: false, data: cached.value, error: undefined })
    } else {
      setState((current) => ({ ...current, loading: true, error: undefined }))
    }
    if (!force && cached && isQueryFresh(backend, cached, freshness)) {
      return () => {
        active = false
      }
    }
    void fetchQuery(backend, key, () => loaderRef.current(backend), { reuseInflight: !force })
      .then((data) => {
        if (!active) return
        reportSuccess()
        setState({ data, loading: false, error: undefined })
      })
      .catch((cause: unknown) => {
        if (!active) return
        const error = cause instanceof Error ? cause : new Error('请求失败')
        reportError(error)
        const previous = peekQuery<Value>(backend, key)
        if (previous) {
          // 后台刷新失败（例如 OS 正忙于校验）时继续显示上次数据，连接状态由全局指示器反映。
          setState({ loading: false, data: previous.value, error: undefined })
          return
        }
        setState({ data: undefined, loading: false, error })
      })
    return () => {
      active = false
    }
    // readyEpoch：后端由启动中转为就绪时自动重新加载，无需用户点“重试”。
  }, [backend, key, readyEpoch, reportError, reportSuccess, revision])

  return { ...state, reload }
}
