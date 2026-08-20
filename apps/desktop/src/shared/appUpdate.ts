export type AppUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type AppUpdateErrorCode =
  | 'CHECK_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'INSTALL_FAILED'

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
  restartAndInstall(): Promise<AppUpdateSnapshot>
  onState(listener: (snapshot: AppUpdateSnapshot) => void): () => void
}
