import { cx } from './deviceClassNames'
import { Input } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { DeviceSummary } from '@unilab-fe/core'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { DeviceDetail } from './DeviceDetailPage'
import { DeviceTable } from './DeviceTable'

export function DevicesPage() {
  const query = useBackendQuery('devices', (backend) => backend.core.deviceActions.listDevices())
  const [selected, setSelected] = useState<DeviceSummary | null>(null)
  const [debugDeviceUuid, setDebugDeviceUuid] = useState(() =>
    new URLSearchParams(window.location.search).get('debugDevice'),
  )
  const [startDebug, setStartDebug] = useState(false)
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(
    () =>
      (query.data ?? []).filter((device) =>
        `${device.label} ${device.deviceKey}`.toLowerCase().includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  )
  useEffect(() => {
    if (!debugDeviceUuid || !query.data || selected) return
    const device = query.data.find((item) => item.deviceUuid === debugDeviceUuid)
    if (!device) return
    setSelected(device)
    setStartDebug(true)
    // 入口参数只消费一次，返回设备列表后不能再次触发自动选中。
    setDebugDeviceUuid(null)
    window.history.replaceState({}, '', '/devices')
  }, [debugDeviceUuid, query.data, selected])

  if (selected)
    return (
      <DeviceDetail
        device={selected}
        startDebug={startDebug}
        onBack={() => {
          setSelected(null)
          setStartDebug(false)
        }}
      />
    )
  return (
    <div className={cx('page-stack devices-list-page')}>
      <PageHeader
        title="设备"
        actions={
          <Input
            className={cx('search-input device-page-search')}
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索设备名称或设备键"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && rows.length === 0}
        emptyDescription={keyword ? '没有匹配的设备' : '后端没有返回设备'}
        variant="table"
        tableColumns={5}
      >
        <section className={cx('data-section')}>
          <DeviceTable rows={rows} onView={setSelected} />
        </section>
      </AsyncState>
    </div>
  )
}
