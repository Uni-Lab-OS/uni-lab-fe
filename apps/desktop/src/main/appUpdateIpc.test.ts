import { describe, expect, it, vi } from 'vitest'

import { registerAppUpdateIpc } from './appUpdateIpc'

describe('registerAppUpdateIpc', () => {
  it('validates the renderer before pausing and resuming an update', async () => {
    const handlers = new Map<string, (event: object) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: object) => unknown) => {
        handlers.set(channel, handler)
      })
    }
    const assertSender = vi.fn()
    const manager = {
      pauseDownload: vi.fn(async () => ({ phase: 'paused' })),
      resumeDownload: vi.fn(async () => ({ phase: 'downloading' }))
    }
    registerAppUpdateIpc({
      ipcMain: ipcMain as never,
      manager: manager as never,
      assertSender
    })
    const event = {}

    await expect(handlers.get('app-update:pauseDownload')?.(event))
      .resolves.toEqual({ phase: 'paused' })
    await expect(handlers.get('app-update:resumeDownload')?.(event))
      .resolves.toEqual({ phase: 'downloading' })
    expect(assertSender).toHaveBeenNthCalledWith(1, event)
    expect(assertSender).toHaveBeenNthCalledWith(2, event)
    expect(manager.pauseDownload).toHaveBeenCalledOnce()
    expect(manager.resumeDownload).toHaveBeenCalledOnce()
  })
})
