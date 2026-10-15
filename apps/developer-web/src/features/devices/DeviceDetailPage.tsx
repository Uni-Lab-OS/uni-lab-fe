import { clsx } from 'clsx'
import deviceDetailPageStyles from './DeviceDetailPage.module.scss'
import devicePageStyles from './DevicePage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Alert, Button, Space, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  applyActionPresentation,
  deviceActionParameters,
  deviceActionParametersFromSchema,
  deviceDispatchStatus,
  deviceOccupancyStatus,
  findActionPresentation,
} from '@unilab-fe/core'
import type { DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { StatusBadge } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { useDeviceActionPresentations } from '../../hooks/useDeviceActionPresentations'
import { DeviceActionGroups } from './DeviceActionGroups'
import { DeviceActionRunResult } from './DeviceActionRunResult'
import { deviceActionTaskName, startDeviceActionRun } from './deviceActionDispatch'
import { DeviceDetailHeader } from './DeviceDetailHeader'
import { DeviceActionDefinitionPanel } from './DeviceActionDefinitionPanel'

export function DeviceDetail({
  device,
  startDebug = false,
  onBack,
}: {
  device: DeviceSummary
  startDebug?: boolean
  onBack: () => void
}) {
  const [selectedAction, setSelectedAction] = useState<DeviceActionState | null>(
    device.actions[0] ?? null,
  )
  const [debugEditing, setDebugEditing] = useState(false)
  const [parameterView, setParameterView] = useState<'form' | 'schema'>('form')
  const [accepted, setAccepted] = useState<{ taskUuid: string; jobUuid: string } | null>(null)
  const [quickRunning, setQuickRunning] = useState(false)
  const [quickError, setQuickError] = useState<string | null>(null)
  const { backend } = useBackend()
  const autoOpenedDebug = useRef(false)
  const selectedActionUuid = selectedAction?.actionDefinitionUuid ?? ''
  const definitionQuery = useBackendQuery(`action-definition-${selectedActionUuid}`, (current) =>
    selectedActionUuid
      ? current.core.deviceActions.getActionDefinition(selectedActionUuid)
      : Promise.resolve(undefined),
  )
  const actionDefinition = definitionQuery.data
  const occupancyStatus = deviceOccupancyStatus(device)
  const { presentations, error: presentationError } = useDeviceActionPresentations()
  const presentation = selectedAction
    ? findActionPresentation(presentations, device.deviceKey, selectedAction.actionName)
    : undefined
  const actionParameters = useMemo(() => {
    const defined = deviceActionParameters(actionDefinition)
    const rawSchema = selectedAction?.raw.inputSchema ?? selectedAction?.raw.input_schema
    const base =
      defined.length || actionDefinition
        ? defined
        : rawSchema && typeof rawSchema === 'object'
          ? deviceActionParametersFromSchema(rawSchema as Record<string, unknown>)
          : []
    // 中文标签、范围、枚举、点位来自设备包展示元数据；参数集合仍以 OS Schema 为准。
    return applyActionPresentation(base, presentation)
  }, [actionDefinition, selectedAction, presentation])

  useEffect(() => {
    if (!startDebug || autoOpenedDebug.current || !selectedAction) return
    autoOpenedDebug.current = true
    setDebugEditing(true)
    setParameterView('form')
  }, [selectedAction, startDebug])

  useEffect(() => {
    setDebugEditing(false)
    setParameterView('form')
  }, [selectedActionUuid])

  const selectAction = (action: DeviceActionState) => {
    setSelectedAction(action)
    setAccepted(null)
    setDebugEditing(false)
    setParameterView('form')
  }
  const toggleDebug = () => {
    setAccepted(null)
    setQuickError(null)
    setDebugEditing((value) => !value)
    setParameterView('form')
  }

  const dispatchStatus = deviceDispatchStatus(device)
  const canDispatch =
    dispatchStatus === 'available' &&
    Boolean(selectedAction?.actionDefinitionUuid) &&
    presentation?.executable !== false
  const blockedReason =
    dispatchStatus === 'offline'
      ? '设备离线'
      : dispatchStatus === 'blocked'
        ? '设备当前不可调度'
        : dispatchStatus === 'unknown'
          ? '设备可调度状态未知'
          : presentation?.executable === false
            ? '该动作尚未注册为可执行能力'
            : !selectedAction?.actionDefinitionUuid
              ? '动作定义尚未同步'
              : ''
  // 无参数的查看/计算类动作一键执行、直接出结果，不必先打开参数表单。
  const quickRunnable =
    (presentation?.category === 'read' || presentation?.category === 'compute') &&
    actionParameters.length === 0
  const quickRun = async () => {
    if (!selectedAction || !canDispatch) return
    setAccepted(null)
    setQuickError(null)
    setQuickRunning(true)
    try {
      setAccepted(
        await startDeviceActionRun(backend, {
          device,
          action: selectedAction,
          param: {},
          description: deviceActionTaskName(device, presentation?.label ?? selectedAction.label),
        }),
      )
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : '动作下发失败')
    } finally {
      setQuickRunning(false)
    }
  }

  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        devicePageStyles['device-detail-page'],
        appShellStyles['device-detail-page'],
      )}
    >
      <DeviceDetailHeader device={device} occupancyStatus={occupancyStatus} onBack={onBack} />
      <div className={clsx(deviceDetailPageStyles['detail-columns'])}>
        <section className={clsx(deviceDetailPageStyles['detail-sidebar'])}>
          <div
            className={clsx(deviceDetailPageStyles['section-title'], sharedStyles['section-title'])}
          >
            <h2>动作</h2>
            <span>{device.actions.length} 个动作</span>
          </div>
          <div className={clsx(deviceDetailPageStyles['detail-sidebar__action-list'])}>
            <DeviceActionGroups
              actions={device.actions}
              presentations={presentations}
              deviceKey={device.deviceKey}
              selectedActionRef={selectedAction?.actionRef}
              onSelectAction={selectAction}
            />
          </div>
        </section>
        <section className={clsx(deviceDetailPageStyles['detail-main'])}>
          <div
            className={clsx(
              deviceDetailPageStyles['section-title'],
              sharedStyles['section-title'],
              deviceDetailPageStyles['detail-main__action-heading'],
            )}
          >
            <div>
              <Tooltip title={selectedAction?.label} placement="topLeft">
                <span className={clsx(deviceDetailPageStyles['action-detail-title'])}>
                  {selectedAction?.label ?? '未选择动作'}
                </span>
              </Tooltip>
            </div>
            <Space size={8}>
              {selectedAction?.isBusy && (
                <StatusBadge status="running" className={clsx(sharedStyles['status-badge'])} />
              )}
              <Tooltip title={!debugEditing && blockedReason ? `${blockedReason}，不能下发` : undefined}>
                <Button
                  className={clsx(deviceDetailPageStyles['detail-main__debug-button'])}
                  type={debugEditing ? 'default' : 'primary'}
                  disabled={!selectedAction || (!debugEditing && !canDispatch)}
                  loading={quickRunning}
                  onClick={quickRunnable && !debugEditing ? () => void quickRun() : toggleDebug}
                >
                  {debugEditing ? '退出' : quickRunnable ? '执行' : '填写参数并下发'}
                </Button>
              </Tooltip>
            </Space>
          </div>
          {dispatchStatus !== 'available' && (
            <Alert
              type={dispatchStatus === 'unknown' ? 'warning' : 'error'}
              showIcon
              message={`${blockedReason}，当前不能下发动作`}
              description={
                device.dispatchBlockReason ??
                '请确认 OS 已连接现场设备（PLC、机械臂、液位），或是否以离线模式（PTLC_CONNECT_PLC=0）启动。'
              }
              style={{ marginBottom: 12 }}
            />
          )}
          {quickError && (
            <Alert
              type="error"
              showIcon
              message="动作下发失败"
              description={quickError}
              style={{ marginBottom: 12 }}
            />
          )}
          {presentationError && (
            <Alert
              type="warning"
              showIcon
              message="动作展示元数据读取失败，参数按 OS Schema 显示"
              description={presentationError.message}
              style={{ marginBottom: 12 }}
            />
          )}
          <DeviceActionDefinitionPanel
            device={device}
            presentation={presentation}
            presentations={presentations}
            selectedAction={selectedAction}
            actionDefinition={actionDefinition}
            actionParameters={actionParameters}
            definitionQuery={definitionQuery}
            debugEditing={debugEditing}
            parameterView={parameterView}
            onParameterViewChange={setParameterView}
            onCancelDebug={() => setDebugEditing(false)}
            onAccepted={(result) => {
              setAccepted(result)
              setDebugEditing(false)
            }}
          />
          {accepted && (
            <DeviceActionRunResult taskUuid={accepted.taskUuid} presentation={presentation} />
          )}
        </section>
      </div>
    </div>
  )
}
