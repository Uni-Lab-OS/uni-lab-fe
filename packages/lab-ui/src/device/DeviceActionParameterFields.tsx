import { cx } from '../classNames'
import {
  isDeviceActionResourceParameter,
  isDeviceActionStructuredParameter,
} from '@unilab-fe/core'
import type { DeviceActionParameter } from '@unilab-fe/core'

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
    return <div className={cx('device-action-input-empty')}>该动作没有声明可填写的参数。</div>
  }

  return (
    <div
      className={cx('device-action-input-fields', 'lab-ui-device-action-input-fields', className)}
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
    <label className={cx('device-action-field-slot')}>
      <span className={cx('device-action-input-label')}>
        <span>
          {parameter.title}
          {parameter.required && <span className={cx('lab-ui-required-mark')} aria-hidden="true"> *</span>}
        </span>
        {parameter.title !== parameter.name && <code>{parameter.name}</code>}
      </span>
      {renderInput(parameter, value, editable, onChange)}
      {parameter.description && (
        <small className={cx('device-action-input-description')}>
          {parameter.description}
        </small>
      )}
      {error && <span className={cx('device-action-input-error')}>{error}</span>}
    </label>
  )
}

function renderInput(
  parameter: DeviceActionParameter,
  value: unknown,
  editable: boolean,
  onChange: (value: unknown) => void,
) {
  const enumValues = Array.isArray(parameter.schema.enum)
    ? parameter.schema.enum
    : undefined

  if (enumValues) {
    return (
      <select
        disabled={!editable}
        value={stringValue(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {!parameter.required && <option value="">请选择</option>}
        {enumValues.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    )
  }

  const type = schemaType(parameter.schema)
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        disabled={!editable}
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    )
  }

  if (type === 'number' || type === 'integer') {
    return (
      <input
        type="number"
        readOnly={!editable}
        value={stringValue(value)}
        min={numberValue(parameter.schema.minimum)}
        max={numberValue(parameter.schema.maximum)}
        step={type === 'integer' ? 1 : 'any'}
        onChange={(event) => onChange(numberInputValue(event.currentTarget.value))}
      />
    )
  }

  if (isDeviceActionResourceParameter(parameter)) {
    return (
      <input
        readOnly={!editable}
        value={stringValue(value)}
        placeholder="输入资源 UUID"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  if (isDeviceActionStructuredParameter(parameter)) {
    return (
      <textarea
        readOnly={!editable}
        value={stringValue(value)}
        rows={4}
        placeholder="请输入 JSON"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  return (
    <input
      readOnly={!editable}
      value={stringValue(value)}
      placeholder={`请输入${parameter.title}`}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}

function schemaType(schema: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    return schema.type.find(
      (item): item is string =>
        typeof item === 'string' && item !== 'null',
    )
  }
  return undefined
}

function stringValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberInputValue(value: string): number | string {
  if (value === '') return ''
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}
