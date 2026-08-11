import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AppUpdateManager,
  type AppUpdaterAdapter
} from './appUpdateManager'

class RecordingUpdater implements AppUpdaterAdapter {
  configured = false
  checkCount = 0
  downloadCount = 0
  installCount = 0
  handlers: Parameters<AppUpdaterAdapter['subscribe']>[0] | null = null

  configure(): void {
    this.configured = true
  }

  subscribe(
    handlers: Parameters<AppUpdaterAdapter['subscribe']>[0]
  ): () => void {
    this.handlers = handlers
    return () => {
      this.handlers = null
    }
  }

  async check(): Promise<void> {
    this.checkCount += 1
  }

  async download(): Promise<void> {
    this.downloadCount += 1
  }

  install(): void {
    this.installCount += 1
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AppUpdateManager', () => {
  it('keeps development builds disabled without touching the updater', async () => {
    const updater = new RecordingUpdater()
    const manager = createManager(updater, { enabled: false })

    expect(manager.start()).toEqual({
      phase: 'disabled',
      currentVersion: '0.1.1'
    })
    await expect(manager.check()).resolves.toEqual({
      phase: 'disabled',
      currentVersion: '0.1.1'
    })
    expect(updater.configured).toBe(false)
    expect(updater.checkCount).toBe(0)
  })

  it('tracks discovery, progress and a controlled install through one snapshot', async () => {
    const updater = new RecordingUpdater()
    const beforeInstall = vi.fn(async () => undefined)
    const snapshots: string[] = []
    const manager = createManager(updater, {
      beforeInstall,
      publish: (snapshot) => snapshots.push(snapshot.phase)
    })
    manager.start()

    updater.handlers?.available('0.2.0')
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'available',
      currentVersion: '0.1.1',
      availableVersion: '0.2.0'
    })

    await manager.download()
    expect(updater.downloadCount).toBe(1)
    updater.handlers?.progress(42.347)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloading',
      progressPercent: 42.3
    })

    updater.handlers?.downloaded('0.2.0')
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloaded',
      progressPercent: 100
    })
    await manager.restartAndInstall()

    expect(beforeInstall).toHaveBeenCalledOnce()
    expect(updater.installCount).toBe(1)
    expect(snapshots).toContain('available')
    expect(snapshots).toContain('downloaded')
    manager.dispose()
  })

  it('can ask for download and installation without exposing the updater', async () => {
    const updater = new RecordingUpdater()
    const confirmDownload = vi.fn(async () => true)
    const confirmInstall = vi.fn(async () => true)
    const manager = createManager(updater, { confirmDownload, confirmInstall })
    manager.start()

    updater.handlers?.available('0.2.0')
    await flushMicrotasks()
    expect(confirmDownload).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'available',
      availableVersion: '0.2.0'
    }))
    expect(updater.downloadCount).toBe(1)

    updater.handlers?.downloaded('0.2.0')
    await flushMicrotasks()
    expect(confirmInstall).toHaveBeenCalledOnce()
    expect(updater.installCount).toBe(1)
    manager.dispose()
  })

  it('sanitizes update errors and returns a stable error code', async () => {
    const updater = new RecordingUpdater()
    const log = vi.fn()
    updater.check = vi.fn(async () => {
      throw new Error(
        'GET https://user:password@updates.example/latest.yml?token=secret failed'
      )
    })
    const manager = createManager(updater, { log })
    manager.start()

    await expect(manager.check()).resolves.toMatchObject({
      phase: 'error',
      errorCode: 'CHECK_FAILED'
    })
    expect(String(log.mock.calls[0]?.[0])).toBe(
      '桌面更新检查失败: GET https://updates.example/latest.yml failed'
    )
    manager.dispose()
  })

  it('checks after the initial delay and then on the configured interval', async () => {
    vi.useFakeTimers()
    const updater = new RecordingUpdater()
    updater.check = vi.fn(async () => {
      updater.checkCount += 1
      updater.handlers?.notAvailable()
    })
    const manager = createManager(updater, {
      initialCheckDelayMs: 100,
      checkIntervalMs: 1_000
    })
    manager.start()

    await vi.advanceTimersByTimeAsync(99)
    expect(updater.checkCount).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.checkCount).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(updater.checkCount).toBe(2)
    manager.dispose()
  })

  it('does not replace download or ready-to-install state with a periodic check', async () => {
    const updater = new RecordingUpdater()
    const manager = createManager(updater)
    manager.start()
    updater.handlers?.available('0.2.0')
    await manager.download()

    await manager.check()
    expect(updater.checkCount).toBe(0)
    expect(manager.getSnapshot().phase).toBe('downloading')

    updater.handlers?.downloaded('0.2.0')
    await manager.check()
    expect(updater.checkCount).toBe(0)
    expect(manager.getSnapshot().phase).toBe('downloaded')
    manager.dispose()
  })
})

function createManager(
  updater: RecordingUpdater,
  overrides: Partial<ConstructorParameters<typeof AppUpdateManager>[0]> = {}
): AppUpdateManager {
  return new AppUpdateManager({
    currentVersion: '0.1.1',
    enabled: true,
    updater,
    log: () => undefined,
    initialCheckDelayMs: 60_000,
    checkIntervalMs: 60_000,
    ...overrides
  })
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
