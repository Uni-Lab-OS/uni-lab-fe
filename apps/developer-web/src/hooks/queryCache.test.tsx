import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { WorkflowRuntimeInvalidation } from '@unilab-fe/core'
import { fetchQuery, isQueryFresh, peekQuery, readQuery, refreshQuery } from './queryCache'
import { useBackendQuery } from './useBackendQuery'

type Listener = (event: WorkflowRuntimeInvalidation) => void
type OpenListener = (state: { lastEventId: string; reconnected: boolean }) => void

// 替身须引用稳定：useBackendQuery 的副作用依赖 backend 与 report*。每个用例换一个后端实例，
// 同时验证缓存按后端实例（profile + 端点）隔离。
const { holder, connection } = vi.hoisted(() => ({
  connection: { readyEpoch: 0, reportSuccess: () => undefined, reportError: () => undefined },
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
vi.mock('../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current, ...connection }),
}))

function makeBackend() {
  const listeners = new Set<Listener>()
  const opens = new Set<OpenListener>()
  return {
    listeners,
    emit(event: WorkflowRuntimeInvalidation['event'] = 'workflow.runtime.changed') {
      for (const listener of listeners)
        listener({ id: String(Math.random()), event, workflowTaskUuid: 'task-1', raw: {} })
    },
    open(reconnected = false) {
      for (const listener of opens) listener({ lastEventId: '', reconnected })
    },
    core: {
      workflowRuntimeEvents: {
        subscribe: vi.fn(
          (listener: Listener, options?: { onOpen?: OpenListener; onError?: () => void }) => {
            listeners.add(listener)
            if (options?.onOpen) opens.add(options.onOpen)
            return { dispose: () => listeners.delete(listener) }
          },
        ),
      },
    },
  }
}

const FRESH = { staleTimeMs: 30_000, invalidateOnRuntimeEvents: true } as const

beforeEach(() => {
  holder.current = makeBackend()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useBackendQuery freshness window', () => {
  it('shows a fresh cache immediately on remount without refetching', async () => {
    const loader = vi.fn(async () => ['task-1'])
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(first.result.current.data).toEqual(['task-1']))
    first.unmount()

    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    expect(second.result.current).toMatchObject({ loading: false, data: ['task-1'] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('refreshes in the background once the window has passed', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(first.result.current.data).toBe('v1'))
    first.unmount()

    now.mockReturnValue(1_000 + 30_000)
    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    expect(second.result.current).toMatchObject({ loading: false, data: 'v1' })
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
    expect(loader).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('expires the cache on a task invalidation that arrives while no page is mounted', async () => {
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(first.result.current.data).toBe('v1'))
    first.unmount()

    // 工站错误处置通知与任务无关，不使任务列表过期；任务失效通知才会。
    holder.current.emit('station.error_handling.changed')
    const unaffected = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loader).toHaveBeenCalledTimes(1)
    unaffected.unmount()

    holder.current.emit()
    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    expect(second.result.current.data).toBe('v1')
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
    expect(holder.current.core.workflowRuntimeEvents.subscribe).toHaveBeenCalledTimes(1)
  })

  it('treats an SSE (re)connection as a possible gap and refetches next time', async () => {
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(first.result.current.data).toBe('v1'))
    first.unmount()
    holder.current.open(true)
    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
  })

  it('reuses the in-flight request when switching back before it finishes', async () => {
    let resolve!: (value: string) => void
    const loader = vi.fn(() => new Promise<string>((done) => (resolve = done)))
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    first.unmount()
    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    expect(loader).toHaveBeenCalledTimes(1)
    resolve('v1')
    await waitFor(() => expect(second.result.current.data).toBe('v1'))
  })

  it('always rereads on reload even inside the window', async () => {
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    const { result } = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(result.current.data).toBe('v1'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toBe('v2'))
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not leak another backend instance’s cache', async () => {
    const loader = vi.fn(async () => 'endpoint-a')
    const first = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(first.result.current.data).toBe('endpoint-a'))
    first.unmount()

    holder.current = makeBackend()
    let resolve!: (value: string) => void
    const second = renderHook(() =>
      useBackendQuery('tasks', () => new Promise<string>((done) => (resolve = done)), FRESH),
    )
    expect(second.result.current).toMatchObject({ loading: true, data: undefined })
    resolve('endpoint-b')
    await waitFor(() => expect(second.result.current.data).toBe('endpoint-b'))
  })

  it('keeps showing data after a failed refresh but retries on the next mount', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce('v1')
      .mockRejectedValueOnce(new Error('OS 忙'))
      .mockResolvedValueOnce('v2')
    const { result, unmount } = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(result.current.data).toBe('v1'))
    act(() => result.current.reload())
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current).toMatchObject({ data: 'v1', error: undefined })
    unmount()

    const second = renderHook(() => useBackendQuery('tasks', loader, FRESH))
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
  })
})

describe('queryCache', () => {
  it('ignores a late response that is older than the stored one', async () => {
    const backend = {}
    let resolveOld!: (value: string) => void
    const old = fetchQuery(backend, 'k', () => new Promise<string>((done) => (resolveOld = done)), {
      reuseInflight: false,
    })
    await fetchQuery(backend, 'k', async () => 'new', { reuseInflight: false })
    resolveOld('old')
    await old
    expect(peekQuery(backend, 'k')?.value).toBe('new')
  })

  it('serves fresh entries from readQuery and rereads when forced', async () => {
    const backend = {}
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    const freshness = { staleTimeMs: 10_000 }
    expect(await readQuery(backend, 'k', loader, { force: false, freshness })).toBe(1)
    expect(await readQuery(backend, 'k', loader, { force: false, freshness })).toBe(1)
    expect(await readQuery(backend, 'k', loader, { force: true, freshness })).toBe(2)
    const entry = peekQuery(backend, 'k')!
    expect(isQueryFresh(backend, entry, freshness, entry.fetchedAt + 9_999)).toBe(true)
    expect(isQueryFresh(backend, entry, freshness, entry.fetchedAt + 10_000)).toBe(false)
    expect(isQueryFresh(backend, entry, {}, entry.fetchedAt)).toBe(false)
  })
})

describe('invalidation-driven refresh gap', () => {
  const GAP = { staleTimeMs: 30_000, minRefreshGapMs: 2_000 } as const

  it('rereads at most once per gap per key and merges notifications that arrive meanwhile', async () => {
    vi.useFakeTimers()
    const backend = {}
    let version = 0
    const loader = vi.fn(async () => ++version)
    expect(await refreshQuery(backend, 'k', loader, GAP)).toBe(1)
    // 1 秒内连续三条通知：都等到间隔结束后合并为一次读取。
    const merged = [
      refreshQuery(backend, 'k', loader, GAP),
      refreshQuery(backend, 'k', loader, GAP),
      refreshQuery(backend, 'k', loader, GAP),
    ]
    await vi.advanceTimersByTimeAsync(1_000)
    expect(loader).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await Promise.all(merged)).toEqual([2, 2, 2])
    expect(loader).toHaveBeenCalledTimes(2)
    // 间隔已过：下一次通知立即读取。
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await refreshQuery(backend, 'k', loader, GAP)).toBe(3)
    // 间隔按 key 计算：其他列表不受影响。
    expect(await refreshQuery(backend, 'other', loader, GAP)).toBe(4)
  })

  it('never overlaps an in-flight request, even when the response is slower than the gap', async () => {
    vi.useFakeTimers()
    const backend = {}
    const resolvers: Array<(value: string) => void> = []
    const loader = vi.fn(() => new Promise<string>((done) => resolvers.push(done)))
    const first = refreshQuery(backend, 'k', loader, GAP)
    const second = refreshQuery(backend, 'k', loader, GAP)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(loader).toHaveBeenCalledTimes(1)
    resolvers[0]!('slow')
    expect(await first).toBe('slow')
    await vi.advanceTimersByTimeAsync(0)
    // 慢响应结束后（已超过间隔）补读一次，覆盖期间到达的通知。
    expect(loader).toHaveBeenCalledTimes(2)
    resolvers[1]!('fresh')
    expect(await second).toBe('fresh')
  })

  it('does not delay an explicit refresh and reuses its result for a pending notification', async () => {
    vi.useFakeTimers()
    const backend = {}
    const loader = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2')
    await refreshQuery(backend, 'k', loader, GAP)
    const pending = refreshQuery(backend, 'k', loader, GAP)
    // 手动刷新立即读取，不等最小间隔。
    expect(await readQuery(backend, 'k', loader, { force: true, freshness: GAP })).toBe('v2')
    expect(loader).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2_000)
    // 手动刷新晚于通知发出且已成功，排定的后台刷新直接用它的结果。
    expect(await pending).toBe('v2')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('useBackendQuery.refresh honours the gap while reload stays immediate', async () => {
    vi.useFakeTimers()
    let version = 0
    const loader = vi.fn(async () => `v${++version}`)
    const { result } = renderHook(() => useBackendQuery('tasks', loader, GAP))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(result.current.data).toBe('v1')

    let refreshed: Promise<void> | undefined
    act(() => {
      refreshed = result.current.refresh()
    })
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(loader).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
      await refreshed
    })
    expect(loader).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe('v2')

    // 刷新按钮：间隔内也立即重读。
    act(() => result.current.reload())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(loader).toHaveBeenCalledTimes(3)
    expect(result.current.data).toBe('v3')
  })
})
