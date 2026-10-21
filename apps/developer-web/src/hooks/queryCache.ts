import type { WorkflowRuntimeEventsPort } from '@unilab-fe/core'

/**
 * 页面查询的会话缓存，按后端实例隔离。一个后端实例只绑定一个 profile 与一个端点
 * （切换 Profile 或地址会重建实例），所以缓存不会把上一个端点的数据带到新端点。
 *
 * 新鲜期内切回页面直接显示缓存、不重复读取；新鲜期外先显示缓存再后台刷新
 * （stale-while-revalidate）。声明 invalidateOnRuntimeEvents 的查询在任务运行失效通知
 * （全局 SSE）到达后立即过期——即使当时没有页面挂载。缓存只保存 OS 读到的投影，
 * 从不推断或改写运行状态。
 */
export interface QueryFreshness {
  /** 新鲜期（毫秒）；0 或缺省表示每次挂载都在后台刷新。 */
  readonly staleTimeMs?: number
  /** 任务/设备动作运行失效通知、SSE 重连或断开时立即过期。 */
  readonly invalidateOnRuntimeEvents?: boolean
  /**
   * 失效通知驱动的后台刷新（refreshQuery）对同一 key 的最小间隔（毫秒，按请求发出时刻计），
   * 跨页面共用；也不与在途请求并发。间隔内到达的通知合并为间隔结束后的一次读取。
   * 显式刷新（刷新按钮、后端就绪）不受此限制。
   */
  readonly minRefreshGapMs?: number
}

export interface CachedQuery<Value> {
  readonly value: Value
  readonly fetchedAt: number
  /** 发出请求时的失效纪元；此后到达的运行失效通知会让该结果过期。 */
  readonly epoch: number
  /** 之后的刷新失败：继续展示，但下次挂载必须重新读取。 */
  readonly stale: boolean
}

interface StoredQuery extends CachedQuery<unknown> {
  readonly sequence: number
}

interface BackendQueries {
  readonly entries: Map<string, StoredQuery>
  readonly inflight: Map<string, { readonly promise: Promise<unknown>; readonly sequence: number }>
  /** 每个 key 最近一次发出请求的时刻（毫秒），供 refreshQuery 计算最小间隔。 */
  readonly startedAt: Map<string, number>
  /** 已排定、尚未发出的后台刷新；期间到达的通知复用它。 */
  readonly scheduled: Map<string, Promise<unknown>>
  sequence: number
  epoch: number
  watching: boolean
}

interface CacheBackend {
  readonly core?: { readonly workflowRuntimeEvents?: WorkflowRuntimeEventsPort }
}

const registry = new WeakMap<object, BackendQueries>()

function queriesFor(backend: object): BackendQueries {
  let queries = registry.get(backend)
  if (!queries) {
    queries = {
      entries: new Map(),
      inflight: new Map(),
      startedAt: new Map(),
      scheduled: new Map(),
      sequence: 0,
      epoch: 0,
      watching: false,
    }
    registry.set(backend, queries)
  }
  return queries
}

export function peekQuery<Value>(backend: object, key: string): CachedQuery<Value> | undefined {
  return queriesFor(backend).entries.get(key) as CachedQuery<Value> | undefined
}

export function isQueryFresh(
  backend: object,
  entry: CachedQuery<unknown>,
  freshness: QueryFreshness,
  now = Date.now(),
): boolean {
  const staleTimeMs = freshness.staleTimeMs ?? 0
  if (entry.stale || staleTimeMs <= 0 || now - entry.fetchedAt >= staleTimeMs) return false
  return !freshness.invalidateOnRuntimeEvents || entry.epoch === queriesFor(backend).epoch
}

/**
 * 读取并写入缓存。reuseInflight 时复用同一 key 的在途请求（页面来回切换不叠加请求）；
 * 显式重读（刷新、失效通知、后端就绪）不复用早于本次调用发出的请求。
 * 晚到的旧响应不会覆盖更新的结果；失败时保留旧值但标为过期。
 */
export function fetchQuery<Value>(
  backend: object,
  key: string,
  loader: () => Promise<Value>,
  { reuseInflight }: { readonly reuseInflight: boolean },
): Promise<Value> {
  const queries = queriesFor(backend)
  const pending = queries.inflight.get(key)
  if (reuseInflight && pending) return pending.promise as Promise<Value>
  const sequence = ++queries.sequence
  const epoch = queries.epoch
  queries.startedAt.set(key, Date.now())
  const newerThanStored = () => (queries.entries.get(key)?.sequence ?? 0) < sequence
  const promise = loader()
    .then(
      (value) => {
        if (newerThanStored()) {
          queries.entries.set(key, { value, fetchedAt: Date.now(), epoch, stale: false, sequence })
        }
        return value
      },
      (error: unknown) => {
        const current = queries.entries.get(key)
        if (current && newerThanStored()) queries.entries.set(key, { ...current, stale: true })
        throw error
      },
    )
    .finally(() => {
      if (queries.inflight.get(key)?.sequence === sequence) queries.inflight.delete(key)
    })
  queries.inflight.set(key, { promise, sequence })
  return promise
}

/** 新鲜缓存直接返回，否则读取；force 表示显式重读。 */
export function readQuery<Value>(
  backend: object,
  key: string,
  loader: () => Promise<Value>,
  { force, freshness }: { readonly force: boolean; readonly freshness: QueryFreshness },
): Promise<Value> {
  if (freshness.invalidateOnRuntimeEvents) watchRuntimeInvalidation(backend)
  const cached = peekQuery<Value>(backend, key)
  if (!force && cached && isQueryFresh(backend, cached, freshness)) {
    return Promise.resolve(cached.value)
  }
  return fetchQuery(backend, key, loader, { reuseInflight: !force })
}

/**
 * 失效通知驱动的后台刷新：同一 key 两次请求至少间隔 minRefreshGapMs（跨页面共用），
 * 且不与在途请求并发；等待期间到达的通知合并为一次读取。若等待期间已有更晚发出的请求
 * （如手动刷新）成功，直接使用其结果，不再重复读取。显式重读请用 readQuery({ force: true })。
 */
export function refreshQuery<Value>(
  backend: object,
  key: string,
  loader: () => Promise<Value>,
  freshness: QueryFreshness,
): Promise<Value> {
  if (freshness.invalidateOnRuntimeEvents) watchRuntimeInvalidation(backend)
  const queries = queriesFor(backend)
  const scheduled = queries.scheduled.get(key)
  // 已排定的读取尚未发出，发出时自然包含这次通知。
  if (scheduled) return scheduled as Promise<Value>
  const gapMs = Math.max(0, freshness.minRefreshGapMs ?? 0)
  const requestedAfter = queries.sequence
  const delay = () => (queries.startedAt.get(key) ?? -Infinity) + gapMs - Date.now()
  if (!queries.inflight.has(key) && delay() <= 0) {
    return fetchQuery(backend, key, loader, { reuseInflight: false })
  }
  const promise = (async () => {
    try {
      for (;;) {
        const stored = queries.entries.get(key)
        if (stored && !stored.stale && stored.sequence > requestedAfter)
          return stored.value as Value
        const inflight = queries.inflight.get(key)
        if (inflight) {
          // 在途请求可能早于这次通知发出：等它结束后再按间隔决定是否重读。
          await inflight.promise.catch(() => undefined)
          continue
        }
        const wait = delay()
        if (wait <= 0) break
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
    } finally {
      queries.scheduled.delete(key)
    }
    return fetchQuery(backend, key, loader, { reuseInflight: false })
  })()
  queries.scheduled.set(key, promise)
  return promise
}

/**
 * 为该后端常驻订阅一次运行失效通知，只推进失效纪元（不读取、不改写任何数据）。
 * 连接建立、重连与断开时也推进：期间可能漏掉通知，缓存一律视为过期。
 */
export function watchRuntimeInvalidation(backend: object): void {
  const queries = queriesFor(backend)
  if (queries.watching) return
  const events = (backend as CacheBackend).core?.workflowRuntimeEvents
  if (!events) return
  queries.watching = true
  const invalidate = () => {
    queries.epoch += 1
  }
  events.subscribe(
    (event) => {
      if (event.event !== 'station.error_handling.changed') invalidate()
    },
    { onOpen: invalidate, onError: invalidate },
  )
}
