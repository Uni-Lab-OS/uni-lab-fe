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
})
