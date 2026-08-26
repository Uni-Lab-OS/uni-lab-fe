export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'error'

export type AppUpdateErrorCode =
  | 'CHECK_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'INSTALL_FAILED'
  | 'INSTALL_FROM_DISK_IMAGE'

/** Renderer 可观察的 Workbench 更新快照；不暴露下载地址、本地路径或底层异常。 */
export interface AppUpdateSnapshot {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  checkedAt?: number
  errorCode?: AppUpdateErrorCode
}

/** preload 暴露给受信任 Workbench renderer 的最小更新接口。 */
export interface DesktopAppUpdateApi {
  getState(): Promise<AppUpdateSnapshot>
  check(): Promise<AppUpdateSnapshot>
  download(): Promise<AppUpdateSnapshot>
  pauseDownload(): Promise<AppUpdateSnapshot>
  resumeDownload(): Promise<AppUpdateSnapshot>
  restartAndInstall(): Promise<AppUpdateSnapshot>
  onState(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}

/**
 * 将下载快照转换成 Electron Dock/任务栏接受的进度值。
 *
 * 非下载状态返回 -1，用于立即移除已经完成或失效的系统进度显示。
 */
export function resolveAppUpdateProgressBarValue(
  snapshot: AppUpdateSnapshot
): number {
  if (!['downloading', 'paused'].includes(snapshot.phase)) return -1
  const percent = Number.isFinite(snapshot.progressPercent)
    ? snapshot.progressPercent ?? 0
    : 0
  return Math.min(100, Math.max(0, percent)) / 100
}
