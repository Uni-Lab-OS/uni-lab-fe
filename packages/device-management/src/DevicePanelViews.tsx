import type {
  DeviceAction,
  DeviceExecutionOccupancy,
  WorkflowActionNodeTemplate
} from '@unilab/services'

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
import { shortIdentifier } from './devicePanelFormat'

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

/**
 * 渲染一个设备列表项，并分别呈现连接、派发与可用占用事实。
 *
 * @param props 当前设备、选中状态和选择回调。
 * @returns 可访问的设备选择按钮。
 */
export function DeviceListItem({
  device,
  selected,
  onSelect
}: {
  device: ManagedDevice
  selected: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  const busyActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
  const occupancy = device.executionOccupancies?.[0] ?? null
  const edgeLabel = edgeStatusLabel(device.edgeStatus)
  return (
    <li>
      <button
        type="button"
        className={deviceClass('edge-device__device-item', selected && 'is-active')}
        aria-pressed={selected}
        aria-label={`${device.displayName}，${edgeLabel}，${device.dispatchable ? '可调度' : '派发受阻'}${occupancy ? '，存在执行占用' : ''}`}
        onClick={() => onSelect(device.id)}
      >
        <span className={deviceClass('edge-device__device-icon')}>
          <DeviceIcon device={device} />
        </span>
        <span className={deviceClass('edge-device__device-copy')}>
          <span className={deviceClass('device-list__row')}>
            <span
              className={deviceClass('device-list__status', edgeStatusClass(device.edgeStatus))}
              aria-hidden="true"
            />
            <span className={deviceClass('device-list__name')}>{device.displayName}</span>
            {!device.dispatchable && device.edgeStatus === 'online' ? (
              <span className={deviceClass('edge-device__list-lock is-blocked')}>
                派发受阻
              </span>
            ) : null}
            {occupancy ? (
              <span className={deviceClass('edge-device__list-lock', occupancy.state === 'uncertain' && 'is-uncertain')}>
                执行占用
              </span>
            ) : null}
            {!occupancy && busyActionCount ? (
              <span className={deviceClass('edge-device__list-lock')}>
                动作占用
              </span>
            ) : null}
          </span>
          <span className={deviceClass('device-list__key')}>
            {edgeLabel} · {device.actions.length} 个动作
            {occupancy ? ` · Job ${shortIdentifier(occupancy.workflowNodeJobUuid)}` : ''}
            {!occupancy && busyActionCount ? ` · ${busyActionCount} 个动作占用` : ''}
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
  const busyActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
  const occupancy = device.executionOccupancies?.[0] ?? null
  const schedulingStatus = device.edgeStatus !== 'online'
    ? '等待 Edge 连接'
    : device.dispatchable ? '可调度' : '派发受阻'
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
          {busyActionCount ? (
            <span className={deviceClass('edge-device__status-badge is-locked')}>
              动作占用 · {busyActionCount} 个
            </span>
          ) : null}
          {occupancy ? (
            <span className={deviceClass(
              'edge-device__status-badge is-locked',
              occupancy.state === 'uncertain' && 'is-uncertain'
            )}>
              执行占用 · Job {shortIdentifier(occupancy.workflowNodeJobUuid)}
            </span>
          ) : null}
          {!device.dispatchable && device.edgeStatus === 'online' ? (
            <span className={deviceClass('edge-device__status-badge is-blocked')}>
              派发受阻
            </span>
          ) : null}
          <span
            className={deviceClass('edge-device__status-badge', edgeStatusClass(device.edgeStatus))}
          >
            {edgeStatusLabel(device.edgeStatus)}
          </span>
        </div>
      </header>

      <div className={deviceClass('edge-device__tabs')} role="tablist" aria-label="设备详情">
        <button type="button" role="tab" aria-selected="true">设备动作</button>
        <button type="button" role="tab" aria-selected="false" disabled>初始化配置</button>
      </div>

      <section className={deviceClass('edge-device__status-section')}>
        <div className={deviceClass('edge-device__status-heading')}>
          <strong>设备实时状态</strong>
          <small>运行时刷新</small>
        </div>
        <div className={deviceClass('edge-device__metrics')} aria-label="设备目录信息">
        <Metric
          label="设备名称"
          value={device.machineName}
        />
        <Metric label="设备实例 ID" value={device.namespace || '—'} />
        <Metric
          label="调度状态"
          value={schedulingStatus}
          tone={device.dispatchable
            ? 'success'
            : device.edgeStatus === 'online' ? 'warning' : 'muted'}
        />
        <Metric
          label="执行占用"
          value={occupancy
            ? `${occupancyStateLabel(occupancy.state)} · Job ${shortIdentifier(occupancy.workflowNodeJobUuid)}`
            : busyActionCount
              ? `${busyActionCount} 个动作占用`
              : device.edgeStatus !== 'online'
                ? '等待 Edge 连接'
                : device.executionOccupancies === null
                  ? '—'
                  : '空闲'}
          tone={occupancy || busyActionCount ? 'warning' : 'muted'}
        />
        </div>
      </section>

      <div className={deviceClass('edge-device__content')}>
        <section className={deviceClass('edge-device__action-section')} data-device-management="action-section">
          <div className={deviceClass('edge-device__section-heading')}>
            <div>
              <h3>设备动作</h3>
              <span>来自 Edge 上报的动作节点</span>
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
                  {action.isBusy ||
                  occupancy ||
                  device.edgeStatus !== 'online' ||
                  action.busyStatusKnown !== false ||
                  device.executionOccupancies !== null ? (
                    <span
                      title={device.edgeStatus !== 'online'
                        ? 'Edge 连接后读取动作占用状态'
                        : undefined}
                      className={deviceClass(
                        'edge-device__node-state',
                        action.isBusy || occupancy
                          ? 'is-busy'
                          : device.edgeStatus !== 'online'
                            ? 'is-unknown'
                            : 'is-ready'
                      )}
                    >
                      {action.isBusy
                        ? '动作占用'
                        : occupancy
                          ? '设备占用'
                          : device.edgeStatus !== 'online'
                            ? '等待连接'
                            : '空闲'}
                    </span>
                  ) : null}
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
                  <h3 title={selectedAction.displayName}>
                    {selectedAction.displayName}
                  </h3>
                  <span>动作参数预览</span>
                </div>
                <code>{selectedAction.actionName}</code>
              </div>
              <DeviceExecutionOccupancySummary
                occupancies={device.executionOccupancies}
              />
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

/**
 * 展示设备级执行占用持有者；不提供手动解锁，避免越过物理结算边界。
 *
 * @param props Authority 明确返回的设备执行占用摘要；null 表示未提供。
 * @returns 有占用时返回状态区域，否则不渲染。
 */
export function DeviceExecutionOccupancySummary({
  occupancies
}: {
  occupancies: DeviceExecutionOccupancy[] | null
}): React.JSX.Element | null {
  const occupancy = occupancies?.[0]
  if (!occupancy) return null
  const uncertain = occupancy.state === 'uncertain'
  return (
    <div
      className={deviceClass(
        'edge-device__occupancy-panel',
        uncertain && 'is-uncertain'
      )}
      role={uncertain ? 'alert' : 'status'}
    >
      <div className={deviceClass('edge-device__occupancy-copy')}>
        <strong>{occupancyStateLabel(occupancy.state)}</strong>
        <p>
          {uncertain
            ? '设备执行结果尚未确认，需要完成安全核验后才能释放占用。'
            : '设备正在处理既有作业；新任务仍可提交，并由调度器等待执行占用。'}
        </p>
      </div>
      <code title={occupancy.workflowNodeJobUuid}>
        Job {shortIdentifier(occupancy.workflowNodeJobUuid)}
      </code>
      {occupancies.length > 1 ? (
        <small>另有 {occupancies.length - 1} 条占用摘要</small>
      ) : null}
    </div>
  )
}

/** 返回 Edge 连接状态的用户可见标签。 */
function edgeStatusLabel(status: ManagedDevice['edgeStatus']): string {
  if (status === 'online') return '在线'
  if (status === 'registered') return '已注册，未连接'
  return '离线'
}

/** 返回 Edge 连接状态对应的既有状态样式。 */
function edgeStatusClass(status: ManagedDevice['edgeStatus']): string {
  if (status === 'online') return 'is-online'
  if (status === 'registered') return 'is-pending'
  return 'is-offline'
}

/** 返回设备执行占用状态的中文说明。 */
function occupancyStateLabel(
  state: DeviceExecutionOccupancy['state']
): string {
  if (state === 'reserved') return '已预备占用'
  if (state === 'running') return '运行中占用'
  return '不确定占用'
}
