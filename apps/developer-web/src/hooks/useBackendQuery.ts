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

/** 查询身份。换 backend 或换 key 就是换了一份投影，不是同一次重读。 */
interface QueryScope {
  readonly backend: unknown
  readonly key: string
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

  // 同一查询身份内最多只有一个请求在飞：飞行中到达的失效重读或手动刷新只标脏，
  // 等本次落地后再补读一次。没有这层保护时，只要接口耗时超过失效节流窗口
  // （BackendProvider 的 1s），每个窗口都会发一个新请求并丢弃上一个未完成的响应，
  // 页面就会一直停在加载态，请求也会随延迟成倍堆叠。
  const scopeRef = useRef<QueryScope | null>(null)
  const epochRef = useRef(0)
  const inFlightRef = useRef(false)
  const dirtyRef = useRef(false)
  const requestRef = useRef<() => void>(() => undefined)

  const request = useCallback(() => {
    if (inFlightRef.current) {
      dirtyRef.current = true
      return
    }
    inFlightRef.current = true
    // 每次换身份都会抬高 epoch，让上一个身份的响应整体作废。
    const epoch = epochRef.current
    setState((current) => ({
      ...current,
      loading: current.data === undefined,
      error: undefined,
    }))
    void loaderRef
      .current(backend)
      .then((data) => {
        if (epoch !== epochRef.current) return
        reportSuccess()
        setState({ data, loading: false, error: undefined })
      })
      .catch((cause: unknown) => {
        if (epoch !== epochRef.current) return
        const error = cause instanceof Error ? cause : new Error('请求失败')
        reportError(error)
        // 失败不清空上一份权威投影：列表保留可读内容，下一次成功重读再覆盖。
        setState((current) => ({ data: current.data, loading: false, error }))
      })
      .finally(() => {
        if (epoch !== epochRef.current) return
        inFlightRef.current = false
        if (!dirtyRef.current) return
        dirtyRef.current = false
        requestRef.current()
      })
  }, [backend, reportError, reportSuccess])
  requestRef.current = request

  useEffect(() => {
    const scope = scopeRef.current
    if (scope === null || scope.backend !== backend || scope.key !== key) {
      const firstMount = scope === null
      scopeRef.current = { backend, key }
      epochRef.current += 1
      inFlightRef.current = false
      dirtyRef.current = false
      // 新身份还没有任何投影可用：回到骨架屏，而不是把上一个身份的数据
      // 挂在新身份的分页/筛选下展示。首次挂载的初始 state 已经是这个状态。
      if (!firstMount) setState({ data: undefined, loading: true, error: undefined })
    }
    request()
  }, [backend, key, request, revision, liveRevision])

  // 卸载后不再接受任何在飞响应，也不再补读。挂载期内的严格模式重跑由上面
  // 那个 effect 重新发一次请求覆盖，不会丢数据。
  useEffect(
    () => () => {
      epochRef.current += 1
      inFlightRef.current = false
      dirtyRef.current = false
    },
    [],
  )

  return { ...state, reload }
}
