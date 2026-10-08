import { cx } from './deviceClassNames'
import { Alert, Button, Segmented, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deviceOccupancyStatus } from '@unilab-fe/core'
import type { DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { DeviceActionList } from '@unilab/lab-ui'
import { ActionDefinitionMeta, ActionSchemaView } from './DeviceActionDefinition'
import { DeviceActionEditor, isRecord } from './DeviceActionEditor'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { AppIcon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { deviceActionParameters, deviceActionParametersFromSchema } from './DeviceActionInputFields'

export function DeviceDetail({
  device,
  startDebug = false,
  onBack,
}: {
  device: DeviceSummary
  startDebug?: boolean
  onBack: () => void
}) {
  const { backend } = useBackend()
  const [selectedAction, setSelectedAction] = useState<DeviceActionState | null>(
    device.actions[0] ?? null,
  )
  const [debugEditing, setDebugEditing] = useState(false)
  const [parameterView, setParameterView] = useState<'form' | 'schema'>('form')
  const [accepted, setAccepted] = useState<{
    taskUuid: string
    jobUuid: string
  } | null>(null)
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
    return isRecord(rawSchema) ? deviceActionParametersFromSchema(rawSchema) : []
  }, [actionDefinition, selectedAction])
  useEffect(() => {
    if (startDebug && !autoOpenedDebug.current && selectedAction) {
      autoOpenedDebug.current = true
      setDebugEditing(true)
      setParameterView('form')
    }
  }, [selectedAction, startDebug])
  useEffect(() => {
    setDebugEditing(false)
    setParameterView('form')
  }, [selectedActionUuid])
  return (
    <div className={cx('page-stack device-detail-page')}>
      <PageHeader
        title={
          <span className={cx('device-detail-title')}>
            <Tooltip title={device.label} placement="bottomLeft">
              <span className={cx('device-detail-title__name')}>{device.label}</span>
            </Tooltip>
            <Tag
              color={
                device.online === false ? 'default' : device.online === true ? 'success' : undefined
              }
            >
              {device.online === false ? '离线' : device.online === true ? '在线' : '连接未知'}
            </Tag>
            <Tag
              color={
                occupancyStatus === 'occupied'
                  ? 'warning'
                  : occupancyStatus === 'idle'
                    ? 'processing'
                    : 'default'
              }
            >
              {occupancyStatus === 'occupied'
                ? '占用'
                : occupancyStatus === 'idle'
                  ? '空闲'
                  : '占用未知'}
            </Tag>
          </span>
        }
        leading={
          <Button
            className={cx('page-header-back')}
            type="text"
            aria-label="返回设备"
            icon={<AppIcon name="arrows/arrow-left" size={18} />}
            onClick={onBack}
          />
        }
      />
      <div className={cx('detail-columns')}>
        <section className={cx('detail-sidebar')}>
          <div className={cx('section-title')}>
            <h2>动作</h2>
            <span>{device.actions.length} 个动作</span>
          </div>
          <div className={cx('detail-sidebar__action-list')}>
            <DeviceActionList
              actions={device.actions}
              selectedActionRef={selectedAction?.actionRef}
              onSelectAction={(action) => {
                setSelectedAction(action)
                setAccepted(null)
                setDebugEditing(false)
                setParameterView('form')
              }}
            />
          </div>
        </section>
        <section className={cx('detail-main')}>
          <div className={cx('section-title detail-main__action-heading')}>
            <div>
              <Tooltip title={selectedAction?.label} placement="topLeft">
                <span className={cx('action-detail-title')}>
                  {selectedAction?.label ?? '未选择动作'}
                </span>
              </Tooltip>
            </div>
            <Space size={8}>
              {selectedAction?.isBusy && <StatusBadge status="running" />}
              <Button
                className={cx('detail-main__debug-button')}
                type={debugEditing ? 'default' : 'primary'}
                disabled={!selectedAction}
                icon={
                  <AppIcon
                    name={debugEditing ? 'arrows/arrow-left' : 'general/tool-01'}
                    color="inherit"
                    size={16}
                  />
                }
                onClick={() => {
                  setAccepted(null)
                  setDebugEditing((value) => !value)
                  setParameterView('form')
                }}
              >
                {debugEditing ? '退出调试' : '调试动作'}
              </Button>
            </Space>
          </div>
          {definitionQuery.loading && !actionDefinition && actionParameters.length === 0 ? (
            <Typography.Text type="secondary">正在读取动作定义...</Typography.Text>
          ) : definitionQuery.error && actionParameters.length === 0 ? (
            <Alert
              type="error"
              showIcon
              message="动作定义读取失败"
              description={definitionQuery.error.message}
            />
          ) : selectedAction ? (
            <div
              className={cx(`definition-view-shell ${definitionQuery.loading ? 'is-loading' : ''}`)}
              aria-busy={definitionQuery.loading}
            >
              {definitionQuery.loading && (
                <span className={cx('definition-view-shell__loading')}>
                  <Spin size="small" /> 更新中
                </span>
              )}
              {definitionQuery.error && (
                <Alert
                  type="warning"
                  showIcon
                  message="动作定义读取失败"
                  description={`${definitionQuery.error.message}，当前先展示设备包参数。`}
                  style={{ marginBottom: 18 }}
                />
              )}
              <ActionDefinitionMeta definition={actionDefinition} />
              <div className={cx('action-parameter-toolbar')}>
                <Segmented
                  size="middle"
                  value={parameterView}
                  disabled={debugEditing}
                  onChange={(value) => setParameterView(value as 'form' | 'schema')}
                  options={[
                    { label: '参数', value: 'form' },
                    { label: 'Schema', value: 'schema' },
                  ]}
                />
                {debugEditing && (
                  <Typography.Text type="secondary">调试模式：参数可编辑</Typography.Text>
                )}
              </div>
              {parameterView === 'schema' ? (
                <ActionSchemaView
                  definition={actionDefinition}
                  fallbackSchema={
                    isRecord(selectedAction?.raw.inputSchema)
                      ? selectedAction?.raw.inputSchema
                      : isRecord(selectedAction?.raw.input_schema)
                        ? selectedAction?.raw.input_schema
                        : undefined
                  }
                />
              ) : (
                <DeviceActionEditor
                  action={selectedAction}
                  device={device}
                  parameters={actionParameters}
                  editing={debugEditing}
                  onCancel={() => setDebugEditing(false)}
                  onAccepted={(result) => {
                    setAccepted(result)
                    setDebugEditing(false)
                  }}
                />
              )}
            </div>
          ) : (
            <Typography.Text type="secondary">当前设备没有动作</Typography.Text>
          )}
          {accepted && (
            <Alert
              className={cx('accepted-result')}
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
