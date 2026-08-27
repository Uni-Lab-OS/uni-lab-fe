import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AppUpdateManager,
  createElectronUpdaterAdapter,
  type AppUpdaterAdapter
} from './appUpdateManager'

class RecordingUpdater implements AppUpdaterAdapter {
  configured = false
  checkCount = 0
  downloadCount = 0
  pauseCount = 0
  resumeCount = 0
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

  pause(): boolean {
    this.pauseCount += 1
    return true
  }

  resume(): boolean {
    this.resumeCount += 1
    return true
  }

  install(): void {
    this.installCount += 1
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AppUpdateManager', () => {
  it('configures an explicit install so macOS native update starts after confirmation', () => {
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      disableWebInstaller: false
    }

    createElectronUpdaterAdapter(updater as never).configure()

    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      disableWebInstaller: true
    })
  })

  it('keeps development and legacy surfaces disabled without touching the updater', async () => {
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

  it('pauses and resumes the active transfer without starting another download', async () => {
    const updater = new RecordingUpdater()
    const downloadRequest = deferred<void>()
    updater.download = vi.fn(() => downloadRequest.promise)
    const manager = createManager(updater)
    manager.start()
    updater.handlers?.available('0.2.0')

    await expect(manager.download()).resolves.toMatchObject({
      phase: 'downloading',
      progressPercent: 0
    })
    expect(updater.download).toHaveBeenCalledOnce()

    await expect(manager.pauseDownload()).resolves.toMatchObject({
      phase: 'paused',
      progressPercent: 0
    })
    updater.handlers?.progress(42.3)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'paused',
      progressPercent: 42.3
    })

    await expect(manager.resumeDownload()).resolves.toMatchObject({
      phase: 'downloading',
      progressPercent: 42.3
    })
    expect(updater.pauseCount).toBe(1)
    expect(updater.resumeCount).toBe(1)
    expect(updater.download).toHaveBeenCalledOnce()

    downloadRequest.resolve()
    await flushMicrotasks()
    updater.handlers?.downloaded('0.2.0')
    manager.dispose()
  })

  it('rejects an invalid install location before cleanup or updater launch', async () => {
    const updater = new RecordingUpdater()
    const beforeInstall = vi.fn(async () => undefined)
    const manager = createManager(updater, {
      validateInstall: () => 'INSTALL_FROM_DISK_IMAGE',
      beforeInstall
    })
    manager.start()
    updater.handlers?.downloaded('0.2.0')

    await expect(manager.restartAndInstall()).resolves.toMatchObject({
      phase: 'error',
      errorCode: 'INSTALL_FROM_DISK_IMAGE'
    })
    expect(beforeInstall).not.toHaveBeenCalled()
    expect(updater.installCount).toBe(0)
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
      'Workbench 更新检查失败: GET https://updates.example/latest.yml failed'
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

    await manager.pauseDownload()
    await manager.check()
    expect(updater.checkCount).toBe(0)
    expect(manager.getSnapshot().phase).toBe('paused')

    await manager.resumeDownload()

    updater.handlers?.downloaded('0.2.0')
    await manager.check()
    expect(updater.checkCount).toBe(0)
    expect(manager.getSnapshot().phase).toBe('downloaded')
    manager.dispose()
  })

  it('keeps a downloaded update installable when the download promise rejects after the downloaded event', async () => {
    const updater = new RecordingUpdater()
    const downloadRequest = deferred<void>()
    const installConfirmation = deferred<boolean>()
    updater.download = vi.fn(() => downloadRequest.promise)
    const manager = createManager(updater, {
      confirmInstall: vi.fn(() => installConfirmation.promise)
    })
    manager.start()
    updater.handlers?.available('0.2.0')

    const downloading = manager.download()
    updater.handlers?.downloaded('0.2.0')
    await flushMicrotasks()
    downloadRequest.reject(new Error('download promise rejected after completion'))
    await downloading

    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloaded',
      availableVersion: '0.2.0',
      progressPercent: 100
    })
    installConfirmation.resolve(true)
    await flushMicrotasks()
    expect(updater.installCount).toBe(1)
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

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}
