import type {
  WorkflowAuthoringAggregate,
  WorkflowInputDescriptor,
  WorkflowJsonValue,
  WorkflowValueSchema
} from '@unilab/services'

import {
  containsResourceSlotInput,
  createWorkflowTaskInputForm,
  isNullableWorkflowInputSchema,
  type WorkflowTaskInputFieldState,
  type WorkflowTaskInputFormState
} from '../utils/workflowTaskInputForm'
import {
  filterWorkflowResourceSlotOptions,
  type WorkflowResourceSlotOption,
  type WorkflowResourceSlotOptionsState
} from '../utils/workflowResourceSlotOptions'

interface WorkflowTaskInputFormProps {
  aggregate: WorkflowAuthoringAggregate
  form?: WorkflowTaskInputFormState
  busy?: boolean
  problem?: string | null
  resourceSlotOptions?: WorkflowResourceSlotOptionsState
  onChange: (name: string, state: WorkflowTaskInputFieldState) => void
  onSubmit?: () => void
  onCancel?: () => void
  onProblem?: (message: string | null) => void
}

export function WorkflowTaskInputForm({
  aggregate,
  form = createWorkflowTaskInputForm(aggregate),
  busy = false,
  problem = null,
  resourceSlotOptions,
  onChange,
  onSubmit,
  onCancel,
  onProblem
}: WorkflowTaskInputFormProps): React.JSX.Element {
  const update = (
    descriptor: WorkflowInputDescriptor,
    state: WorkflowTaskInputFieldState
  ): boolean => {
    try {
      onChange(descriptor.name, state)
      return true
    } catch (error) {
      onProblem?.(errorMessage(error))
      return false
    }
  }
  return (
    <section
      className="workflow-task-input-form"
      aria-label="工作流运行输入表单"
    >
      <header>
        <div>
          <strong>本次运行输入</strong>
          <span>使用已应用版本 {form.appliedRevision}</span>
        </div>
        <p>
          本次运行使用已应用版本；未覆盖的参数由 OS 使用固定默认值。
        </p>
      </header>

      {problem && <p className="workflow-runtime__problem" role="alert">{problem}</p>}

      {form.fields.length === 0 ? (
        <p>当前已应用的工作流没有外部输入。</p>
      ) : (
        <ol>
          {form.fields.map(({ descriptor, state }) => {
            const resourceSlot = containsResourceSlotInput(descriptor.schema)
            const compatibleResourceSlotOptions = resourceSlot
              ? compatibleOptions(descriptor.schema, resourceSlotOptions)
              : []
            const resourceSlotProblem = resourceSlot
              ? resourceSlotAvailabilityMessage(
                  resourceSlotOptions,
                  compatibleResourceSlotOptions
                )
              : null
            return (
              <li
                key={descriptor.name}
                data-workflow-task-input-name={descriptor.name}
              >
                <div className="workflow-task-input-form__identity">
                  <div className="workflow-task-input-form__heading">
                    <strong>{descriptor.title || descriptor.name}</strong>
                    <code>{schemaLabel(descriptor.schema)}</code>
                    {descriptor.required && <span>必填</span>}
                  </div>
                  {descriptor.description && <p>{descriptor.description}</p>}
                </div>
                <div className="workflow-task-input-form__default">
                  {Object.hasOwn(descriptor, 'default') ? (
                    <p>
                      默认值：<code>{jsonText(descriptor.default)}</code>
                    </p>
                  ) : (
                    <span>无默认值</span>
                  )}
                </div>
                <div className="workflow-task-input-form__control">
                  <label className="workflow-task-input-form__state">
                    本次取值
                    <select
                      aria-label={`${descriptor.name} 输入状态`}
                      value={state.kind}
                      disabled={busy}
                      onChange={(event) => update(
                        descriptor,
                        stateForKind(
                          descriptor.schema,
                          event.target.value,
                          compatibleResourceSlotOptions
                        )
                      )}
                    >
                      <option value="untouched">
                        {untouchedLabel(descriptor)}
                      </option>
                      <option
                        value="explicit_null"
                        disabled={!isNullableWorkflowInputSchema(
                          descriptor.schema
                        )}
                      >
                        传入空值
                      </option>
                      <option
                        value="value"
                        disabled={Boolean(resourceSlotProblem)}
                      >
                        自定义值
                      </option>
                    </select>
                  </label>
                  {resourceSlot ? (
                    renderWorkflowResourceSlotControl({
                      name: descriptor.name,
                      schema: descriptor.schema,
                      state,
                      options: compatibleResourceSlotOptions,
                      problem: resourceSlotProblem,
                      disabled: busy || state.kind === 'explicit_null',
                      onChange: (next) => update(descriptor, next)
                    })
                  ) : state.kind === 'value' ? (
                    <WorkflowValueControl
                      key={`${form.appliedRevision}:${state.kind}`}
                      name={descriptor.name}
                      schema={descriptor.schema}
                      value={state.value}
                      disabled={busy}
                      onChange={(value) => update(descriptor, {
                        kind: 'value',
                        value
                      })}
                      onProblem={onProblem}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {(onSubmit || onCancel) && (
        <footer>
          {onCancel && (
            <button type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
          )}
          {onSubmit && (
            <button
              type="button"
              className="workflow-runtime__primary"
              disabled={busy}
              onClick={onSubmit}
            >
              {busy ? '正在创建任务…' : '使用以上参数运行'}
            </button>
          )}
        </footer>
      )}
    </section>
  )
}

function untouchedLabel(descriptor: WorkflowInputDescriptor): string {
  return Object.hasOwn(descriptor, 'default')
    ? '使用工作流默认值'
    : '本次不传入'
}

function renderWorkflowResourceSlotControl({
  name,
  schema,
  state,
  options,
  problem,
  disabled,
  onChange
}: {
  name: string
  schema: WorkflowValueSchema
  state: WorkflowTaskInputFieldState
  options: readonly WorkflowResourceSlotOption[]
  problem: string | null
  disabled: boolean
  onChange: (state: WorkflowTaskInputFieldState) => boolean
}): React.JSX.Element {
  const base = nonNullSchema(schema)
  const unavailable = disabled || problem !== null
  if ('$slot' in base) {
    const value = state.kind === 'value'
      ? resourceSlotUuid(state.value)
      : ''
    return (
      <div>
        <label>
          资源位
          <select
            aria-label={`${name} 资源位`}
            value={value}
            disabled={unavailable}
            onChange={(event) => onChange(
              event.target.value === ''
                ? { kind: 'untouched' }
                : {
                    kind: 'value',
                    value: { uuid: event.target.value }
                  }
            )}
          >
            <option value="">请选择物料</option>
            {options.map((option) => (
              <option
                key={option.materialUuid}
                value={option.materialUuid}
              >
                {option.displayLabel}
              </option>
            ))}
          </select>
        </label>
        {problem && <span role="status">{problem}</span>}
      </div>
    )
  }

  const values = state.kind === 'value' && Array.isArray(state.value)
    ? state.value.map(resourceSlotUuid)
    : []
  const updateValues = (next: readonly string[]): boolean => onChange({
    kind: 'value',
    value: next.map((uuid) => ({ uuid }))
  })
  return (
    <div>
      {values.map((value, index) => (
        <div key={`${index}:${value}`}>
          <label>
            资源位 {index + 1}
            <select
              aria-label={`${name} 资源位 ${index + 1}`}
              value={value}
              disabled={unavailable}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value
                updateValues(next)
              }}
            >
              {options.map((option) => (
                <option
                  key={option.materialUuid}
                  value={option.materialUuid}
                >
                  {option.displayLabel}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={`${name} 上移 ${index + 1}`}
            disabled={unavailable || index === 0}
            onClick={() => {
              const next = [...values]
              const previous = next[index - 1]
              const current = next[index]
              if (previous === undefined || current === undefined) return
              next[index - 1] = current
              next[index] = previous
              updateValues(next)
            }}
          >
            上移
          </button>
          <button
            type="button"
            aria-label={`${name} 删除 ${index + 1}`}
            disabled={unavailable}
            onClick={() => updateValues(values.filter((_, itemIndex) =>
              itemIndex !== index
            ))}
          >
            删除
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label={`${name} 添加资源位`}
        disabled={unavailable || options.length === 0}
        onClick={() => {
          const first = options[0]
          if (first) updateValues([...values, first.materialUuid])
        }}
      >
        添加资源位
      </button>
      {problem && <span role="status">{problem}</span>}
    </div>
  )
}

function WorkflowValueControl({
  name,
  schema,
  value,
  disabled,
  onChange,
  onProblem
}: {
  name: string
  schema: WorkflowValueSchema
  value: WorkflowJsonValue
  disabled: boolean
  onChange: (value: WorkflowJsonValue) => boolean
  onProblem?: (message: string | null) => void
}): React.JSX.Element {
  const base = 'anyOf' in schema ? schema.anyOf[0] : schema
  if ('$slot' in base) {
    return <input disabled aria-label={`${name} 资源位`} />
  }
  if (base.type === 'string') {
    if (base.enum) {
      return (
        <label>
          参数值
          <select
            aria-label={`${name} 明确值`}
            value={typeof value === 'string' ? value : ''}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            {base.enum.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      )
    }
    return (
      <label>
        参数值
        <input
          type="text"
          aria-label={`${name} 明确值`}
          value={typeof value === 'string' ? value : ''}
          minLength={base.minLength}
          maxLength={base.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }
  if (base.type === 'integer' || base.type === 'number') {
    return (
      <label>
        参数值
        <input
          type="number"
          step={base.type === 'integer' ? 1 : 'any'}
          min={base.minimum}
          max={base.maximum}
          aria-label={`${name} 明确值`}
          value={typeof value === 'number' ? value : 0}
          disabled={disabled}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber
            if (Number.isFinite(next)) onChange(next)
          }}
        />
      </label>
    )
  }
  if (base.type === 'boolean') {
    return (
      <label>
        参数值
        <select
          aria-label={`${name} 明确值`}
          value={value === true ? 'true' : 'false'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="false">否</option>
          <option value="true">是</option>
        </select>
      </label>
    )
  }
  return (
    <label>
      参数值（JSON）
      <textarea
        aria-label={`${name} 明确值 JSON`}
        defaultValue={jsonText(value)}
        disabled={disabled}
        onBlur={(event) => {
          try {
            const parsed = JSON.parse(event.target.value) as unknown
            if (base.type === 'array' && !Array.isArray(parsed)) {
              throw new Error(`${name} 必须是 JSON 数组`)
            }
            if (
              base.type === 'object' &&
              (
                !parsed ||
                typeof parsed !== 'object' ||
                Array.isArray(parsed)
              )
            ) throw new Error(`${name} 必须是 JSON 对象`)
            if (onChange(parsed as WorkflowJsonValue)) onProblem?.(null)
          } catch (error) {
            onProblem?.(errorMessage(error))
          }
        }}
      />
    </label>
  )
}

function stateForKind(
  schema: WorkflowValueSchema,
  kind: string,
  resourceSlotOptions: readonly WorkflowResourceSlotOption[] = []
): WorkflowTaskInputFieldState {
  if (kind === 'untouched') return { kind: 'untouched' }
  if (kind === 'explicit_null') return { kind: 'explicit_null' }
  if (kind === 'value') return {
    kind: 'value',
    value: emptyValue(schema, resourceSlotOptions)
  }
  throw new Error(`未知工作流入参状态：${kind}`)
}

function emptyValue(
  schema: WorkflowValueSchema,
  resourceSlotOptions: readonly WorkflowResourceSlotOption[] = []
): WorkflowJsonValue {
  const base = nonNullSchema(schema)
  if ('$slot' in base) {
    const first = resourceSlotOptions[0]
    if (!first) throw new Error('没有兼容的物料资源位可选择')
    return { uuid: first.materialUuid }
  }
  switch (base.type) {
    case 'string': return base.enum?.[0] ?? ''
    case 'integer':
    case 'number': return base.enum?.[0] ?? boundedZero(
      base.minimum,
      base.maximum
    )
    case 'boolean': return base.enum?.[0] ?? false
    case 'object': return {}
    case 'array': return []
  }
}

function nonNullSchema(
  schema: WorkflowValueSchema
): Exclude<WorkflowValueSchema, { anyOf: unknown }> {
  return 'anyOf' in schema ? schema.anyOf[0] : schema
}

function compatibleOptions(
  schema: WorkflowValueSchema,
  state?: WorkflowResourceSlotOptionsState
): readonly WorkflowResourceSlotOption[] {
  if (!state || state.kind !== 'ready') return []
  const base = nonNullSchema(schema)
  const slot = '$slot' in base
    ? base
    : base.type === 'array' && '$slot' in base.items
      ? base.items
      : null
  return filterWorkflowResourceSlotOptions(
    state.options,
    slot?.allowed_resource_template_uuids
  )
}

function resourceSlotAvailabilityMessage(
  state: WorkflowResourceSlotOptionsState | undefined,
  compatible: readonly WorkflowResourceSlotOption[]
): string | null {
  if (!state) return '物料资源位选项尚未加载，当前不可用'
  if (state.kind !== 'ready') return state.message
  return compatible.length === 0
    ? '没有与工作流入参类型兼容的物料，请先创建或修正模板'
    : null
}

function resourceSlotUuid(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).uuid === 'string'
  ) return (value as Record<string, string>).uuid ?? ''
  return ''
}

function boundedZero(minimum?: number, maximum?: number): number {
  if (minimum !== undefined && minimum > 0) return minimum
  if (maximum !== undefined && maximum < 0) return maximum
  return 0
}

function schemaLabel(schema: WorkflowValueSchema): string {
  const base = 'anyOf' in schema ? schema.anyOf[0] : schema
  const nullable = 'anyOf' in schema ? ' · 可空' : ''
  if ('$slot' in base) return `资源位${nullable}`
  if (base.type === 'array') {
    return `列表<${schemaLabel(base.items)}>${nullable}`
  }
  const labels: Record<string, string> = {
    string: '文本',
    integer: '整数',
    number: '数值',
    boolean: '布尔值',
    object: '对象'
  }
  return `${labels[base.type] ?? base.type}${nullable}`
}

function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value)
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
