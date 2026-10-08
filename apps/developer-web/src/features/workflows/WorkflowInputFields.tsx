import { cx } from './workflowClassNames'
import { Form, Input, InputNumber, Select, Switch } from 'antd'
import type { WorkflowInputParameter } from '@unilab-fe/core'

interface WorkflowInputFieldsProps {
  readonly parameters: readonly WorkflowInputParameter[]
}

export { normalizeWorkflowInput, workflowInputDefaults } from '@unilab-fe/core'

export function WorkflowInputFields({ parameters }: WorkflowInputFieldsProps) {
  if (parameters.length === 0) {
    return <div className={cx('workflow-input-empty')}>该工作流没有声明需要填写的运行参数。</div>
  }

  return (
    <div className={cx('workflow-input-fields')}>
      {parameters.map((parameter) => (
        <WorkflowInputField key={parameter.name} parameter={parameter} />
      ))}
    </div>
  )
}

function WorkflowInputField({ parameter }: { readonly parameter: WorkflowInputParameter }) {
  const schema = parameter.schema
  const label = parameterLabel(parameter)
  const itemProps = {
    label: <ParameterLabel parameter={parameter} />,
    name: ['workflowInput', parameter.name],
    rules: parameter.required ? [{ required: true, message: `请输入${label}` }] : undefined,
    extra: parameter.description,
  }
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null

  if (enumValues) {
    return (
      <Form.Item {...itemProps}>
        <Select
          showSearch
          optionFilterProp="label"
          allowClear={!parameter.required}
          options={enumValues.map((value) => ({
            label: String(value),
            value: value as string | number | boolean,
          }))}
          placeholder={`请选择${label}`}
        />
      </Form.Item>
    )
  }

  if (schema.type === 'boolean') {
    return (
      <Form.Item {...itemProps} valuePropName="checked">
        <Switch />
      </Form.Item>
    )
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <Form.Item {...itemProps}>
        <InputNumber
          className={cx('full-input')}
          min={numberValue(schema.minimum)}
          max={numberValue(schema.maximum)}
          step={schema.type === 'integer' ? 1 : undefined}
          placeholder={`请输入${label}`}
        />
      </Form.Item>
    )
  }

  if (schema.$slot === 'ResourceSlot') {
    return (
      <Form.Item {...itemProps}>
        <Input placeholder="输入资源 UUID" />
      </Form.Item>
    )
  }

  if (schema.type === 'object' || schema.type === 'array') {
    return (
      <Form.Item {...itemProps}>
        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="请输入 JSON" />
      </Form.Item>
    )
  }

  return (
    <Form.Item {...itemProps}>
      <Input placeholder={`请输入${label}`} />
    </Form.Item>
  )
}

function ParameterLabel({ parameter }: { readonly parameter: WorkflowInputParameter }) {
  return (
    <span className={cx('workflow-input-label')}>
      <span>{parameterLabel(parameter)}</span>
      <code>{parameter.name}</code>
    </span>
  )
}

function parameterLabel(parameter: WorkflowInputParameter): string {
  return parameter.title || parameter.name
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
