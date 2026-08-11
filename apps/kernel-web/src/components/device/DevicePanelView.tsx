import type {
  BackendConfig,
  DeviceAction,
  WorkflowActionNodeTemplate
} from '@unilab/services'

import type { ManagedDevice } from '../../data/deviceCatalog'
import type { ConnectionStatus } from '../../data/lab'
import {
  ConnectionSummary,
  DeviceListItem,
  DeviceWorkspace,
  UnlockConfirmationDialog,
  type ArgumentDraft,
  type DeviceActionRunState,
  type UnlockIntent,
  type UnlockOperation
} from './DevicePanelSupport'

interface DevicePanelViewProps {
  backend: BackendConfig
  connection: ConnectionStatus
  devices: ManagedDevice[]
  loading: boolean
  error: string | null
  lastUpdated: number | null
  selectedDevice: ManagedDevice | null
  selectedAction: DeviceAction | null
  selectedActionRef: string | null
  argumentDraft: ArgumentDraft
  actionTemplate: WorkflowActionNodeTemplate | null
  actionCatalogLoading: boolean
  actionCatalogError: string | null
  canRunActionTask: boolean
  canForceUnlock: boolean
  runState: DeviceActionRunState | null
  activeRunActionRef: string | null
  unlockIntent: UnlockIntent | null
  unlockOperation: UnlockOperation | null
  refresh: () => Promise<void>
  onSelectDevice: (deviceId: string) => void
  onSelectAction: (actionRef: string) => void
  onOpenRobotPoints: () => void
  onArgumentChange: (name: string, value: string | boolean) => void
  onRunAction: (
    action: DeviceAction,
    template: WorkflowActionNodeTemplate
  ) => void
  onCancelActionTask: (taskUuid: string) => void
  onRequestUnlock: (device: ManagedDevice, action: DeviceAction) => void
  onDismissUnlock: () => void
  onConfirmUnlock: () => void
}

/** 渲染 Edge 设备目录、动作工作区和人工解锁确认框。 */
export function DevicePanelView(props: DevicePanelViewProps): React.JSX.Element {
  const {
    backend,
    connection,
    devices,
    loading,
    error,
    lastUpdated,
    selectedDevice,
    selectedAction,
    selectedActionRef,
    argumentDraft,
    actionTemplate,
    actionCatalogLoading,
    actionCatalogError,
    canRunActionTask,
    canForceUnlock,
    runState,
    activeRunActionRef,
    unlockIntent,
    unlockOperation,
    refresh,
    onSelectDevice,
    onSelectAction,
    onOpenRobotPoints,
    onArgumentChange,
    onRunAction,
    onCancelActionTask,
    onRequestUnlock,
    onDismissUnlock,
    onConfirmUnlock
  } = props

  return (
    <>
      <section
        className={`section section--split device-page edge-device${
          devices.length ? '' : ' is-empty'
        }`}
      >
        <aside className="section__list" aria-label="Edge 设备列表">
          <header className="section__list-head edge-device__list-head">
            <div>
              <h1 className="section__list-title">仪器设备</h1>
              <span className="section__list-meta">
                {devices.length} 台设备 · Edge 实时上报
              </span>
            </div>
            <button
              type="button"
              className="edge-device__refresh"
              disabled={loading || connection !== 'connected'}
              onClick={() => void refresh()}
            >
              {loading ? '同步中' : '刷新'}
            </button>
          </header>
          <ConnectionSummary
            connection={connection}
            backendName={backend.name}
            lastUpdated={lastUpdated}
          />
          {loading && devices.length === 0 ? (
            <div className="device-loading" role="status">
              正在读取 Edge 设备与动作目录…
            </div>
          ) : null}
          {error ? (
            <div className="edge-device__load-error" role="alert">
              <strong>设备目录不可用</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()}>
                重新读取
              </button>
            </div>
          ) : null}
          {devices.length === 0 ? (
            <div className="device-empty device-empty--compact">
              <strong>
                {connection === 'connected'
                  ? '当前未配置仪器设备'
                  : '等待 Edge 上报设备'}
              </strong>
              {connection === 'connected' ? (
                <p>
                  Edge 核心服务已连接。安装或配置设备包和设备图后，重新启动 Edge 并刷新设备。
                </p>
              ) : (
                <p>
                  Edge 连接后会自动上报在线设备、动作节点及其参数 Schema。
                </p>
              )}
            </div>
          ) : (
            <ul className="device-list">
              {devices.map((device) => (
                <DeviceListItem
                  key={device.id}
                  device={device}
                  selected={device.id === selectedDevice?.id}
                  onSelect={onSelectDevice}
                />
              ))}
            </ul>
          )}
          <div className="edge-device__source-note">
            <span>数据来源</span>
            设备、在线状态、动作与结果均来自 Edge 实时上报。
          </div>
        </aside>

        <main className="section__detail edge-device__detail">
          {selectedDevice ? (
            <DeviceWorkspace
              device={selectedDevice}
              selectedAction={selectedAction}
              selectedActionRef={selectedActionRef}
              argumentDraft={argumentDraft}
              onSelectAction={onSelectAction}
              onOpenRobotPoints={onOpenRobotPoints}
              onArgumentChange={onArgumentChange}
              actionTemplate={actionTemplate}
              actionCatalogLoading={actionCatalogLoading}
              actionCatalogError={actionCatalogError}
              canRunActionTask={canRunActionTask}
              connection={connection}
              runState={runState}
              activeRunActionRef={activeRunActionRef}
              onRunAction={onRunAction}
              onCancelActionTask={onCancelActionTask}
              canForceUnlock={canForceUnlock}
              unlockOperation={unlockOperation}
              onRequestUnlock={onRequestUnlock}
            />
          ) : (
            <div className="device-empty device-empty--detail">
              <strong>暂无可调试设备</strong>
              <p>
                {connection === 'connected'
                  ? '当前可继续使用 Edge 核心服务；配置仪器设备后请重新启动并刷新。'
                  : '请确认 Edge 已启动。'}
              </p>
            </div>
          )}
        </main>
      </section>
      {unlockIntent ? (
        <UnlockConfirmationDialog
          intent={unlockIntent}
          operation={unlockOperation}
          onCancel={onDismissUnlock}
          onConfirm={onConfirmUnlock}
        />
      ) : null}
    </>
  )
}
