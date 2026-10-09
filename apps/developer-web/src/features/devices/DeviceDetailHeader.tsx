import { clsx } from 'clsx'
import { Button, Tag, Tooltip } from 'antd'
import type { DeviceSummary } from '@unilab-fe/core'
import deviceDetailHeaderStyles from './DeviceDetailHeader.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { AppIcon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'

export function DeviceDetailHeader({
  device,
  occupancyStatus,
  onBack,
}: {
  device: DeviceSummary
  occupancyStatus: 'occupied' | 'idle' | 'unknown'
  onBack: () => void
}) {
  const connectionLabel =
    device.online === false ? '离线' : device.online === true ? '在线' : '连接未知'
  const occupancyLabel =
    occupancyStatus === 'occupied' ? '占用' : occupancyStatus === 'idle' ? '空闲' : '占用未知'
  return (
    <PageHeader
      title={
        <span className={clsx(deviceDetailHeaderStyles['device-detail-title'])}>
          <Tooltip title={device.label} placement="bottomLeft">
            <span className={clsx(deviceDetailHeaderStyles['device-detail-title__name'])}>
              {device.label}
            </span>
          </Tooltip>
          <Tag
            color={
              device.online === false ? 'default' : device.online === true ? 'success' : undefined
            }
          >
            {connectionLabel}
          </Tag>
          <Tag
            color={
              occupancyStatus === 'occupied'
                ? 'warning'
                : occupancyStatus === 'idle'
                  ? 'processing'
                  : 'default'
            }
          >
            {occupancyLabel}
          </Tag>
        </span>
      }
      leading={
        <Button
          className={clsx(sharedStyles['page-header-back'])}
          type="text"
          aria-label="返回设备"
          icon={<AppIcon name="arrows/arrow-left" size={18} />}
          onClick={onBack}
        />
      }
    />
  )
}
