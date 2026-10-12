import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendProvider'

export interface BackendQueryState<Value> {
  readonly data: Value | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  readonly reload: () => void
}

type Backend = ReturnType<typeof useBackend>['backend']

/**
 * 页面切换会卸载并重建查询；按后端实例隔离的会话缓存让切回页面时先显示上次的数据，
 * 再在后台刷新（stale-while-revalidate）。后端实例变化（切换 Profile 或地址）后缓存自然失效。
 */
const sessionCache = new WeakMap<object, Map<string, unknown>>()

function cacheFor(backend: Backend): Map<string, unknown> {
  let cache = sessionCache.get(backend as object)
  if (!cache) {
    cache = new Map()
    sessionCache.set(backend as object, cache)
  }
  return cache
}

/** 轻量 query 边界：负责请求代际、错误呈现和重新加载，不复制领域状态机。 */
export function useBackendQuery<Value>(
  key: string,
  loader: (backend: Backend) => Promise<Value>,
): BackendQueryState<Value> {
  const { backend, reportSuccess, reportError } = useBackend()
  const [state, setState] = useState<Omit<BackendQueryState<Value>, 'reload'>>(() => {
    const cache = cacheFor(backend)
    return cache.has(key)
      ? { loading: false, data: cache.get(key) as Value, error: undefined }
      : { loading: true, data: undefined, error: undefined }
  })
  const [revision, setRevision] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true
    const cache = cacheFor(backend)
    if (cache.has(key)) {
      // 已有缓存：不再出现骨架屏，后台刷新完成后替换。
      setState({ loading: false, data: cache.get(key) as Value, error: undefined })
    } else {
      setState((current) => ({ ...current, loading: true, error: undefined }))
    }
    void loaderRef
      .current(backend)
      .then((data) => {
        cache.set(key, data)
        if (!active) return
        reportSuccess()
        setState({ data, loading: false, error: undefined })
      })
      .catch((cause: unknown) => {
        if (!active) return
        const error = cause instanceof Error ? cause : new Error('请求失败')
        reportError(error)
        if (cache.has(key)) {
          // 后台刷新失败（例如 OS 正忙于校验）时继续显示上次数据，连接状态由全局指示器反映。
          setState({ loading: false, data: cache.get(key) as Value, error: undefined })
          return
        }
        setState({ data: undefined, loading: false, error })
      })
    return () => {
      active = false
    }
  }, [backend, key, reportError, reportSuccess, revision])

  return { ...state, reload }
}
