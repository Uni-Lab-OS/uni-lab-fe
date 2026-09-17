import type {
  DeviceActionDeclarationDevice,
  WorkflowActionNodeTemplate
} from '@unilab/services'
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react'

import {
  writeWorkflowNodePaletteDragPayload,
  type WorkflowNodePaletteDragPayload
} from '../utils/workflowCanvasCommands'
import {
  projectExperimentOperationDeviceActions,
  type ExperimentOperationProjectedAction,
  type ExperimentOperationProjectedDevice
} from './experimentOperationDeviceCatalogProjection'
import { WorkflowButton } from './WorkflowButton'

export { projectExperimentOperationDeviceActions }

export interface ExperimentOperationDeviceCatalogPort {
  getDeviceActionDeclarations(
    signal?: AbortSignal
  ): Promise<DeviceActionDeclarationDevice[]>
}

export interface ExperimentOperationDeviceCatalogState {
  devices: readonly DeviceActionDeclarationDevice[]
  loading: boolean
  error: string | null
  refresh(): void
}

const DeviceCatalogContext = createContext<
  ExperimentOperationDeviceCatalogState | null
>(null)

export function ExperimentOperationDeviceCatalogProvider({
  value,
  children
}: PropsWithChildren<{
  value: ExperimentOperationDeviceCatalogState
}>): React.JSX.Element {
  return (
    <DeviceCatalogContext.Provider value={value}>
      {children}
    </DeviceCatalogContext.Provider>
  )
}

export function useExperimentOperationDeviceCatalog():
  ExperimentOperationDeviceCatalogState | null {
  return useContext(DeviceCatalogContext)
}

interface ExperimentOperationDeviceCatalogProps {
  devices: readonly DeviceActionDeclarationDevice[]
  templates: readonly WorkflowActionNodeTemplate[]
  query: string
  loading: boolean
  error: string | null
  disabled: boolean
  disabledReason: string
  onRefresh(): void
  onAddAction(templateUuid: string): void
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
}

/** 渲染 HTML 原型中的设备与动作树，所有节点仍从真实目录模板创建。 */
export function ExperimentOperationDeviceCatalog({
  devices,
  templates,
  query,
  loading,
  error,
  disabled,
  disabledReason,
  onRefresh,
  onPaletteDragStart
}: ExperimentOperationDeviceCatalogProps): React.JSX.Element {
  const projection = useMemo(
    () => projectExperimentOperationDeviceActions(devices, templates, query),
    [devices, query, templates]
  )
  const [collapsedDeviceIds, setCollapsedDeviceIds] = useState<Set<string>>(
    () => new Set()
  )
  const visibleActionCount = projection.devices.reduce(
    (total, device) => total + device.actions.length,
    0
  ) + projection.unboundTemplates.length

  return (
    <section
      className="experiment-operation-device-catalog"
      aria-label="设备与动作树"
    >
      <header className="experiment-operation-device-catalog__source">
        <span>唯一来源：<strong>设备动作模块</strong></span>
        <small>
          {projection.deviceCount} 台 · {projection.declaredActionCount} 项
        </small>
        <div>
          <button type="button" onClick={() => setCollapsedDeviceIds(new Set())}>
            全部展开
          </button>
          <button
            type="button"
            onClick={() => setCollapsedDeviceIds(new Set(
              projection.devices.map(device => device.deviceId)
            ))}
          >
            全部折叠
          </button>
          <WorkflowButton
            type="button"
            onClick={onRefresh}
            disabled={loading}
            disabledReason="设备与动作目录正在刷新"
          >
            刷新
          </WorkflowButton>
        </div>
      </header>

      {loading && devices.length === 0 && (
        <p className="experiment-operation-device-catalog__state" role="status">
          正在读取设备与动作声明…
        </p>
      )}
      {error && (
        <div className="experiment-operation-device-catalog__problem" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRefresh}>重新读取</button>
        </div>
      )}

      <div className="experiment-operation-device-catalog__tree" role="tree">
        {projection.devices.map(device => (
          <DeviceActionGroup
            key={device.deviceId}
            device={device}
            collapsed={collapsedDeviceIds.has(device.deviceId)}
            disabled={disabled}
            disabledReason={disabledReason}
            onPaletteDragStart={onPaletteDragStart}
            onToggle={() => setCollapsedDeviceIds(current => {
              const next = new Set(current)
              if (next.has(device.deviceId)) next.delete(device.deviceId)
              else next.add(device.deviceId)
              return next
            })}
          />
        ))}
      </div>

      {projection.unboundTemplates.length > 0 && (
        <section className="experiment-operation-device-catalog__unbound">
          <h4>未绑定设备实例的动作模板</h4>
          {projection.unboundTemplates.map(template => (
            <ActionButton
              key={template.uuid}
              action={{
                actionName: template.name,
                typeName: template.actionType,
                label: template.displayName || template.name,
                isBusy: false,
                template
              }}
              disabled={disabled}
              disabledReason={disabledReason}
              onPaletteDragStart={onPaletteDragStart}
            />
          ))}
        </section>
      )}

      {!loading && !error && visibleActionCount === 0 && (
        <p className="experiment-operation-device-catalog__state" role="status">
          未找到匹配的设备动作
        </p>
      )}
    </section>
  )
}

function DeviceActionGroup({
  device,
  collapsed,
  disabled,
  disabledReason,
  onPaletteDragStart,
  onToggle
}: {
  device: ExperimentOperationProjectedDevice
  collapsed: boolean
  disabled: boolean
  disabledReason: string
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
  onToggle(): void
}): React.JSX.Element {
  const stateLabel = !device.online
    ? '离线'
    : device.dispatchable ? '在线' : '不可调度'
  return (
    <section className="experiment-operation-device-catalog__device" role="group">
      <button
        type="button"
        role="treeitem"
        aria-expanded={!collapsed}
        onClick={onToggle}
        title={device.dispatchBlockReason ?? undefined}
      >
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        <span>
          <strong>{device.machineName}</strong>
          <small>{device.deviceKey}</small>
        </span>
        <span className={device.online && device.dispatchable ? 'is-online' : ''}>
          {stateLabel}
        </span>
        <small>{device.actions.length}</small>
      </button>
      {!collapsed && (
        <div role="group">
          {device.actions.map(action => (
            <ActionButton
              key={`${device.deviceId}:${action.actionName}:${action.typeName}`}
              action={action}
              disabled={disabled || !action.template}
              disabledReason={action.template
                ? disabledReason
                : '设备已声明动作，但缺少唯一可执行节点模板'}
              onPaletteDragStart={onPaletteDragStart}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ActionButton({
  action,
  disabled,
  disabledReason,
  onPaletteDragStart
}: {
  action: ExperimentOperationProjectedAction
  disabled: boolean
  disabledReason: string
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
}): React.JSX.Element {
  const templateUuid = action.template?.uuid ?? null
  return (
    <WorkflowButton
      type="button"
      className="experiment-operation-device-catalog__action"
      disabled={disabled}
      disabledReason={disabledReason}
      data-workflow-palette-action={templateUuid ?? undefined}
      draggable={!disabled && templateUuid !== null && !onPaletteDragStart}
      data-template-match={templateUuid ? 'matched' : 'missing'}
      onDragStart={event => {
        if (!templateUuid || disabled) return
        const payload = {
          kind: 'action',
          templateUuid
        } satisfies WorkflowNodePaletteDragPayload
        onPaletteDragStart?.(payload)
        writeWorkflowNodePaletteDragPayload(event.dataTransfer, payload)
      }}
      onPointerDown={event => {
        if (!templateUuid || disabled || !onPaletteDragStart) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        onPaletteDragStart({ kind: 'action', templateUuid })
      }}
    >
      <span aria-hidden="true">⌁</span>
      <span>
        <strong>{action.label}</strong>
        <small>{action.actionName}</small>
      </span>
      {action.isBusy ? <em>运行中</em> : null}
    </WorkflowButton>
  )
}
