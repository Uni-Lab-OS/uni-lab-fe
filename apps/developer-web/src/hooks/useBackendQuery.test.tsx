import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBackendQuery } from './useBackendQuery'
import { BackendProvider } from '../app/BackendProvider'

const backend = { dispose: vi.fn() }
vi.mock('../app/backend', () => ({ createStudioBackend: () => backend }))

describe('useBackendQuery', () => {
  it('loads data, reports success and reloads by key', async () => {
    const loader = vi.fn(async () => 'value')
    const { result } = renderHook(() => useBackendQuery('one', loader), { wrapper: BackendProvider })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('value')
    expect(result.current.error).toBeUndefined()
    act(() => result.current.reload())
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
  })

  it('normalizes Error and non Error failures', async () => {
    const { result: errorResult } = renderHook(() => useBackendQuery('error', async () => { throw new Error('失败') }), { wrapper: BackendProvider })
    await waitFor(() => expect(errorResult.current.loading).toBe(false))
    expect(errorResult.current.error?.message).toBe('失败')
    const { result: valueResult } = renderHook(() => useBackendQuery('value', async () => { throw 'bad' }), { wrapper: BackendProvider })
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
    const loader = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const { result, rerender } = renderHook(
      ({ key }) => useBackendQuery(key, loader),
      { initialProps: { key: 'first' }, wrapper: BackendProvider },
    )

    rerender({ key: 'second' })
    resolveSecond('new value')
    await waitFor(() => expect(result.current.data).toBe('new value'))
    resolveFirst('stale value')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.data).toBe('new value')
    expect(result.current.error).toBeUndefined()
  })
})

describe('useBackendQuery session cache', () => {
  it('切回页面时先显示上次数据，并在后台刷新', async () => {
    const first = renderHook(() => useBackendQuery('cache-swr', async () => 'v1'), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(first.result.current.data).toBe('v1'))
    first.unmount()

    let resolveRefresh!: (value: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const second = renderHook(() => useBackendQuery('cache-swr', () => refresh), {
      wrapper: BackendProvider,
    })

    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.data).toBe('v1')
    resolveRefresh('v2')
    await waitFor(() => expect(second.result.current.data).toBe('v2'))
  })

  it('后台刷新失败时保留上次数据而不是整页报错', async () => {
    const first = renderHook(() => useBackendQuery('cache-fail', async () => 'ok'), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(first.result.current.data).toBe('ok'))
    first.unmount()

    const loader = vi.fn(async () => {
      throw new Error('请求已中止或超时')
    })
    const second = renderHook(() => useBackendQuery('cache-fail', loader), {
      wrapper: BackendProvider,
    })
    await waitFor(() => expect(loader).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(second.result.current.data).toBe('ok')
    expect(second.result.current.error).toBeUndefined()
    expect(second.result.current.loading).toBe(false)
  })
})
