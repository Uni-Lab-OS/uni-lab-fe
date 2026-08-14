import { useState } from 'react'

import { DeviceCardWorkbenchPreview } from './DeviceCardWorkbenchPreview'
import { DeviceCardWorkbenchSidebar } from './DeviceCardWorkbenchSidebar'
import styles from './DeviceCardWorkbench.module.scss'
import type { useDeviceCardWorkbench } from './useDeviceCardWorkbench'
import PlatformCapabilityNotice from '../PlatformCapabilityNotice'

export type DeviceCardWorkbenchModel = ReturnType<
  typeof useDeviceCardWorkbench
>

/**
 * 编排设备卡片工作台的导航与预览区域。
 *
 * @param props 设备卡片工作台模型。
 * @returns 桌面端工作台或 Web 环境不可用提示。
 */
export function DeviceCardWorkbenchView({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  if (!model.desktopAvailable) return <DesktopUnavailable />

  return (
    <section className={`${styles.page} ${sidebarCollapsed ? styles.pageCollapsed : ''}`}>
      {!sidebarCollapsed ? <DeviceCardWorkbenchSidebar model={model} /> : null}
      <DeviceCardWorkbenchPreview
        model={model}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(value => !value)}
      />
    </section>
  )
}

/**
 * 说明设备卡片开发依赖完整 Workbench 的本地能力。
 *
 * @returns 带依赖边界说明的不可用状态。
 */
function DesktopUnavailable(): React.JSX.Element {
  return (
    <PlatformCapabilityNotice
      title="请在 Uni-Lab Workbench 中开发设备卡片"
      description="启动完整 Workbench 后，可选择源码目录、预览卡片并安装到本机。"
      dependency="设备卡片开发需要 Workbench 的本地后端读取源码目录、启动受控预览进程并安装产物；当前界面不能直接访问这些本地能力。"
    />
  )
}
