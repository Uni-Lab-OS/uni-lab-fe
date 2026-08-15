import { describe, expect, it, vi } from 'vitest'

import {
  commissioningResponseTimeoutMs,
  dispatchBestEffortCommissioningClose
} from './deviceCardCommissioningLifecycle'

describe('device-card commissioning lifecycle', () => {
  it('does not let a missing close acknowledgement block the next open', async () => {
    const pendingClose = deferred<{ status: 'DONE' }>()
    const dispatch = vi.fn((operation: 'close' | 'open') => (
      operation === 'close'
        ? pendingClose.promise
        : Promise.resolve({ status: 'DONE' as const })
    ))

    dispatchBestEffortCommissioningClose(
      () => dispatch('close'),
      vi.fn()
    )
    const opening = dispatch('open')

    await expect(opening).resolves.toEqual({ status: 'DONE' })
    expect(dispatch).toHaveBeenNthCalledWith(1, 'close')
    expect(dispatch).toHaveBeenNthCalledWith(2, 'open')

    pendingClose.resolve({ status: 'DONE' })
  })

  it('bounds best-effort close cleanup independently from normal requests', () => {
    expect(commissioningResponseTimeoutMs('close')).toBe(5_000)
    expect(commissioningResponseTimeoutMs('close')).toBeLessThan(
      commissioningResponseTimeoutMs('open')
    )
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
