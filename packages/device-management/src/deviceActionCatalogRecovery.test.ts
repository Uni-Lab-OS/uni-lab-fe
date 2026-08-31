import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startDeviceActionCatalogRecovery } from './deviceActionCatalogRecovery'

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('device Action catalog startup recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('retries a transient startup failure until the catalog becomes ready', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = startDeviceActionCatalogRecovery({
      load,
      initialRetryDelayMs: 1_000,
      maxRetryDelayMs: 4_000
    })
    await flushMicrotasks()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenNthCalledWith(1, false)

    await vi.advanceTimersByTimeAsync(999)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenNthCalledWith(2, false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(2)
    recovery.dispose()
  })

  it('lets the visible refresh action retry immediately', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const recovery = startDeviceActionCatalogRecovery({
      load,
      initialRetryDelayMs: 5_000
    })
    await flushMicrotasks()

    await expect(recovery.refresh()).resolves.toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenNthCalledWith(2, true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(load).toHaveBeenCalledTimes(2)
    recovery.dispose()
  })

  it('does not update or retry after disposal', async () => {
    let resolveLoad: ((loaded: boolean) => void) | undefined
    const load = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveLoad = resolve
    }))
    const recovery = startDeviceActionCatalogRecovery({ load })
    recovery.dispose()
    resolveLoad?.(false)
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(load).toHaveBeenCalledTimes(1)
  })
})
