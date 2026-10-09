import { clsx } from 'clsx'
import devicePageStyles from './DevicePage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Table, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import type { DeviceSummary } from '@unilab-fe/core'
import { DeviceStatusBadge } from '@unilab/lab-ui'
import { EmptyState } from '@unilab/design-v2'
import { AppIcon } from '../../components/ui/Icon'
import { TableText } from '../../components/ui/TableText'

export function DeviceTable({
  rows,
  onView,
}: {
  rows: readonly DeviceSummary[]
  onView: (device: DeviceSummary) => void
}) {
  const columns: TableColumnsType<DeviceSummary> = [
    {
      title: '设备',
      key: 'device',
      width: 360,
      render: (_, row) => (
        <div className={clsx('device-cell')}>
          <button
            type="button"
            className={clsx(
              devicePageStyles['device-cell__name'],
              appShellStyles['device-cell__name'],
              sharedStyles['device-cell__name'],
            )}
            onClick={() => onView(row)}
          >
            <TableText text={row.label} />
          </button>
        </div>
      ),
    },
    {
      title: '动作',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, row) => (
        <span className={clsx(sharedStyles['muted-cell'])}>{row.actions.length} 个动作</span>
      ),
    },
    {
      title: '状态',
      key: 'state',
      align: 'center',
      render: (_, row) => <DeviceStatusBadge device={row} />,
    },
    {
      title: '当前动作',
      key: 'current',
      width: 170,
      align: 'center',
      render: (_, row) => {
        const busy = row.actions.find((action) => action.isBusy)
        return busy ? (
          <span className={clsx(sharedStyles['muted-cell'])}>{busy.label}</span>
        ) : (
          <span className={clsx(sharedStyles['muted-cell'])}>空闲</span>
        )
      },
    },
    {
      title: '操作',
      key: 'operation',
      align: 'center',
      width: 100,
      render: (_, row) => (
        <Tooltip title="查看设备">
          <Button
            className={clsx(sharedStyles['icon-button'])}
            type="text"
            icon={<AppIcon name="general/eye" size={18} />}
            aria-label={`查看设备 ${row.label}`}
            onClick={() => onView(row)}
          />
        </Tooltip>
      ),
    },
  ]
  return (
    <Table<DeviceSummary>
      rowKey="deviceUuid"
      className={clsx(devicePageStyles['device-table'])}
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无设备" /> }}
      pagination={{
        pageSize: 10,
        hideOnSinglePage: false,
        showSizeChanger: false,
        showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 台设备`,
      }}
    />
  )
}
