import { EventEmitter } from 'node:events'

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
    const log = vi.fn()
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      disableWebInstaller: false,
      logger: null as null | {
        info(message?: unknown): void
        warn(message?: unknown): void
        error(message?: unknown): void
        debug?(message: string): void
      }
    }

    createElectronUpdaterAdapter(updater as never, log).configure()

    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      disableWebInstaller: true
    })
    expect(updater.logger).not.toBeNull()
    expect(updater.logger?.debug).toBeUndefined()
  })

  it('writes differential mode and exact transfer metrics to the main log', async () => {
    const events = new EventEmitter()
    const log = vi.fn()
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowDowngrade: true,
      disableWebInstaller: false,
      logger: null as null | {
        info(message?: unknown): void
        warn(message?: unknown): void
        error(message?: unknown): void
      },
      on: events.on.bind(events),
      off: events.off.bind(events),
      downloadUpdate: vi.fn(async () => []),
      quitAndInstall: vi.fn()
    }
    const adapter = createElectronUpdaterAdapter(updater as never, log)
    adapter.configure()
    const unsubscribe = adapter.subscribe({
      checking: vi.fn(),
      available: vi.fn(),
      notAvailable: vi.fn(),
      progress: vi.fn(),
      downloaded: vi.fn(),
      error: vi.fn()
    })

    events.emit('update-available', {
      version: '0.1.24',
      files: [{ size: 665_157_321 }]
    })
    await adapter.download()
    updater.logger?.info('Full: 634.34 MB, To download: 12.00 MB (2%)')
    updater.logger?.info('Differential download: https://updates.example/0.1.24.zip')
    events.emit('download-progress', {
      percent: 100,
      total: 12_582_912,
      transferred: 12_582_912,
      delta: 1_024,
      bytesPerSecond: 1_024
    })
    events.emit('update-downloaded', { version: '0.1.24' })

    expect(log.mock.calls.map(([message]) => message)).toContain(
      'Workbench 更新下载完成: version=0.1.24 mode=differential packageBytes=665157321 transferredBytes=12582912 plannedTransferBytes=12582912 savedBytes=652574409 savedPercent=98.1'
    )
    unsubscribe()
  })

  it('waits for a failed updater promise to settle before starting its retry', async () => {
    const firstDownload = deferred<string[]>()
    const updater = {
      downloadUpdate: vi.fn()
        .mockReturnValueOnce(firstDownload.promise)
        .mockResolvedValueOnce([])
    }
    const adapter = createElectronUpdaterAdapter(updater as never, vi.fn())

    const firstAttempt = adapter.download()
    const retry = adapter.download()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()

    firstDownload.reject(new Error('network changed'))
    await expect(firstAttempt).rejects.toThrow('network changed')
    await expect(retry).resolves.toBeUndefined()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
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

  it('keeps failed download progress and retries without checking again', async () => {
    const updater = new RecordingUpdater()
    const firstDownload = deferred<void>()
    const resumedDownload = deferred<void>()
    updater.download = vi.fn()
      .mockImplementationOnce(() => firstDownload.promise)
      .mockImplementationOnce(() => resumedDownload.promise)
    const manager = createManager(updater)
    manager.start()
    updater.handlers?.available('0.2.0')

    await manager.download()
    updater.handlers?.progress(42.3)
    firstDownload.reject(new Error('network changed'))
    await flushMicrotasks()

    expect(manager.getSnapshot()).toMatchObject({
      phase: 'error',
      errorCode: 'DOWNLOAD_FAILED',
      availableVersion: '0.2.0',
      progressPercent: 42.3
    })

    await expect(manager.download()).resolves.toMatchObject({
      phase: 'downloading',
      availableVersion: '0.2.0',
      progressPercent: 42.3
    })
    expect(updater.download).toHaveBeenCalledTimes(2)
    expect(updater.checkCount).toBe(0)

    resumedDownload.resolve()
    await flushMicrotasks()
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
