import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'

import type {
  AppUpdateErrorCode,
  AppUpdateSnapshot
} from '../shared/appUpdate'

const DEFAULT_INITIAL_CHECK_DELAY_MS = 30_000
const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000

interface AppUpdaterHandlers {
  checking: () => void
  available: (version: string) => void
  notAvailable: () => void
  progress: (percent: number) => void
  downloaded: (version: string) => void
  error: (error: Error) => void
}

/** 隔离 electron-updater 事件模型，供更新模块与测试使用同一个 seam。 */
export interface AppUpdaterAdapter {
  configure(): void
  subscribe(handlers: AppUpdaterHandlers): () => void
  check(): Promise<void>
  download(): Promise<void>
  install(): void
}

interface AppUpdateManagerOptions {
  currentVersion: string
  enabled: boolean
  updater: AppUpdaterAdapter
  log: (message: string) => void
  publish?: (snapshot: AppUpdateSnapshot) => void
  confirmDownload?: (snapshot: AppUpdateSnapshot) => Promise<boolean>
  confirmInstall?: (snapshot: AppUpdateSnapshot) => Promise<boolean>
  beforeInstall?: () => Promise<void>
  initialCheckDelayMs?: number
  checkIntervalMs?: number
}

/**
 * 管理 Workbench 更新的完整生命周期，并只暴露稳定快照和受控命令。
 *
 * 下载与立即安装由渲染器显式触发；普通退出不会静默安装已下载版本。
 */
export class AppUpdateManager {
  private snapshot: AppUpdateSnapshot
  private unsubscribe: (() => void) | null = null
  private initialCheckTimer: ReturnType<typeof setTimeout> | null = null
  private periodicCheckTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private disposed = false

  constructor(private readonly options: AppUpdateManagerOptions) {
    this.snapshot = {
      phase: options.enabled ? 'idle' : 'disabled',
      currentVersion: options.currentVersion
    }
  }

  /** 绑定底层事件并启动低频更新检查；重复调用保持幂等。 */
  start(): AppUpdateSnapshot {
    if (this.started || this.disposed) return this.getSnapshot()
    this.started = true
    if (!this.options.enabled) {
      this.publish()
      return this.getSnapshot()
    }

    this.options.updater.configure()
    this.unsubscribe = this.options.updater.subscribe({
      checking: () => this.setSnapshot({ phase: 'checking' }),
      available: (version) => {
        const next = this.setSnapshot({
          phase: 'available',
          availableVersion: version,
          checkedAt: Date.now()
        })
        void this.offerDownload(next)
      },
      notAvailable: () => this.setSnapshot({
        phase: 'idle',
        checkedAt: Date.now()
      }),
      progress: (percent) => this.setSnapshot({
        phase: 'downloading',
        progressPercent: normalizePercent(percent)
      }),
      downloaded: (version) => {
        const next = this.setSnapshot({
          phase: 'downloaded',
          availableVersion: version,
          progressPercent: 100
        })
        void this.offerInstall(next)
      },
      error: (error) => {
        this.options.log(`Workbench 更新失败: ${safeErrorMessage(error)}`)
        this.setFailure(errorCodeForPhase(this.snapshot.phase))
      }
    })

    const initialDelay = this.options.initialCheckDelayMs
      ?? DEFAULT_INITIAL_CHECK_DELAY_MS
    const interval = this.options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.initialCheckTimer = setTimeout(() => {
      void this.check()
    }, initialDelay)
    this.initialCheckTimer.unref?.()
    this.periodicCheckTimer = setInterval(() => {
      void this.check()
    }, interval)
    this.periodicCheckTimer.unref?.()
    this.publish()
    return this.getSnapshot()
  }

  /** 返回快照副本，避免调用方改写模块内部状态。 */
  getSnapshot(): AppUpdateSnapshot {
    return { ...this.snapshot }
  }

  /** 发起一次幂等检查；开发态和非 Workbench 安装包安全返回 disabled。 */
  async check(): Promise<AppUpdateSnapshot> {
    if (!this.options.enabled || this.disposed) return this.getSnapshot()
    if (['checking', 'downloading', 'downloaded'].includes(this.snapshot.phase)) {
      return this.getSnapshot()
    }
    this.setSnapshot({ phase: 'checking' })
    try {
      await this.options.updater.check()
    } catch (error) {
      this.options.log(`Workbench 更新检查失败: ${safeErrorMessage(error)}`)
      this.setFailure('CHECK_FAILED')
    }
    return this.getSnapshot()
  }

  /** 下载已发现的版本；其他状态拒绝无意义或并发下载。 */
  async download(): Promise<AppUpdateSnapshot> {
    if (this.snapshot.phase !== 'available') return this.getSnapshot()
    this.setSnapshot({ phase: 'downloading', progressPercent: 0 })
    try {
      await this.options.updater.download()
    } catch (error) {
      this.options.log(`Workbench 更新下载失败: ${safeErrorMessage(error)}`)
      // electron-updater 的 macOS 实现会先派发 update-downloaded，再等待
      // Squirrel.Mac 取走 ZIP。该 Promise 可能在状态已经前进后才拒绝；此时
      // 不能把 downloaded/安装状态倒退成 DOWNLOAD_FAILED，否则确认安装会
      // 因状态守卫直接返回。
      if (this.getSnapshot().phase === 'downloading') {
        this.setFailure('DOWNLOAD_FAILED')
      }
    }
    return this.getSnapshot()
  }

  /** 完成宿主清理后重启安装，仅接受已下载状态。 */
  async restartAndInstall(): Promise<AppUpdateSnapshot> {
    if (this.snapshot.phase !== 'downloaded') return this.getSnapshot()
    try {
      await this.options.beforeInstall?.()
      this.options.updater.install()
    } catch (error) {
      this.options.log(`Workbench 更新安装启动失败: ${safeErrorMessage(error)}`)
      this.setFailure('INSTALL_FAILED')
    }
    return this.getSnapshot()
  }

  /** 释放事件和定时器；应用退出路径可以重复调用。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.initialCheckTimer) clearTimeout(this.initialCheckTimer)
    if (this.periodicCheckTimer) clearInterval(this.periodicCheckTimer)
    this.initialCheckTimer = null
    this.periodicCheckTimer = null
  }

  private async offerDownload(snapshot: AppUpdateSnapshot): Promise<void> {
    if (!this.options.confirmDownload) return
    try {
      if (await this.options.confirmDownload(snapshot)) await this.download()
    } catch (error) {
      this.options.log(`Workbench 更新下载确认失败: ${safeErrorMessage(error)}`)
    }
  }

  private async offerInstall(snapshot: AppUpdateSnapshot): Promise<void> {
    if (!this.options.confirmInstall) return
    try {
      if (await this.options.confirmInstall(snapshot)) {
        await this.restartAndInstall()
      }
    } catch (error) {
      this.options.log(`Workbench 更新安装确认失败: ${safeErrorMessage(error)}`)
    }
  }

  private setFailure(errorCode: AppUpdateErrorCode): AppUpdateSnapshot {
    return this.setSnapshot({ phase: 'error', errorCode })
  }

  private setSnapshot(
    change: Partial<AppUpdateSnapshot> & Pick<AppUpdateSnapshot, 'phase'>
  ): AppUpdateSnapshot {
    const keepsAvailableVersion = [
      'available',
      'downloading',
      'downloaded'
    ].includes(change.phase)
    this.snapshot = {
      currentVersion: this.options.currentVersion,
      ...(keepsAvailableVersion && this.snapshot.availableVersion
        ? { availableVersion: this.snapshot.availableVersion }
        : {}),
      ...change
    }
    this.publish()
    return this.getSnapshot()
  }

  private publish(): void {
    this.options.publish?.(this.getSnapshot())
  }
}

/** 将 electron-updater 包装为更新模块内部使用的窄 adapter。 */
export function createElectronUpdaterAdapter(
  updater: AppUpdater
): AppUpdaterAdapter {
  return {
    configure() {
      updater.autoDownload = false
      // macOS 在 true 时会在 electron-updater 的 preliminary
      // update-downloaded 事件后立即启动原生 Squirrel 下载。若原生阶段在
      // 用户确认前失败，后续 quitAndInstall 不会重试。显式安装模式让
      // quitAndInstall 在用户点击后启动该阶段，并等待原生 ready 事件退出。
      updater.autoInstallOnAppQuit = false
      updater.allowDowngrade = false
      updater.disableWebInstaller = true
    },
    subscribe(handlers) {
      const checking = (): void => handlers.checking()
      const available = (info: UpdateInfo): void => handlers.available(info.version)
      const notAvailable = (): void => handlers.notAvailable()
      const progress = (info: ProgressInfo): void => handlers.progress(info.percent)
      const downloaded = (info: UpdateInfo): void => handlers.downloaded(info.version)
      const error = (value: Error): void => handlers.error(value)
      updater.on('checking-for-update', checking)
      updater.on('update-available', available)
      updater.on('update-not-available', notAvailable)
      updater.on('download-progress', progress)
      updater.on('update-downloaded', downloaded)
      updater.on('error', error)
      return () => {
        updater.off('checking-for-update', checking)
        updater.off('update-available', available)
        updater.off('update-not-available', notAvailable)
        updater.off('download-progress', progress)
        updater.off('update-downloaded', downloaded)
        updater.off('error', error)
      }
    },
    async check() {
      await updater.checkForUpdates()
    },
    async download() {
      await updater.downloadUpdate()
    },
    install() {
      updater.quitAndInstall(false, true)
    }
  }
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10
}

function errorCodeForPhase(phase: AppUpdateSnapshot['phase']): AppUpdateErrorCode {
  if (phase === 'downloading') return 'DOWNLOAD_FAILED'
  if (phase === 'downloaded') return 'INSTALL_FAILED'
  return 'CHECK_FAILED'
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/https?:\/\/[^\s]+/giu, (value) => {
      try {
        const url = new URL(value)
        return `${url.origin}${url.pathname}`
      } catch {
        return '[UPDATE_URL]'
      }
    })
    .replace(/\b(token|password|secret)=([^\s&]+)/giu, '$1=[REDACTED]')
    .slice(0, 500)
}
