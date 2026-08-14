import styles from './DeviceCardWorkbench.module.scss'
import type { DeviceCardWorkbenchModel } from './DeviceCardWorkbenchView'

/** 展示设备卡片的模拟或实时预览。 */
export function DeviceCardWorkbenchPreview({
  model,
  sidebarCollapsed,
  onToggleSidebar
}: {
  model: DeviceCardWorkbenchModel
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}): React.JSX.Element {
  const {
    liveMode,
    previewCard,
    previewDescription,
    previewDevice,
    previewRef,
    toggleLiveBinding,
    workspace
  } = model

  return (
    <main className={styles.main}>
      <header className={styles.previewHeader}>
        <div className={styles.previewHeading}>
          <button
            type="button"
            className={styles.sidebarToggle}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? '展开设备卡片开发面板' : '收起设备卡片开发面板'}
            onClick={onToggleSidebar}
          >
            <span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span>
            {sidebarCollapsed ? '展开开发面板' : '收起开发面板'}
          </button>
          <div>
            <strong>{previewCard?.title ?? '卡片预览'}</strong>
            <span>{previewDescription}</span>
          </div>
        </div>
        {previewCard && previewDevice ? (
          <div className={styles.liveControls}>
            <span className={styles.modeBadge} data-live={liveMode}>
              {liveMode ? 'LIVE' : 'MOCK'}
            </span>
            <button
              type="button"
              className={liveMode ? styles.stopLive : styles.applyLive}
              disabled={!liveMode && !previewDevice.online}
              aria-pressed={liveMode}
              onClick={toggleLiveBinding}
            >
              {liveMode ? '退出 Live' : `应用到 ${previewDevice.deviceId}`}
            </button>
          </div>
        ) : null}
      </header>
      <div ref={previewRef} className={styles.preview}>
        {!previewCard ? (
          <div className={styles.empty}>
            {workspace
              ? '修复左侧显示的问题后，预览会自动更新。'
              : '创建项目或选择一张已安装卡片后，可在这里预览。'}
          </div>
        ) : null}
      </div>
    </main>
  )
}
