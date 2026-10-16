import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentStalls } from './usePersistentStalls'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePersistentStalls', () => {
  it('surfaces a stall after it persists without new reads (stuck task sends no events)', () => {
    const raw = [{ taskId: 't', nodeId: 'n', reason: '动作耗时尚无可用估计' }]
    const { result } = renderHook(() => usePersistentStalls(raw, 60_000))
    expect(result.current).toEqual([])
    act(() => {
      vi.advanceTimersByTime(75_000)
    })
    expect(result.current).toEqual(raw)
  })

  it('drops a transient block that disappears before the threshold', () => {
    const transient = [{ taskId: 't', nodeId: 'a', reason: '已打开的连续资源区间缺少可继承所有权' }]
    const { result, rerender } = renderHook(({ raw }) => usePersistentStalls(raw, 60_000), {
      initialProps: { raw: transient },
    })
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    rerender({ raw: [] })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toEqual([])
  })
})
