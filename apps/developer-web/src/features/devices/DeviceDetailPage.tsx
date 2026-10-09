import { clsx } from 'clsx'
import deviceDetailPageStyles from './DeviceDetailPage.module.scss'
import devicePageStyles from './DevicePage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Alert, Button, Space, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  deviceActionParameters,
  deviceActionParametersFromSchema,
  deviceOccupancyStatus,
} from '@unilab-fe/core'
import type { DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { DeviceActionList, StatusBadge } from '@unilab/lab-ui'
import { useBackendQuery } from '../../hooks/useBackendQuery'
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
  const actionParameters = useMemo(() => {
    const defined = deviceActionParameters(actionDefinition)
    if (defined.length || actionDefinition) return defined
    const rawSchema = selectedAction?.raw.inputSchema ?? selectedAction?.raw.input_schema
    return rawSchema && typeof rawSchema === 'object'
      ? deviceActionParametersFromSchema(rawSchema as Record<string, unknown>)
      : []
  }, [actionDefinition, selectedAction])

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
            <DeviceActionList
              actions={device.actions}
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
                {debugEditing ? '退出调试' : '调试动作'}
              </Button>
            </Space>
          </div>
          <DeviceActionDefinitionPanel
            device={device}
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
            <Alert
              className={clsx(deviceDetailPageStyles['accepted-result'])}
              type="info"
              showIcon
              message="调试命令已被 OS 接受"
              description={`Task ${accepted.taskUuid} / Job ${accepted.jobUuid}。接受不代表动作已经完成，请在任务页面读取运行状态。`}
            />
          )}
        </section>
      </div>
    </div>
  )
}
