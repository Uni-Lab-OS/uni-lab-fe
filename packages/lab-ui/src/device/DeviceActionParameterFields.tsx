import { clsx } from 'clsx'
import deviceStyles from '../device.module.scss'
import reagentStyles from '../reagent.module.scss'
import sharedStyles from '../shared.module.scss'
import { isDeviceActionResourceParameter } from '@unilab-fe/core'
import type { DeviceActionParameter } from '@unilab-fe/core'
import { SchemaInputField } from '../shared/SchemaInputField'

export interface DeviceActionParameterFieldsProps {
  readonly parameters: readonly DeviceActionParameter[]
  readonly value: Readonly<Record<string, unknown>>
  readonly onChange: (name: string, value: unknown) => void
  readonly editable?: boolean
  readonly errors?: Readonly<Record<string, string | undefined>>
  readonly className?: string
}

/** 设备动作参数的受控编辑器。它只负责输入形态，不负责校验提交或发送命令。 */
export function DeviceActionParameterFields({
  parameters,
  value,
  onChange,
  editable = true,
  errors = {},
  className,
}: DeviceActionParameterFieldsProps) {
  if (parameters.length === 0) {
    return (
      <div
        className={clsx(
          deviceStyles['device-action-input-empty'],
          reagentStyles['device-action-input-empty'],
        )}
      >
        该动作没有声明可填写的参数。
      </div>
    )
  }

  return (
    <div
      className={clsx(
        deviceStyles['device-action-input-fields'],
        deviceStyles['lab-ui-device-action-input-fields'],
        sharedStyles['lab-ui-device-action-input-fields'],
        className,
      )}
    >
      {parameters.map((parameter) => (
        <DeviceActionParameterField
          key={parameter.name}
          parameter={parameter}
          value={value[parameter.name]}
          editable={editable}
          error={errors[parameter.name]}
          onChange={(next) => onChange(parameter.name, next)}
        />
      ))}
    </div>
  )
}

function DeviceActionParameterField({
  parameter,
  value,
  editable,
  error,
  onChange,
}: {
  readonly parameter: DeviceActionParameter
  readonly value: unknown
  readonly editable: boolean
  readonly error?: string
  readonly onChange: (value: unknown) => void
}) {
  return (
    <SchemaInputField
      label={parameter.title}
      name={parameter.name}
      schema={parameter.schema}
      value={value}
      required={parameter.required}
      disabled={!editable}
      description={parameter.description}
      error={error}
      placeholder={`请输入${parameter.title}`}
      resource={isDeviceActionResourceParameter(parameter)}
      onChange={onChange}
    />
  )
}
