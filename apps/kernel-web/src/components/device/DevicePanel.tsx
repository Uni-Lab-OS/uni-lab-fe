import { DeviceManagementPanel } from '@unilab/device-management'
import { useServices } from '@unilab/services'
import { useState, type KeyboardEvent } from 'react'

import { useWorkbench } from '../../context/WorkbenchContext'
import DeviceCardWorkbench from '../device-cards/DeviceCardWorkbench'
import styles from './DevicePanel.module.scss'

export type DevicePanelMode = 'control' | 'cards'

/** 将 kernel-web 的环境上下文适配到公共设备单点调试面板。 */
export default function DevicePanel(): React.JSX.Element {
  const { backend, backendEnabled, connection } = useWorkbench()
  const services = useServices()
  const [mode, setMode] = useState<DevicePanelMode>(initialDevicePanelMode)

  return (
    <div className={styles.shell}>
      <DevicePanelModeSwitcher mode={mode} onChange={setMode} />
      <section
        id="kernel-device-control-panel"
        role="tabpanel"
        aria-labelledby="kernel-device-control-tab"
        hidden={mode !== 'control'}
        className={styles.panel}
      >
        {mode === 'control' ? (
          <DeviceManagementPanel
            services={services}
            backend={backend}
            backendEnabled={backendEnabled}
            connection={connection}
          />
        ) : null}
      </section>
      <section
        id="kernel-device-cards-panel"
        role="tabpanel"
        aria-labelledby="kernel-device-cards-tab"
        hidden={mode !== 'cards'}
        className={styles.panel}
      >
        {mode === 'cards' ? <DeviceCardWorkbench /> : null}
      </section>
    </div>
  )
}

/**
 * 渲染“仪器设备”下可键盘访问的设备控制与自定义卡片页签。
 *
 * @param props 当前页签和变更回调。
 * @returns 共享仪器设备工作面的页签组。
 */
export function DevicePanelModeSwitcher({
  mode,
  onChange
}: {
  mode: DevicePanelMode
  onChange: (mode: DevicePanelMode) => void
}): React.JSX.Element {
  /** 根据方向键或首尾键切换并聚焦仪器设备页签。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next = event.key === 'ArrowLeft' || event.key === 'Home'
      ? 'control'
      : event.key === 'ArrowRight' || event.key === 'End'
        ? 'cards'
        : null
    if (!next) return
    event.preventDefault()
    onChange(next)
    requestAnimationFrame(() => {
      document.getElementById(`kernel-device-${next}-tab`)?.focus()
    })
  }

  return (
    <div className={styles.tabs} role="tablist" aria-label="仪器设备功能">
      <button
        id="kernel-device-control-tab"
        type="button"
        role="tab"
        aria-selected={mode === 'control'}
        aria-controls="kernel-device-control-panel"
        tabIndex={mode === 'control' ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onChange('control')}
      >
        设备控制
      </button>
      <button
        id="kernel-device-cards-tab"
        type="button"
        role="tab"
        aria-selected={mode === 'cards'}
        aria-controls="kernel-device-cards-panel"
        tabIndex={mode === 'cards' ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onChange('cards')}
      >
        自定义卡片
      </button>
    </div>
  )
}

/**
 * 解析仪器设备初始页签，并兼容旧的 `section=cards` 深链。
 *
 * @returns 旧卡片深链返回 cards，其他入口返回设备控制。
 */
function initialDevicePanelMode(): DevicePanelMode {
  if (typeof globalThis.location === 'undefined') return 'control'
  return new URLSearchParams(globalThis.location.search).get('section') === 'cards'
    ? 'cards'
    : 'control'
}

export {
  DeviceActionAvailability,
  DeviceLockControl,
  UnlockConfirmationDialog
} from '@unilab/device-management'
