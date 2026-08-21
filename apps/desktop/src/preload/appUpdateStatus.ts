import type {
  AppUpdateErrorCode,
  AppUpdatePhase,
  AppUpdateSnapshot,
  DesktopAppUpdateApi
} from '../shared/appUpdate'

export type AppUpdateStatusAction =
  | 'check'
  | 'download'
  | 'restartAndInstall'

export interface AppUpdateStatusViewModel {
  visible: boolean
  phase: AppUpdatePhase
  tone: 'info' | 'active' | 'success' | 'error'
  title: string
  detail: string
  progressPercent?: number
  action?: {
    command: AppUpdateStatusAction
    label: string
  }
  pending: boolean
}

export interface AppUpdateStatusView {
  render(model: AppUpdateStatusViewModel): void
  onAction(listener: (action: AppUpdateStatusAction) => void): () => void
  dispose(): void
}

const ERROR_DETAILS: Record<AppUpdateErrorCode, string> = {
  CHECK_FAILED: '检查更新失败，请确认网络连接后重试。',
  DOWNLOAD_FAILED: '下载更新失败，请重新检查后再试。',
  INSTALL_FAILED: '未能启动安装，请重新检查后再试。'
}

/** 将主进程快照投影为稳定、无底层错误细节的界面文案。 */
export function createAppUpdateStatusViewModel(
  snapshot: AppUpdateSnapshot,
  pending = false
): AppUpdateStatusViewModel {
  const version = snapshot.availableVersion
    ? ` ${snapshot.availableVersion}`
    : ''

  switch (snapshot.phase) {
    case 'available':
      return {
        visible: true,
        phase: snapshot.phase,
        tone: 'info',
        title: `发现新版本${version}`,
        detail: '可以在后台下载，下载期间可继续使用工作台。',
        action: {
          command: 'download',
          label: pending ? '正在开始…' : '后台下载'
        },
        pending
      }
    case 'downloading':
      return {
        visible: true,
        phase: snapshot.phase,
        tone: 'active',
        title: `正在下载${version}`,
        detail: '下载完成后可选择重启并安装。',
        progressPercent: normalizeProgress(snapshot.progressPercent),
        pending
      }
    case 'downloaded':
      return {
        visible: true,
        phase: snapshot.phase,
        tone: 'success',
        title: `更新已就绪${version}`,
        detail: '重启前会先完成运行环境清理和未保存内容确认。',
        action: {
          command: 'restartAndInstall',
          label: pending ? '正在重启…' : '重启并安装'
        },
        pending
      }
    case 'error':
      return {
        visible: true,
        phase: snapshot.phase,
        tone: 'error',
        title: '更新未完成',
        detail: snapshot.errorCode
          ? ERROR_DETAILS[snapshot.errorCode]
          : '更新操作失败，请稍后重试。',
        action: {
          command: 'check',
          label: pending ? '正在检查…' : '重新检查'
        },
        pending
      }
    case 'checking':
      return {
        visible: pending,
        phase: snapshot.phase,
        tone: 'info',
        title: '正在检查更新',
        detail: '正在获取最新版本信息。',
        pending
      }
    case 'disabled':
    case 'idle':
      return {
        visible: false,
        phase: snapshot.phase,
        tone: 'info',
        title: '',
        detail: '',
        pending
      }
  }
}

/**
 * 协调 preload 更新 API 与视图，保证事件先于初始查询注册，避免旧快照覆盖新状态。
 */
export class AppUpdateStatusController {
  private latestSnapshot: AppUpdateSnapshot | null = null
  private unsubscribeState: (() => void) | null = null
  private unsubscribeAction: (() => void) | null = null
  private stateRevision = 0
  private pending = false
  private started = false

  constructor(
    private readonly api: DesktopAppUpdateApi,
    private readonly view: AppUpdateStatusView
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.unsubscribeState = this.api.onState((snapshot) => {
      this.stateRevision += 1
      this.applySnapshot(snapshot)
    })
    this.unsubscribeAction = this.view.onAction((action) => {
      void this.runAction(action)
    })

    const revisionAtRequest = this.stateRevision
    void this.api.getState()
      .then((snapshot) => {
        if (!this.started || this.stateRevision !== revisionAtRequest) return
        this.applySnapshot(snapshot)
      })
      .catch(() => {
        if (!this.started || this.stateRevision !== revisionAtRequest) return
        this.applySnapshot({
          phase: 'error',
          currentVersion: '',
          errorCode: 'CHECK_FAILED'
        })
      })
  }

  dispose(): void {
    if (!this.started) return
    this.started = false
    this.unsubscribeState?.()
    this.unsubscribeAction?.()
    this.unsubscribeState = null
    this.unsubscribeAction = null
    this.view.dispose()
  }

  private applySnapshot(snapshot: AppUpdateSnapshot): void {
    this.latestSnapshot = { ...snapshot }
    this.view.render(createAppUpdateStatusViewModel(snapshot, this.pending))
  }

  private async runAction(action: AppUpdateStatusAction): Promise<void> {
    if (this.pending || !this.latestSnapshot) return
    this.pending = true
    this.view.render(createAppUpdateStatusViewModel(
      this.latestSnapshot,
      true
    ))
    try {
      const snapshot = await this.api[action]()
      if (this.started) this.applySnapshot(snapshot)
    } catch {
      if (this.started) {
        this.applySnapshot({
          phase: 'error',
          currentVersion: this.latestSnapshot.currentVersion,
          errorCode: errorCodeForAction(action)
        })
      }
    } finally {
      this.pending = false
      if (this.started && this.latestSnapshot) {
        this.view.render(createAppUpdateStatusViewModel(
          this.latestSnapshot,
          false
        ))
      }
    }
  }
}

/** 在欢迎页和 Theia 工作台共用的 Electron shell 中挂载更新状态条。 */
export function installAppUpdateStatus(
  api: DesktopAppUpdateApi,
  document: Document = globalThis.document,
  window: Window = globalThis.window
): () => void {
  let controller: AppUpdateStatusController | null = null
  let disposed = false

  const mount = (): void => {
    if (disposed || controller || !document.body) return
    controller = new AppUpdateStatusController(
      api,
      new DomAppUpdateStatusView(document)
    )
    controller.start()
  }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    document.removeEventListener('DOMContentLoaded', mount)
    window.removeEventListener('pagehide', dispose)
    controller?.dispose()
    controller = null
  }

  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
  window.addEventListener('pagehide', dispose, { once: true })
  return dispose
}

class DomAppUpdateStatusView implements AppUpdateStatusView {
  private readonly root: HTMLElement
  private readonly title: HTMLElement
  private readonly detail: HTMLElement
  private readonly progressRow: HTMLElement
  private readonly progress: HTMLProgressElement
  private readonly progressText: HTMLOutputElement
  private readonly actionButton: HTMLButtonElement
  private action: AppUpdateStatusAction | null = null
  private actionListener: ((action: AppUpdateStatusAction) => void) | null = null

  constructor(private readonly document: Document) {
    this.root = document.createElement('section')
    this.root.className = 'unilab-app-update-status'
    this.root.setAttribute('aria-live', 'polite')
    this.root.setAttribute('aria-atomic', 'true')
    this.root.hidden = true

    const indicator = document.createElement('span')
    indicator.className = 'unilab-app-update-status__indicator'
    indicator.setAttribute('aria-hidden', 'true')

    const copy = document.createElement('div')
    copy.className = 'unilab-app-update-status__copy'
    this.title = document.createElement('strong')
    this.title.className = 'unilab-app-update-status__title'
    this.detail = document.createElement('span')
    this.detail.className = 'unilab-app-update-status__detail'
    copy.append(this.title, this.detail)

    this.progressRow = document.createElement('div')
    this.progressRow.className = 'unilab-app-update-status__progress-row'
    this.progress = document.createElement('progress')
    this.progress.className = 'unilab-app-update-status__progress'
    this.progress.max = 100
    this.progressText = document.createElement('output')
    this.progressText.className = 'unilab-app-update-status__progress-text'
    this.progressRow.append(this.progress, this.progressText)

    this.actionButton = document.createElement('button')
    this.actionButton.className = 'unilab-app-update-status__action'
    this.actionButton.type = 'button'
    this.actionButton.addEventListener('click', this.handleAction)

    this.root.append(
      indicator,
      copy,
      this.progressRow,
      this.actionButton
    )
    document.body.append(this.root)
  }

  render(model: AppUpdateStatusViewModel): void {
    this.root.hidden = !model.visible
    this.root.dataset.tone = model.tone
    this.root.setAttribute(
      'role',
      model.tone === 'error' ? 'alert' : 'status'
    )
    this.title.textContent = model.title
    this.detail.textContent = model.detail

    const hasProgress = model.progressPercent !== undefined
    this.progressRow.hidden = !hasProgress
    if (hasProgress) {
      const value = model.progressPercent ?? 0
      const label = formatProgress(value)
      this.progress.value = value
      this.progress.setAttribute('aria-label', `更新下载进度 ${label}`)
      this.progressText.value = label
      this.progressText.textContent = label
    }

    this.action = model.action?.command ?? null
    this.actionButton.hidden = !model.action
    this.actionButton.disabled = model.pending
    this.actionButton.textContent = model.action?.label ?? ''
  }

  onAction(listener: (action: AppUpdateStatusAction) => void): () => void {
    this.actionListener = listener
    return () => {
      if (this.actionListener === listener) this.actionListener = null
    }
  }

  dispose(): void {
    this.actionButton.removeEventListener('click', this.handleAction)
    this.root.remove()
    this.actionListener = null
  }

  private readonly handleAction = (): void => {
    if (this.action && !this.actionButton.disabled) {
      this.actionListener?.(this.action)
    }
  }
}

function normalizeProgress(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value ?? 0))
}

function formatProgress(value: number): string {
  return `${Math.round(value)}%`
}

function errorCodeForAction(
  action: AppUpdateStatusAction
): AppUpdateErrorCode {
  if (action === 'download') return 'DOWNLOAD_FAILED'
  if (action === 'restartAndInstall') return 'INSTALL_FAILED'
  return 'CHECK_FAILED'
}
