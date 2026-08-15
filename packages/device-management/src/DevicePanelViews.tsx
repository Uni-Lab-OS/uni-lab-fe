import type { DeviceAction, WorkflowActionNodeTemplate } from '@unilab/services'

import type { ManagedDevice } from './deviceCatalog'
import { deviceClass } from './deviceStyles'
import type { DeviceManagementConnection } from './types'
import {
  DeviceActionAvailability,
  deviceActionReadiness,
  ignoreUnavailableDeviceActionRun,
  type DeviceActionRunState
} from './DeviceActionAvailability'
import {
  DeviceLockControl,
  type UnlockOperation
} from './DeviceLockControls'
import {
  ActionParameterForm,
  DeviceIcon,
  Metric,
  formatTime,
  type ArgumentDraft
} from './DevicePanelPresentation'

export function ConnectionSummary({
  connection,
  backendName,
  lastUpdated
}: {
  connection: DeviceManagementConnection
  backendName: string
  lastUpdated: number | null
}): React.JSX.Element {
  const state =
    connection === 'connected'
      ? 'is-online'
      : connection === 'connecting'
        ? 'is-pending'
        : 'is-offline'
  const label =
    connection === 'connected'
      ? 'Edge 已连接'
      : connection === 'connecting'
        ? '正在连接 Edge'
        : connection === 'error'
          ? 'Edge 连接失败'
          : 'Edge 未连接'
  return (
    <div className={deviceClass('edge-device__connection')}>
      <span className={deviceClass('edge-device__connection-state', state)}>
        <span aria-hidden="true" />
        {label}
      </span>
      <small>
        {lastUpdated
          ? `更新于 ${formatTime(lastUpdated)}`
          : backendName}
      </small>
    </div>
  )
}

export function DeviceListItem({
  device,
  selected,
  onSelect
}: {
  device: ManagedDevice
  selected: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  const lockedActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
  return (
    <li>
      <button
        type="button"
        className={deviceClass('edge-device__device-item', selected && 'is-active')}
        aria-pressed={selected}
        onClick={() => onSelect(device.id)}
      >
        <span className={deviceClass('edge-device__device-icon')}>
          <DeviceIcon device={device} />
        </span>
        <span className={deviceClass('edge-device__device-copy')}>
          <span className={deviceClass('device-list__row')}>
            <span
              className={deviceClass('device-list__status', device.online ? 'is-online' : 'is-offline')}
            />
            <span className={deviceClass('device-list__name')}>{device.displayName}</span>
            {lockedActionCount ? (
              <span className={deviceClass('edge-device__list-lock')}>
                已锁定
              </span>
            ) : null}
          </span>
          <span className={deviceClass('device-list__key')}>
            {device.actions.length} 个动作
            {lockedActionCount ? ` · ${lockedActionCount} 个占用` : ''}
          </span>
        </span>
        <span className={deviceClass('edge-device__chevron')} aria-hidden="true">›</span>
      </button>
    </li>
  )
}

/**
 * 渲染当前设备的动作目录与单动作调试工作区。
 *
 * @param props 设备、动作选择、运行能力与任务操作回调。
 * @returns 保持动作目录和调试区稳定布局的设备工作区。
 * @throws 不主动抛出异常；运行和解锁失败由上层状态呈现。
 * @safety 零动作设备只展示禁用的运行入口，不会构造或提交任务。
 */
export function DeviceWorkspace({
  device,
  selectedAction,
  selectedActionRef,
  argumentDraft,
  onSelectAction,
  onArgumentChange,
  actionTemplate,
  actionCatalogLoading,
  actionCatalogError,
  canRunActionTask,
  connection,
  runState,
  activeRunActionRef,
  onRunAction,
  onCancelActionTask,
  canForceUnlock,
  unlockOperation,
  onRequestUnlock
}: {
  device: ManagedDevice
  selectedAction: DeviceAction | null
  selectedActionRef: string | null
  argumentDraft: ArgumentDraft
  onSelectAction: (actionRef: string) => void
  onArgumentChange: (name: string, value: string | boolean) => void
  actionTemplate: WorkflowActionNodeTemplate | null
  actionCatalogLoading: boolean
  actionCatalogError: string | null
  canRunActionTask: boolean
  connection: DeviceManagementConnection
  runState: DeviceActionRunState | null
  activeRunActionRef: string | null
  onRunAction: (
    action: DeviceAction,
    template: WorkflowActionNodeTemplate
  ) => void
  onCancelActionTask: (taskUuid: string) => void
  canForceUnlock: boolean
  unlockOperation: UnlockOperation | null
  onRequestUnlock: (device: ManagedDevice, action: DeviceAction) => void
}): React.JSX.Element {
  const lockedActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
  return (
    <div className={deviceClass('edge-device__workspace')} data-device-management="workspace">
      <header className={deviceClass('edge-device__identity')} data-device-management="identity">
        <span className={deviceClass('edge-device__identity-icon')}>
          <DeviceIcon device={device} />
        </span>
        <div>
          <div className={deviceClass('edge-device__identity-title')}>
            <h2>{device.displayName}</h2>
          </div>
          <p>{device.deviceKey || `${device.namespace}/${device.id}`}</p>
        </div>
        <div className={deviceClass('edge-device__identity-states')}>
          {lockedActionCount ? (
            <span className={deviceClass('edge-device__status-badge is-locked')}>
              已锁定 · {lockedActionCount} 个动作
            </span>
          ) : null}
          <span
            className={deviceClass('edge-device__status-badge', device.online ? 'is-online' : 'is-offline')}
          >
            {device.online ? '在线' : '离线'}
          </span>
        </div>
      </header>

      <div className={deviceClass('edge-device__metrics')} aria-label="设备目录信息">
        <Metric
          label="设备名称"
          value={device.machineName}
        />
        <Metric label="Edge 身份" value={device.namespace || '—'} />
        <Metric label="动作节点" value={`${device.actions.length}`} />
        <Metric
          label="当前状态"
          value={lockedActionCount
            ? `${lockedActionCount} 个动作占用`
            : device.online ? '可编排' : '不可用'}
          tone={lockedActionCount
            ? 'warning'
            : device.online ? 'success' : 'muted'}
        />
      </div>

      <div className={deviceClass('edge-device__content')}>
        <section className={deviceClass('edge-device__action-section')} data-device-management="action-section">
          <div className={deviceClass('edge-device__section-heading')}>
            <div>
              <span>动作目录</span>
              <h3>Edge 上报的动作节点</h3>
            </div>
            <small>{device.actions.length} 个</small>
          </div>
          {device.actions.length ? (
            <div className={deviceClass('edge-device__action-list')}>
              {device.actions.map((action, index) => (
                <button
                  key={action.actionRef}
                  type="button"
                  className={deviceClass('edge-device__action-node', action.actionRef === selectedActionRef && 'is-active')}
                  data-device-management="action-node"
                  aria-pressed={action.actionRef === selectedActionRef}
                  aria-label={`${action.displayName} 动作节点`}
                  title={action.displayName}
                  disabled={
                    activeRunActionRef !== null &&
                    action.actionRef !== activeRunActionRef
                  }
                  onClick={() => onSelectAction(action.actionRef)}
                >
                  <span className={deviceClass('edge-device__node-index')}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={deviceClass('edge-device__node-copy')}>
                    <strong>{action.displayName}</strong>
                    <code>{action.actionRef}</code>
                  </span>
                  <span
                    className={deviceClass('edge-device__node-state', action.isBusy ? 'is-busy' : 'is-ready')}
                  >
                    {action.isBusy ? '占用中' : '空闲'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={deviceClass('edge-device__no-actions')}>
              Edge 已上报该设备，但没有可调试的动作节点。
            </div>
          )}
        </section>

        <section className={deviceClass('edge-device__debug-section')} data-device-management="debug-section">
          {selectedAction ? (
            <>
              <div className={deviceClass('edge-device__section-heading')}>
                <div>
                  <span>动作参数预览</span>
                  <h3 title={selectedAction.displayName}>
                    {selectedAction.displayName}
                  </h3>
                </div>
                <code>{selectedAction.actionName}</code>
              </div>
              <DeviceLockControl
                action={selectedAction}
                canForceUnlock={canForceUnlock}
                operation={unlockOperation}
                onRequestUnlock={() => {
                  onRequestUnlock(device, selectedAction)
                }}
              />
              <ActionParameterForm
                action={selectedAction}
                draft={argumentDraft}
                disabled={
                  runState?.kind === 'submitting' ||
                  runState?.kind === 'accepted' ||
                  runState?.kind === 'running' ||
                  runState?.kind === 'finishing'
                }
                onChange={onArgumentChange}
              />
              <DeviceActionAvailability
                state={runState ?? deviceActionReadiness({
                  action: selectedAction,
                  device,
                  template: actionTemplate,
                  canRunActionTask,
                  connection,
                  catalogLoading: actionCatalogLoading,
                  catalogError: actionCatalogError
                })}
                onRun={() => {
                  if (actionTemplate) onRunAction(selectedAction, actionTemplate)
                }}
                onCancel={onCancelActionTask}
              />
            </>
          ) : device.actions.length === 0 ? (
            <DeviceActionAvailability
              state={{
                kind: 'unavailable',
                reason: 'no_actions',
                message: '该设备没有可运行的动作'
              }}
              disabledRunLabel="运行此动作"
              onRun={ignoreUnavailableDeviceActionRun}
            />
          ) : (
            <div className={deviceClass('edge-device__no-actions')}>
              选择一个动作节点后配置参数并运行。
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
