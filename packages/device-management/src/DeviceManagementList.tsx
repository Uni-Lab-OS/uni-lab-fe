import * as React from 'react'

import { ConnectionSummary } from './DevicePanelSupport'
import styles from './DeviceCatalogList.module.scss'
import type { ManagedDevice } from './deviceCatalog'
import type { DeviceManagementPanelProps } from './types'
import { useDevices } from './useDevices'

export interface DeviceManagementListProps extends Omit<
  DeviceManagementPanelProps,
  'selectedDeviceId' | 'onSelectedDeviceChange'
> {
  onOpenActions?: (deviceId: string) => void
}

/**
 * 渲染只读设备管理目录，不混入设备详情或动作表单。
 *
 * @param props 当前服务连接和可选的单点调试跳转回调。
 * @returns 设备状态列表、连接诊断、刷新和动作调试入口。
 * @throws 目录错误由 useDevices 投影为可见错误状态。
 * @safety 本页面不运行设备动作；跳转时只传递稳定设备 ID。
 */
export function DeviceManagementList({
  services,
  backend,
  connection,
  backendEnabled = true,
  onOpenActions
}: DeviceManagementListProps): React.JSX.Element {
  const { devices, loading, error, lastUpdated, refresh } = useDevices({
    services,
    backendEnabled,
    connection
  })

  return (
    <section className={styles.catalog} data-device-management="list">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>DEVICE MANAGEMENT / 设备管理</span>
          <h1>设备管理</h1>
          <p>查看当前 Authority 提供的设备连接、派发与执行占用事实。</p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          disabled={loading || connection !== 'connected'}
          onClick={() => { void refresh() }}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
          {loading ? '同步中…' : '刷新设备'}
        </button>
      </header>

      <div className={styles.summary}>
        <ConnectionSummary
          connection={connection}
          backendName={backend.name}
          lastUpdated={lastUpdated}
        />
        <div className={styles.metrics}>
          <Metric label="设备总数" value={devices.length} />
          <Metric
            label="在线"
            value={devices.filter(device => device.edgeStatus === 'online').length}
            tone="success"
          />
          <Metric
            label="派发受阻"
            value={devices.filter(device => !device.dispatchable).length}
            tone="warning"
          />
          <Metric
            label="执行占用"
            value={devices.filter(hasExecutionOccupancy).length}
            tone="primary"
          />
        </div>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          <div><strong>设备目录不可用</strong><span>{error}</span></div>
          <button type="button" onClick={() => { void refresh() }}>重新读取</button>
        </div>
      ) : devices.length === 0 && !loading ? (
        <div className={styles.empty}>
          <span className="codicon codicon-circuit-board" aria-hidden="true" />
          <strong>{connection === 'connected' ? '当前没有设备' : '等待设备连接'}</strong>
          <p>设备会从当前工作区设备包和设备图中发现；本页面不维护另一份设备台账。</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>设备</th>
                <th>设备标识</th>
                <th>连接</th>
                <th>调度状态</th>
                <th>动作</th>
                <th><span className={styles.srOnly}>操作</span></th>
              </tr>
            </thead>
            <tbody>
              {devices.map(device => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  onOpenActions={onOpenActions}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && devices.length === 0 ? (
        <div className={styles.loading} role="status">正在读取设备目录…</div>
      ) : null}
    </section>
  )
}

/** 渲染设备管理表中的单个只读事实行。 */
function DeviceRow({
  device,
  onOpenActions
}: {
  device: ManagedDevice
  onOpenActions?: (deviceId: string) => void
}): React.JSX.Element {
  const occupied = hasExecutionOccupancy(device)
  return (
    <tr>
      <td>
        <div className={styles.identity}>
          <span className={styles.deviceIcon} aria-hidden="true">
            <span className="codicon codicon-circuit-board" />
          </span>
          <span><strong>{device.displayName}</strong><small>{device.namespace}</small></span>
        </div>
      </td>
      <td><code>{device.deviceKey}</code></td>
      <td>
        <StatusBadge
          tone={device.edgeStatus === 'online' ? 'success' : 'muted'}
          label={edgeStatusLabel(device.edgeStatus)}
        />
      </td>
      <td>
        <StatusBadge
          tone={occupied ? 'primary' : device.dispatchable ? 'success' : 'warning'}
          label={occupied ? '执行占用' : device.dispatchable ? '可派发' : '派发受阻'}
        />
      </td>
      <td>{device.actions.length} 个</td>
      <td className={styles.actionCell}>
        {onOpenActions ? (
          <button type="button" onClick={() => onOpenActions(device.id)}>
            单点调试
            <span className="codicon codicon-arrow-right" aria-hidden="true" />
          </button>
        ) : null}
      </td>
    </tr>
  )
}

/** 返回设备是否存在 OS 权威提供的执行占用。 */
function hasExecutionOccupancy(device: ManagedDevice): boolean {
  return Boolean(device.executionOccupancies?.length)
}

/** 将 Edge 连接枚举转换为用户可读短文案。 */
function edgeStatusLabel(status: ManagedDevice['edgeStatus']): string {
  if (status === 'online') return '在线'
  if (status === 'registered') return '已注册'
  return '离线'
}

/** 渲染设备目录上方的汇总数字。 */
function Metric({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: number
  tone?: 'default' | 'success' | 'warning' | 'primary'
}): React.JSX.Element {
  return <span className={styles.metric} data-tone={tone}><small>{label}</small><strong>{value}</strong></span>
}

/** 渲染不承载交互的设备状态标签。 */
function StatusBadge({
  label,
  tone
}: {
  label: string
  tone: 'success' | 'warning' | 'primary' | 'muted'
}): React.JSX.Element {
  return <span className={styles.badge} data-tone={tone}><i aria-hidden="true" />{label}</span>
}
