import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendProvider'
import {
  fetchQuery,
  isQueryFresh,
  peekQuery,
  refreshQuery,
  watchRuntimeInvalidation,
  type QueryFreshness,
} from './queryCache'

export interface BackendQueryState<Value> {
  readonly data: Value | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  /** 显式重读（刷新按钮、操作完成后）：立即读取，不受最小刷新间隔限制。 */
  readonly reload: () => void
  /**
   * 失效通知驱动的后台刷新：遵守 minRefreshGapMs（同一 key 跨页面共用），不与在途请求并发；
   * 读取结束（成功或失败）后 resolve，供 useRuntimeInvalidation 串行化。
   */
  readonly refresh: () => Promise<void>
}

type Backend = ReturnType<typeof useBackend>['backend']

export type BackendQueryOptions = QueryFreshness

/**
 * 轻量 query 边界：负责请求代际、错误呈现和重新加载，不复制领域状态机。
 * 页面切换会卸载并重建查询；按后端实例隔离的会话缓存（见 queryCache）让切回页面时先显示
 * 上次的数据：新鲜期内不再请求，过期则后台刷新（stale-while-revalidate）。
 * reload（刷新按钮）与后端就绪总是立即重新读取；失效通知用 refresh，按最小间隔合并。
 */
export function useBackendQuery<Value>(
  key: string,
  loader: (backend: Backend) => Promise<Value>,
  options: BackendQueryOptions = {},
): BackendQueryState<Value> {
  const { backend, reportSuccess, reportError, readyEpoch } = useBackend()
  const [state, setState] = useState<Omit<BackendQueryState<Value>, 'reload' | 'refresh'>>(() => {
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
  const keyRef = useRef(key)
  keyRef.current = key
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const requestKey = keyRef.current
    const current = () => mountedRef.current && keyRef.current === requestKey
    try {
      await refreshQuery(
        backend,
        requestKey,
        () => loaderRef.current(backend),
        freshnessRef.current,
      )
      if (!current()) return
      reportSuccess()
      // 以缓存中最新的结果为准：期间若有更晚发出的读取已完成，不用较早的响应覆盖它。
      const latest = peekQuery<Value>(backend, requestKey)
      if (latest) setState({ data: latest.value, loading: false, error: undefined })
    } catch (cause: unknown) {
      if (!current()) return
      const error = cause instanceof Error ? cause : new Error('请求失败')
      reportError(error)
      const previous = peekQuery<Value>(backend, requestKey)
      // 后台刷新失败时继续显示上次数据，连接状态由全局指示器反映。
      setState(
        previous
          ? { loading: false, data: previous.value, error: undefined }
          : { data: undefined, loading: false, error },
      )
    }
  }, [backend, reportError, reportSuccess])
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
        // 以缓存中最新的结果为准（后台刷新可能已带回更晚的数据）。
        const latest = peekQuery<Value>(backend, key)
        setState({ data: latest ? latest.value : data, loading: false, error: undefined })
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

  return { ...state, reload, refresh }
}
