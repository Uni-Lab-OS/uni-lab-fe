import { clsx } from 'clsx'
import sharedStyles from '../shared.module.scss'
import type { ReactNode } from 'react'

export interface SchemaInputFieldProps {
  readonly label: ReactNode
  readonly name?: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly value: unknown
  readonly required?: boolean
  readonly disabled?: boolean
  readonly description?: ReactNode
  readonly error?: ReactNode
  readonly placeholder?: string
  readonly resource?: boolean
  readonly onChange: (value: unknown) => void
}

/**
 * JSON Schema 输入字段的受控呈现。它只负责输入形态和值转换，
 * 必填校验、JSON 业务解析和命令提交由 workflow/device 场景负责。
 */
export function SchemaInputField({
  label,
  name,
  schema,
  value,
  required = false,
  disabled = false,
  description,
  error,
  placeholder,
  resource = false,
  onChange,
}: SchemaInputFieldProps) {
  const structured = isStructuredSchema(schema)
  const input = renderInput({
    schema,
    value,
    disabled,
    structured,
    resource,
    required,
    placeholder,
    onChange,
  })

  return (
    <label
      className={clsx(
        sharedStyles['lab-ui-form-field'],
        Boolean(error) && sharedStyles['lab-ui-form-field--error'],
      )}
    >
      <span className={clsx(sharedStyles['lab-ui-form-field__label'])}>
        <span>
          {label}
          {required && (
            <span className={clsx(sharedStyles['lab-ui-required-mark'])} aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </span>
        {name && name !== label && <code>{name}</code>}
      </span>
      {input}
      {description && <small>{description}</small>}
      {error && (
        <span className={clsx(sharedStyles['lab-ui-form-field__error'])} role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

function renderInput({
  schema,
  value,
  disabled,
  structured,
  resource,
  required,
  placeholder,
  onChange,
}: {
  readonly schema: Readonly<Record<string, unknown>>
  readonly value: unknown
  readonly disabled: boolean
  readonly structured: boolean
  readonly resource: boolean
  readonly required: boolean
  readonly placeholder?: string
  readonly onChange: (value: unknown) => void
}) {
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined
  if (enumValues) {
    return (
      <select
        disabled={disabled}
        value={stringValue(value)}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {!required && <option value="">请选择</option>}
        {enumValues.map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    )
  }

  const type = schemaType(schema)
  if (type === 'boolean') {
    return (
      <input
        type="checkbox"
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    )
  }

  if (type === 'number' || type === 'integer') {
    return (
      <input
        type="number"
        disabled={disabled}
        value={stringValue(value)}
        min={numberValue(schema.minimum)}
        max={numberValue(schema.maximum)}
        step={type === 'integer' ? 1 : 'any'}
        onChange={(event) => onChange(numberInputValue(event.currentTarget.value))}
      />
    )
  }

  if (resource) {
    return (
      <input
        disabled={disabled}
        value={stringValue(value)}
        placeholder={placeholder ?? '输入资源 UUID'}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  if (structured) {
    return (
      <textarea
        disabled={disabled}
        value={stringValue(value)}
        rows={4}
        placeholder={placeholder ?? '请输入 JSON'}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }

  return (
    <input
      disabled={disabled}
      value={stringValue(value)}
      placeholder={placeholder}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}

function isStructuredSchema(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.$slot === 'ResourceSlot' || schema.type === 'object' || schema.type === 'array'
}

function schemaType(schema: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    return schema.type.find((item): item is string => typeof item === 'string' && item !== 'null')
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
