import type { WorkflowInputParameter } from '@unilab-fe/core'

export type WorkflowInputValues = Readonly<Record<string, unknown>>

export interface WorkflowInputFormProps {
  readonly parameters: readonly WorkflowInputParameter[]
  readonly value: WorkflowInputValues
  readonly onChange: (value: WorkflowInputValues) => void
  readonly disabled?: boolean
  readonly errors?: Readonly<Record<string, string | undefined>>
}

/** 工作流输入的受控视图，最终规范化由 core 场景负责。 */
export function WorkflowInputForm({
  parameters,
  value,
  onChange,
  disabled = false,
  errors = {},
}: WorkflowInputFormProps) {
  if (parameters.length === 0) {
    return (
      <p className="lab-ui-form-empty">
        该工作流没有声明需要填写的运行参数。
      </p>
    )
  }

  const setValue = (name: string, next: unknown) => {
    onChange({ ...value, [name]: next })
  }

  return (
    <div className="lab-ui-workflow-input-form">
      {parameters.map((parameter) => (
        <WorkflowInputField
          key={parameter.name}
          parameter={parameter}
          value={value[parameter.name]}
          disabled={disabled}
          error={errors[parameter.name]}
          onChange={(next) => setValue(parameter.name, next)}
        />
      ))}
    </div>
  )
}

function WorkflowInputField({
  parameter,
  value,
  disabled,
  error,
  onChange,
}: {
  readonly parameter: WorkflowInputParameter
  readonly value: unknown
  readonly disabled: boolean
  readonly error?: string
  readonly onChange: (value: unknown) => void
}) {
  const label = parameter.title || parameter.name

  return (
    <label className="lab-ui-form-field">
      <span className="lab-ui-form-field__label">
        <span>
          {label}
          {parameter.required ? ' *' : ''}
        </span>
        <code>{parameter.name}</code>
      </span>
      {renderInput(parameter, value, disabled, onChange)}
      {parameter.description && <small>{parameter.description}</small>}
      {error && <span className="lab-ui-form-field__error">{error}</span>}
    </label>
  )
}

function renderInput(
  parameter: WorkflowInputParameter,
  value: unknown,
  disabled: boolean,
  onChange: (value: unknown) => void,
) {
  const schema = parameter.schema
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined

  if (enumValues) {
    return (
      <select
        disabled={disabled}
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

  if (schema.type === 'boolean') {
    return (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    )
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <input
        type="number"
        disabled={disabled}
        value={stringValue(value)}
        min={numberValue(schema.minimum)}
        max={numberValue(schema.maximum)}
        step={schema.type === 'integer' ? 1 : 'any'}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  if (isStructuredInput(schema)) {
    const isResource = schema.$slot === 'ResourceSlot'
    return (
      <textarea
        disabled={disabled}
        value={stringValue(value)}
        rows={isResource ? 1 : 4}
        placeholder={isResource ? '输入资源 UUID' : '请输入 JSON'}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  return (
    <input
      disabled={disabled}
      value={stringValue(value)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}

function isStructuredInput(schema: Readonly<Record<string, unknown>>) {
  return (
    schema.$slot === 'ResourceSlot' ||
    schema.type === 'object' ||
    schema.type === 'array'
  )
}

function stringValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
