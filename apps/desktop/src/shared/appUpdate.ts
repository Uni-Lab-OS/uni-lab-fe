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

/** Renderer 可观察的桌面更新快照；不暴露下载地址、本地路径或底层异常。 */
export interface AppUpdateSnapshot {
  phase: AppUpdatePhase
  currentVersion: string
  availableVersion?: string
  progressPercent?: number
  checkedAt?: number
  errorCode?: AppUpdateErrorCode
}
