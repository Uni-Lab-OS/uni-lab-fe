import { clsx } from 'clsx'
import deviceDetailPageStyles from './DeviceDetailPage.module.scss'
import { Alert, Segmented, Spin, Typography } from 'antd'
import type { ActionDefinition, DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { ActionDefinitionMeta, ActionSchemaView } from './DeviceActionDefinition'
import { DeviceActionEditor, isRecord } from './DeviceActionEditor'
import { deviceActionParameters } from './DeviceActionInputFields'

export function DeviceActionDefinitionPanel({
  device,
  selectedAction,
  actionDefinition,
  actionParameters,
  definitionQuery,
  debugEditing,
  parameterView,
  onParameterViewChange,
  onCancelDebug,
  onAccepted,
}: {
  device: DeviceSummary
  selectedAction: DeviceActionState | null
  actionDefinition?: ActionDefinition
  actionParameters: ReturnType<typeof deviceActionParameters>
  definitionQuery: { loading: boolean; error?: Error }
  debugEditing: boolean
  parameterView: 'form' | 'schema'
  onParameterViewChange: (value: 'form' | 'schema') => void
  onCancelDebug: () => void
  onAccepted: (result: { taskUuid: string; jobUuid: string }) => void
}) {
  if (definitionQuery.loading && !actionDefinition && actionParameters.length === 0) {
    return <Typography.Text type="secondary">正在读取动作定义...</Typography.Text>
  }
  if (definitionQuery.error && actionParameters.length === 0) {
    return (
      <Alert
        type="error"
        showIcon
        message="动作定义读取失败"
        description={definitionQuery.error.message}
      />
    )
  }
  if (!selectedAction) return <Typography.Text type="secondary">当前设备没有动作</Typography.Text>

  return (
    <div
      className={clsx(
        deviceDetailPageStyles['definition-view-shell'],
        definitionQuery.loading ? deviceDetailPageStyles['is-loading'] : '',
      )}
      aria-busy={definitionQuery.loading}
    >
      {definitionQuery.loading && (
        <span className={clsx(deviceDetailPageStyles['definition-view-shell__loading'])}>
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
      <div className={clsx(deviceDetailPageStyles['action-parameter-toolbar'])}>
        <Segmented
          size="middle"
          value={parameterView}
          disabled={debugEditing}
          onChange={(value) => onParameterViewChange(value as 'form' | 'schema')}
          options={[
            { label: '参数', value: 'form' },
            { label: 'Schema', value: 'schema' },
          ]}
        />
        {debugEditing && <Typography.Text type="secondary">调试模式：参数可编辑</Typography.Text>}
      </div>
      {parameterView === 'schema' ? (
        <ActionSchemaView
          definition={actionDefinition}
          fallbackSchema={
            isRecord(selectedAction.raw.inputSchema)
              ? selectedAction.raw.inputSchema
              : isRecord(selectedAction.raw.input_schema)
                ? selectedAction.raw.input_schema
                : undefined
          }
        />
      ) : (
        <DeviceActionEditor
          action={selectedAction}
          device={device}
          parameters={actionParameters}
          editing={debugEditing}
          onCancel={onCancelDebug}
          onAccepted={onAccepted}
        />
      )}
    </div>
  )
}
