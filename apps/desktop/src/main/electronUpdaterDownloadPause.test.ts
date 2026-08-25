import { describe, expect, it, vi } from 'vitest'

import { bindElectronUpdaterDownloadPause } from './electronUpdaterDownloadPause'

class RecordingResponse {
  readonly pause = vi.fn()
  readonly resume = vi.fn()
  private readonly listeners = new Map<string, () => void>()

  once(event: string, listener: () => void): this {
    this.listeners.set(event, listener)
    return this
  }

  finish(event = 'end'): void {
    this.listeners.get(event)?.()
  }
}

class RecordingExecutor {
  private responseListener: ((response: RecordingResponse) => void) | null = null

  createRequest(
    _options: unknown,
    listener: (response: RecordingResponse) => void
  ): object {
    this.responseListener = listener
    return {}
  }

  respond(response: RecordingResponse): void {
    this.responseListener?.(response)
  }
}

describe('bindElectronUpdaterDownloadPause', () => {
  it('pauses active and newly-created updater response streams in place', () => {
    const executor = new RecordingExecutor()
    const controller = bindElectronUpdaterDownloadPause({
      httpExecutor: executor
    })
    const active = new RecordingResponse()

    executor.createRequest({}, () => undefined)
    executor.respond(active)
    expect(controller.pause()).toBe(true)
    expect(active.pause).toHaveBeenCalledOnce()

    const createdWhilePaused = new RecordingResponse()
    executor.createRequest({}, () => undefined)
    executor.respond(createdWhilePaused)
    expect(createdWhilePaused.pause).toHaveBeenCalledOnce()

    expect(controller.resume()).toBe(true)
    expect(active.resume).toHaveBeenCalledOnce()
    expect(createdWhilePaused.resume).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('fails closed when the pinned updater transport contract is unavailable', () => {
    const controller = bindElectronUpdaterDownloadPause({})

    expect(controller.pause()).toBe(false)
    expect(controller.resume()).toBe(false)
    controller.dispose()
  })
})
