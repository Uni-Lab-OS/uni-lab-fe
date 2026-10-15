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
  deviceOccupancyStatus,
  findActionPresentation,
} from '@unilab-fe/core'
import type { DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { StatusBadge } from '@unilab/lab-ui'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { useDeviceActionPresentations } from '../../hooks/useDeviceActionPresentations'
import { DeviceActionGroups } from './DeviceActionGroups'
import { DeviceActionRunResult } from './DeviceActionRunResult'
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
    setDebugEditing((value) => !value)
    setParameterView('form')
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
              <Button
                className={clsx(deviceDetailPageStyles['detail-main__debug-button'])}
                type={debugEditing ? 'default' : 'primary'}
                disabled={!selectedAction}
                onClick={toggleDebug}
              >
                {debugEditing
                  ? '退出'
                  : presentation?.category === 'read' || presentation?.category === 'compute'
                    ? '执行'
                    : '调试动作'}
              </Button>
            </Space>
          </div>
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
