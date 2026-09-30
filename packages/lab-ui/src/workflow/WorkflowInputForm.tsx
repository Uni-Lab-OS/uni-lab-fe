import type { WorkflowInputParameter } from '@unilab-fe/core'

import { cx } from '../classNames'
import { SchemaInputField } from '../shared/SchemaInputField'
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
    return <p className={cx('lab-ui-form-empty')}>该工作流没有声明需要填写的运行参数。</p>
  }

  const setValue = (name: string, next: unknown) => {
    onChange({ ...value, [name]: next })
  }

  return (
    <div className={cx('lab-ui-workflow-input-form')}>
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
    <SchemaInputField
      label={label}
      name={parameter.name}
      schema={parameter.schema}
      value={value}
      required={parameter.required}
      disabled={disabled}
      description={parameter.description}
      error={error}
      onChange={onChange}
    />
  )
}
