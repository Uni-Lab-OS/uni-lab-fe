import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackend } from '../app/BackendProvider'

export interface BackendQueryState<Value> {
  readonly data: Value | undefined
  readonly loading: boolean
  readonly error: Error | undefined
  readonly reload: () => void
}

/** 轻量 query 边界：负责请求代际、错误呈现和重新加载，不复制领域状态机。 */
export function useBackendQuery<Value>(
  key: string,
  loader: (backend: ReturnType<typeof useBackend>['backend']) => Promise<Value>,
): BackendQueryState<Value> {
  const { backend, reportSuccess, reportError } = useBackend()
  const [state, setState] = useState<Omit<BackendQueryState<Value>, 'reload'>>({
    loading: true,
    data: undefined,
    error: undefined,
  })
  const [revision, setRevision] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const reload = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: undefined }))
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
  }, [backend, key, reportError, reportSuccess, revision])

  return { ...state, reload }
}
