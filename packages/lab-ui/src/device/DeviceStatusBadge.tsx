import { deviceDispatchStatus } from '@unilab-fe/core'
import type { DeviceSummary } from '@unilab-fe/core'

import { cx } from '../classNames'
export interface DeviceStatusBadgeProps {
  readonly device?: Pick<DeviceSummary, 'online' | 'dispatchable' | 'dispatchBlockReason'>
  readonly status?: 'offline' | 'blocked' | 'available' | 'unknown'
  readonly label?: string
}

/** 设备可调度状态的领域展示，不包含查询或调度命令。 */
export function DeviceStatusBadge({ device, status, label }: DeviceStatusBadgeProps) {
  const resolvedStatus = status ?? (device ? deviceDispatchStatus(device) : 'unknown')
  const tone = resolvedStatus === 'blocked' || resolvedStatus === 'unknown' ? 'attention' : resolvedStatus
  const resolvedLabel = label ?? defaultLabel(resolvedStatus, device?.dispatchBlockReason)
  return (
    <span className={cx('device-status', `device-status--${tone}`)}>
      <span className={cx('device-status__dot')} aria-hidden="true" />
      {resolvedLabel}
    </span>
  )
}

function defaultLabel(
  status: NonNullable<DeviceStatusBadgeProps['status']>,
  reason?: string | null,
) {
  if (status === 'offline') return reason ?? '离线'
  if (status === 'blocked') return reason ?? '不可调度'
  if (status === 'available') return '在线，可调试'
  return '状态未知'
}
