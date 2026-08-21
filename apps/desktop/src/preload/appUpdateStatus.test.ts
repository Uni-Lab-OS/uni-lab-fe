import { describe, expect, it, vi } from 'vitest'

import type {
  AppUpdateSnapshot,
  DesktopAppUpdateApi
} from '../shared/appUpdate'
import {
  AppUpdateStatusController,
  createAppUpdateStatusViewModel,
  type AppUpdateStatusAction,
  type AppUpdateStatusView,
  type AppUpdateStatusViewModel
} from './appUpdateStatus'

class RecordingView implements AppUpdateStatusView {
  readonly models: AppUpdateStatusViewModel[] = []
  disposed = false
  private listener: ((action: AppUpdateStatusAction) => void) | null = null

  render(model: AppUpdateStatusViewModel): void {
    this.models.push(model)
  }

  onAction(listener: (action: AppUpdateStatusAction) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  dispose(): void {
    this.disposed = true
  }

  act(action: AppUpdateStatusAction): void {
    this.listener?.(action)
  }

  latest(): AppUpdateStatusViewModel | undefined {
    return this.models.at(-1)
  }
}

describe('createAppUpdateStatusViewModel', () => {
  it('shows available, download and ready states with explicit actions', () => {
    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'available',
      availableVersion: '0.2.0'
    }))).toMatchObject({
      visible: true,
      tone: 'info',
      title: '发现新版本 0.2.0',
      action: { command: 'download', label: '后台下载' }
    })

    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'downloading',
      availableVersion: '0.2.0',
      progressPercent: 42.34
    }))).toMatchObject({
      visible: true,
      tone: 'active',
      progressPercent: 42.34
    })

    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'downloaded',
      availableVersion: '0.2.0',
      progressPercent: 100
    }))).toMatchObject({
      visible: true,
      tone: 'success',
      action: {
        command: 'restartAndInstall',
        label: '重启并安装'
      }
    })
  })

  it('keeps automatic checks quiet and makes failures recoverable', () => {
    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'checking'
    })).visible).toBe(false)
    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'checking'
    }), true)).toMatchObject({
      visible: true,
      title: '正在检查更新'
    })
    expect(createAppUpdateStatusViewModel(snapshot({
      phase: 'error',
      errorCode: 'DOWNLOAD_FAILED'
    }))).toMatchObject({
      visible: true,
      tone: 'error',
      action: { command: 'check', label: '重新检查' }
    })
  })
})

describe('AppUpdateStatusController', () => {
  it('subscribes before reading state so a stale response cannot win', async () => {
    const stateRequest = deferred<AppUpdateSnapshot>()
    const harness = createApiHarness(stateRequest.promise)
    const view = new RecordingView()
    const controller = new AppUpdateStatusController(harness.api, view)

    controller.start()
    harness.emit(snapshot({
      phase: 'available',
      availableVersion: '0.2.0'
    }))
    stateRequest.resolve(snapshot({ phase: 'idle' }))
    await flushMicrotasks()

    expect(view.latest()).toMatchObject({
      visible: true,
      phase: 'available'
    })
    controller.dispose()
    expect(view.disposed).toBe(true)
  })

  it('prevents duplicate actions and renders pending feedback', async () => {
    const downloadRequest = deferred<AppUpdateSnapshot>()
    const harness = createApiHarness(Promise.resolve(snapshot({
      phase: 'available',
      availableVersion: '0.2.0'
    })))
    harness.api.download = vi.fn(() => downloadRequest.promise)
    const view = new RecordingView()
    const controller = new AppUpdateStatusController(harness.api, view)
    controller.start()
    await flushMicrotasks()

    view.act('download')
    view.act('download')
    expect(harness.api.download).toHaveBeenCalledOnce()
    expect(view.latest()).toMatchObject({
      pending: true,
      action: { label: '正在开始…' }
    })

    downloadRequest.resolve(snapshot({
      phase: 'downloading',
      availableVersion: '0.2.0',
      progressPercent: 0
    }))
    await flushMicrotasks()
    expect(view.latest()).toMatchObject({
      phase: 'downloading',
      pending: false,
      progressPercent: 0
    })
    controller.dispose()
  })

  it('turns a rejected renderer command into a recoverable error', async () => {
    const harness = createApiHarness(Promise.resolve(snapshot({
      phase: 'downloaded',
      availableVersion: '0.2.0'
    })))
    harness.api.restartAndInstall = vi.fn(async () => {
      throw new Error('ipc failed')
    })
    const view = new RecordingView()
    const controller = new AppUpdateStatusController(harness.api, view)
    controller.start()
    await flushMicrotasks()

    view.act('restartAndInstall')
    await flushMicrotasks()
    expect(view.latest()).toMatchObject({
      phase: 'error',
      tone: 'error',
      action: { command: 'check', label: '重新检查' }
    })
    controller.dispose()
  })
})

function createApiHarness(initialState: Promise<AppUpdateSnapshot>): {
  api: DesktopAppUpdateApi
  emit: (snapshot: AppUpdateSnapshot) => void
} {
  let listener: ((snapshot: AppUpdateSnapshot) => void) | null = null
  const api: DesktopAppUpdateApi = {
    getState: vi.fn(() => initialState),
    check: vi.fn(async () => snapshot({ phase: 'idle' })),
    download: vi.fn(async () => snapshot({ phase: 'downloading' })),
    restartAndInstall: vi.fn(async () => snapshot({ phase: 'downloaded' })),
    onState: (nextListener) => {
      listener = nextListener
      return () => {
        if (listener === nextListener) listener = null
      }
    }
  }
  return {
    api,
    emit: (nextSnapshot) => listener?.(nextSnapshot)
  }
}

function snapshot(
  change: Partial<AppUpdateSnapshot> & Pick<AppUpdateSnapshot, 'phase'>
): AppUpdateSnapshot {
  return {
    currentVersion: '0.1.0',
    ...change
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
