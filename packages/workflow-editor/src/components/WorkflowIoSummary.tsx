import type {
  WorkflowIoMetadata,
  WorkflowOutputBinding,
  WorkflowValueSchema
} from '@unilab/services'

interface WorkflowIoSummaryProps {
  io: WorkflowIoMetadata
}

export function WorkflowIoSummary({
  io
}: WorkflowIoSummaryProps): React.JSX.Element {
  return (
    <section
      className="persistent-authoring__io-summary"
      aria-label="已应用的工作流输入与输出"
    >
      <IoList title="输入参数">
        {io.input_contract.parameters.map((parameter) => (
          <li key={parameter.name}>
            <div className="persistent-authoring__io-name">
              <code>{parameter.name}</code>
              <span>{schemaLabel(parameter.schema)}</span>
            </div>
            <div className="persistent-authoring__io-properties">
              <span>{parameter.required ? '必填' : '选填'}</span>
              {'default' in parameter && (
                <span>默认值：{jsonLabel(parameter.default)}</span>
              )}
              {isNullable(parameter.schema) && <span>允许为空</span>}
            </div>
          </li>
        ))}
      </IoList>

      <IoList title="输出参数">
        {io.output_contract.outputs.map((output) => (
          <li key={output.name}>
            <div className="persistent-authoring__io-name">
              <code>{output.name}</code>
              <span>{schemaLabel(output.schema)}</span>
            </div>
            <div className="persistent-authoring__io-properties">
              {output.implicit && <span>系统生成</span>}
              <span>{bindingLabel(io.output_bindings[output.name])}</span>
            </div>
          </li>
        ))}
      </IoList>
    </section>
  )
}

function IoList({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h3>{title}</h3>
      <ol>{children}</ol>
    </section>
  )
}

function bindingLabel(binding: WorkflowOutputBinding | undefined): string {
  if (!binding) return '尚未绑定'
  if (binding.kind === 'workflow_input') {
    return `工作流输入：${binding.parameter}`
  }
  return [
    '节点输出',
    `节点 UUID：${binding.workflow_node_uuid}`,
    `端口 UUID：${binding.source_handle_uuid}`
  ].join(' · ')
}

function isNullable(schema: WorkflowValueSchema): boolean {
  return 'anyOf' in schema
}

function schemaLabel(schema: WorkflowValueSchema): string {
  if ('anyOf' in schema) return `${schemaLabel(schema.anyOf[0])} · 可空`
  if ('$slot' in schema) return '资源位'
  if (schema.type === 'array') return `列表<${schemaLabel(schema.items)}>`
  const labels: Record<string, string> = {
    string: '文本',
    integer: '整数',
    number: '数值',
    boolean: '布尔值',
    object: '对象'
  }
  return labels[schema.type] ?? schema.type
}

function jsonLabel(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  const encoded = JSON.stringify(value)
  return encoded === undefined ? '未定义' : encoded
}
