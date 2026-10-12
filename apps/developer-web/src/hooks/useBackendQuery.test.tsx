import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBackendQuery } from './useBackendQuery'
import { BackendProvider } from '../app/BackendProvider'
import { createRuntimeEventsStub } from '../../test/runtimeEventsStub'

const runtimeEvents = createRuntimeEventsStub()
const backend = { dispose: vi.fn(), core: { workflowRuntimeEvents: runtimeEvents.port } }
vi.mock('../app/backend', () => ({ createStudioBackend: () => backend }))

describe('useBackendQuery', () => {
  it('loads data, reports success and reloads by key', async () => {
    const loader = vi.fn(async () => 'value')
    const { result } = renderHook(() => useBackendQuery('one', loader), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('value')
    expect(result.current.error).toBeUndefined()
    act(() => result.current.reload())
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
  })

  it('normalizes Error and non Error failures', async () => {
    const { result: errorResult } = renderHook(
      () =>
        useBackendQuery('error', async () => {
          throw new Error('失败')
        }),
      { wrapper: BackendProvider },
    )
    await waitFor(() => expect(errorResult.current.loading).toBe(false))
    expect(errorResult.current.error?.message).toBe('失败')
    const { result: valueResult } = renderHook(
      () =>
        useBackendQuery('value', async () => {
          throw 'bad'
        }),
      { wrapper: BackendProvider },
    )
    await waitFor(() => expect(valueResult.current.loading).toBe(false))
    expect(valueResult.current.error?.message).toBe('请求失败')
  })

  it('ignores an older generation after the query key changes', async () => {
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve
    })
    const loader = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const { result, rerender } = renderHook(({ key }) => useBackendQuery(key, loader), {
      initialProps: { key: 'first' },
      wrapper: BackendProvider,
    })

    rerender({ key: 'second' })
    resolveSecond('new value')
    await waitFor(() => expect(result.current.data).toBe('new value'))
    resolveFirst('stale value')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.data).toBe('new value')
    expect(result.current.error).toBeUndefined()
  })

  it('re-reads the authoritative projection on runtime invalidation when live', async () => {
    const loader = vi.fn(async () => 'value')
    const { result } = renderHook(() => useBackendQuery('live', loader, { live: true }), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(result.current.data).toBe('value'))
    expect(loader).toHaveBeenCalledTimes(1)

    act(() => runtimeEvents.emit('task-1'))
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
  })

  it('keeps the previous data visible while a live re-read is in flight', async () => {
    let resolveSecond!: (value: string) => void
    const loader = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        }),
      )
    const { result } = renderHook(() => useBackendQuery('live', loader, { live: true }), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(result.current.data).toBe('first'))

    act(() => runtimeEvents.emit('task-1'))
    // 后台失效重读不能把已有数据打回骨架屏。
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBe('first')

    resolveSecond('second')
    await waitFor(() => expect(result.current.data).toBe('second'))
    expect(result.current.loading).toBe(false)
  })

  it('coalesces a burst of invalidations instead of reading once per event', async () => {
    const loader = vi.fn(async () => 'value')
    const { result } = renderHook(() => useBackendQuery('burst', loader, { live: true }), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(result.current.data).toBe('value'))
    expect(loader).toHaveBeenCalledTimes(1)

    act(() => {
      for (let index = 0; index < 6; index += 1) runtimeEvents.emit(`task-${index}`)
    })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not follow runtime invalidation without opting in', async () => {
    const loader = vi.fn(async () => 'value')
    const { result } = renderHook(() => useBackendQuery('static', loader), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(result.current.data).toBe('value'))

    act(() => runtimeEvents.emit('task-1'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
