import { describe, expect, it, vi } from 'vitest'

import { LatestViewOpenCoordinator } from './latestViewOpenCoordinator'

describe('LatestViewOpenCoordinator', () => {
  it('commits only the latest overlapping open and absorbs superseded failure', async () => {
    const firstLoad = deferred<void>()
    const secondLoad = deferred<void>()
    const activate = vi.fn()
    const dispose = vi.fn()
    const coordinator = new LatestViewOpenCoordinator<string>({
      activate,
      dispose
    })

    const first = coordinator.open('first', () => firstLoad.promise)
    const second = coordinator.open('second', () => secondLoad.promise)
    firstLoad.reject(Object.assign(new Error('ERR_FAILED'), { errno: -2 }))
    secondLoad.resolve()

    await expect(first).resolves.toBe('superseded')
    await expect(second).resolves.toBe('committed')
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledWith('second')
    expect(coordinator.getActive()).toBe('second')
    expect(dispose).toHaveBeenCalledWith('first')
    expect(dispose.mock.calls.filter(([view]) => view === 'first')).toHaveLength(1)
  })

  it('prevents a pending open from committing after explicit close', async () => {
    const load = deferred<void>()
    const activate = vi.fn()
    const dispose = vi.fn()
    const coordinator = new LatestViewOpenCoordinator<string>({
      activate,
      dispose
    })

    const opening = coordinator.open('candidate', () => load.promise)
    coordinator.closeAll()
    load.resolve()

    await expect(opening).resolves.toBe('superseded')
    expect(activate).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledWith('candidate')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(coordinator.getActive()).toBeNull()
  })

  it('keeps the current view when the latest replacement genuinely fails', async () => {
    const activate = vi.fn()
    const dispose = vi.fn()
    const coordinator = new LatestViewOpenCoordinator<string>({
      activate,
      dispose
    })
    await coordinator.open('current', async () => {})
    const failure = new Error('real load failure')

    await expect(coordinator.open('replacement', async () => {
      throw failure
    })).rejects.toBe(failure)

    expect(coordinator.getActive()).toBe('current')
    expect(dispose).toHaveBeenCalledWith('replacement')
    expect(dispose).not.toHaveBeenCalledWith('current')
  })

  it('does not hide an externally destroyed latest candidate as superseded', async () => {
    const load = deferred<void>()
    const coordinator = new LatestViewOpenCoordinator<string>({
      activate: vi.fn(),
      dispose: vi.fn()
    })
    const opening = coordinator.open('candidate', () => load.promise)

    coordinator.forget('candidate')
    load.resolve()

    await expect(opening).rejects.toThrow(/destroyed before activation/)
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}
