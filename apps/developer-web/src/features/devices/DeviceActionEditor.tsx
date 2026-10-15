import { clsx } from 'clsx'
import deviceActionEditorStyles from './DeviceActionEditor.module.scss'
import { Alert, Button, Form, Input, Modal, Tooltip } from 'antd'
import { type ReactNode, useEffect, useState } from 'react'
import {
  deviceActionDefaults,
  deviceActionParameters,
  deviceDispatchStatus,
  normalizeDeviceActionParameters,
} from '@unilab-fe/core'
import type { DeviceActionPresentation, DeviceActionState, DeviceSummary } from '@unilab-fe/core'
import { DeviceActionParameterFields } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'
import { AppIcon } from '../../components/ui/Icon'
import { deviceActionTaskName, startDeviceActionRun } from './deviceActionDispatch'

function DeviceMaterialLabel() {
  return (
    <span className={clsx(deviceActionEditorStyles['device-action-input-label'])}>
      <span>设备物料 UUID</span>
      <Tooltip title="动作任务绑定的当前设备资源" align={{ offset: [0, 0] }}>
        <span
          className={clsx(deviceActionEditorStyles['device-action-help-icon'])}
          aria-label="设备物料 UUID 说明"
        >
          <AppIcon name="general/help-circle" size={14} />
        </span>
      </Tooltip>
    </span>
  )
}

function ReadOnlyFieldTooltip({ children }: { readonly children: ReactNode }) {
  return (
    <div className={clsx(deviceActionEditorStyles['device-action-readonly-field'])}>{children}</div>
  )
}

export function DeviceActionEditor({
  device,
  action,
  parameters,
  editing,
  presentation,
  onCancel,
  onAccepted,
}: {
  device: DeviceSummary
  action: DeviceActionState | null
  parameters: ReturnType<typeof deviceActionParameters>
  editing: boolean
  presentation?: DeviceActionPresentation
  onCancel: () => void
  onAccepted: (result: { taskUuid: string; jobUuid: string }) => void
}) {
  const { backend } = useBackend()
  const [form] = Form.useForm<{
    materialUuid: string
    [key: string]: unknown
    description?: string
  }>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const canSubmit =
    deviceDispatchStatus(device) === 'available' &&
    Boolean(action?.actionDefinitionUuid) &&
    presentation?.executable !== false
  const taskName = deviceActionTaskName(device, presentation?.label ?? action?.label ?? '')
  useEffect(() => {
    setSubmitError(null)
    setParameterValues(deviceActionDefaults(parameters))
    form.resetFields()
    form.setFieldsValue({ materialUuid: device.materialUuid })
  }, [action?.actionRef, device.materialUuid, form, parameters])
  useEffect(() => {
    if (editing) return
    setParameterValues(deviceActionDefaults(parameters))
    form.resetFields()
    form.setFieldsValue({ materialUuid: device.materialUuid })
    setSubmitError(null)
  }, [device.materialUuid, editing, form, parameters])
  const submit = async (values: {
    materialUuid: string
    [key: string]: unknown
    description?: string
  }) => {
    if (!editing || !canSubmit || !action?.actionDefinitionUuid) return
    let param: Record<string, unknown>
    try {
      param = normalizeDeviceActionParameters({ ...values, ...parameterValues }, parameters)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '动作参数无效')
      return
    }
    if (presentation?.confirm && !(await confirmDispatch(taskName, presentation))) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      onAccepted(
        await startDeviceActionRun(backend, {
          device,
          action,
          param,
          description: values.description?.trim() || taskName,
        }),
      )
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '调试命令发送失败')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div
      className={clsx(
        deviceActionEditorStyles['device-action-editor'],
        editing ? 'is-editing' : '',
      )}
    >
      {submitError ? (
        <Alert
          type="error"
          showIcon
          message="调试命令发送失败"
          description={submitError}
          style={{ marginBottom: 18 }}
        />
      ) : null}
      {editing && deviceDispatchStatus(device) !== 'available' ? (
        <Alert
          type={deviceDispatchStatus(device) === 'unknown' ? 'warning' : 'error'}
          showIcon
          message={
            deviceDispatchStatus(device) === 'offline'
              ? '设备当前不在线，不能执行动作。'
              : deviceDispatchStatus(device) === 'blocked'
                ? '设备当前不可调度，不能执行动作。'
                : '设备可调度状态未知，不能执行动作。'
          }
          description={device.dispatchBlockReason ?? undefined}
          style={{ marginBottom: 18 }}
        />
      ) : null}
      {!action?.actionDefinitionUuid ? (
        <Alert
          type="info"
          showIcon
          message="动作定义尚未同步"
          description="已展示设备包声明的参数，但当前 OS 没有返回可执行的动作定义，因此暂不能发送。"
          style={{ marginBottom: 18 }}
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          materialUuid: device.materialUuid,
        }}
        onFinish={submit}
      >
        <div className={clsx(deviceActionEditorStyles['device-action-form-grid'])}>
          <ReadOnlyFieldTooltip>
            <Form.Item label={<DeviceMaterialLabel />} name="materialUuid">
              <Input disabled />
            </Form.Item>
          </ReadOnlyFieldTooltip>
          <DeviceActionParameterFields
            parameters={parameters}
            value={parameterValues}
            editable={editing}
            className={clsx(deviceActionEditorStyles['device-action-input-fields'])}
            onChange={(name, next) =>
              setParameterValues((current) => ({ ...current, [name]: next }))
            }
          />
        </div>
        {editing && (
          <Form.Item label="调试说明" name="description">
            <Input.TextArea rows={2} placeholder={`可选，缺省为任务名“${taskName}”`} />
          </Form.Item>
        )}
        {editing && (
          <div className={clsx(deviceActionEditorStyles['action-editor-actions'])}>
            <Button onClick={onCancel}>取消编辑</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={!canSubmit || submitting}
              icon={<AppIcon name="media/play" color={canSubmit ? 'white' : 'default'} size={16} />}
            >
              发送调试命令
            </Button>
          </div>
        )}
      </Form>
    </div>
  )
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 驱动、写参数、停止与调试类动作下发前的二次确认（同 PlatformUI“将向真实设备下发一次原子动作”）。 */
function confirmDispatch(taskName: string, presentation: DeviceActionPresentation): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: `下发：${taskName}`,
      content: presentation.hint || '将向真实设备下发一次原子动作，请确认现场安全条件已满足。',
      okText: '确认下发',
      cancelText: '取消',
      okButtonProps: { danger: presentation.category !== 'read' && presentation.category !== 'compute' },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}
