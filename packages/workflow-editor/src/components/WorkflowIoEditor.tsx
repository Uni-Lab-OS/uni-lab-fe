import type {
  WorkflowAuthoringGraph,
  WorkflowInputDescriptor,
  WorkflowJsonValue,
  WorkflowOutputBinding,
  WorkflowOutputDescriptor,
  WorkflowValueSchema
} from '@unilab/services'
import { useState } from 'react'

import {
  addWorkflowInput,
  addWorkflowOutput,
  bindWorkflowInput,
  bindWorkflowOutput,
  moveWorkflowInput,
  moveWorkflowOutput,
  projectWorkflowIoBindingOptions,
  removeWorkflowInput,
  removeWorkflowOutput,
  unbindWorkflowInput,
  unbindWorkflowOutput,
  updateWorkflowInput,
  updateWorkflowOutput
} from '../utils/workflowIoAuthoring'

interface WorkflowIoEditorProps {
  graph: WorkflowAuthoringGraph
  editable: boolean
  onGraphChange: (graph: WorkflowAuthoringGraph) => void
}

type SchemaMode =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'resource_slot'

type NonNullableSchema = Exclude<
  WorkflowValueSchema,
  { anyOf: unknown }
>
type ArrayItemSchema = Exclude<
  NonNullableSchema,
  { type: 'array' }
>

export function WorkflowIoEditor({
  graph,
  editable,
  onGraphChange
}: WorkflowIoEditorProps): React.JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState<'input' | 'output'>('input')
  const io = workflowIo(graph)
  const options = projectWorkflowIoBindingOptions(graph)

  const mutate = (operation: () => WorkflowAuthoringGraph): void => {
    try {
      onGraphChange(operation())
      setProblem(null)
    } catch (value) {
      setProblem(value instanceof Error ? value.message : String(value))
    }
  }
  const updateInput = (
    currentName: string,
    descriptor: WorkflowInputDescriptor
  ): void => mutate(() => updateWorkflowInput(
    graph,
    currentName,
    normalizeInputDescriptor(descriptor)
  ))
  const updateOutput = (
    currentName: string,
    descriptor: WorkflowOutputDescriptor
  ): void => mutate(() => updateWorkflowOutput(
    graph,
    currentName,
    descriptor
  ))

  return (
    <section
      className="persistent-authoring__io-editor"
      aria-label="工作流输入与输出编辑器"
    >
      <header>
        <div>
          <strong>编辑工作流参数</strong>
          <span>修改随草稿保存，应用前由 OS 校验。</span>
        </div>
        {!editable && <span>当前模式只读</span>}
      </header>
      {problem && <p role="alert">{problem}</p>}

      <div
        className="persistent-authoring__io-editor-tabs"
        role="tablist"
        aria-label="参数类型"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            return
          }
          event.preventDefault()
          const next = event.key === 'ArrowRight' || event.key === 'End'
            ? 'output'
            : 'input'
          setActiveGroup(next)
          document.getElementById(`workflow-io-tab-${next}`)?.focus()
        }}
      >
        <button
          id="workflow-io-tab-input"
          type="button"
          role="tab"
          aria-controls="workflow-io-panel-input"
          aria-selected={activeGroup === 'input'}
          tabIndex={activeGroup === 'input' ? 0 : -1}
          className={activeGroup === 'input' ? 'is-active' : ''}
          onClick={() => setActiveGroup('input')}
        >
          输入参数 <span>{io.inputs.length}</span>
        </button>
        <button
          id="workflow-io-tab-output"
          type="button"
          role="tab"
          aria-controls="workflow-io-panel-output"
          aria-selected={activeGroup === 'output'}
          tabIndex={activeGroup === 'output' ? 0 : -1}
          className={activeGroup === 'output' ? 'is-active' : ''}
          onClick={() => setActiveGroup('output')}
        >
          输出参数 <span>{io.outputs.length}</span>
        </button>
      </div>

      <div className="persistent-authoring__io-editor-grid">
        <IoGroup
          id="input"
          title="输入参数"
          active={activeGroup === 'input'}
        >
          {io.inputs.length === 0 && (
            <p className="persistent-authoring__io-editor-empty">
              暂无输入参数。需要从工作流外部传值时再添加。
            </p>
          )}
          <ol>
            {io.inputs.map((descriptor, index) => (
              <li
                key={descriptor.name}
                data-workflow-input-name={descriptor.name}
              >
                <details>
                  <summary className="persistent-authoring__io-editor-row-heading">
                    <span className="persistent-authoring__io-editor-identity">
                      <span aria-hidden="true">◇</span>
                      <code>{descriptor.name}</code>
                    </span>
                    <span className="persistent-authoring__io-editor-type">
                      {schemaSummary(descriptor.schema)}
                    </span>
                    <span className="persistent-authoring__io-editor-status">
                      {descriptor.required
                        ? '必填'
                        : Object.hasOwn(descriptor, 'default')
                          ? '有默认值'
                          : '选填'}
                    </span>
                  <span className="persistent-authoring__io-editor-row-actions">
                    <button
                      type="button"
                      disabled={!editable || index === 0}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        mutate(() => moveWorkflowInput(
                          graph,
                          descriptor.name,
                          'up'
                        ))
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={!editable || index === io.inputs.length - 1}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        mutate(() => moveWorkflowInput(
                          graph,
                          descriptor.name,
                          'down'
                        ))
                      }}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        mutate(() => removeWorkflowInput(
                          graph,
                          descriptor.name
                        ))
                      }}
                    >
                      删除
                    </button>
                    <span className="persistent-authoring__io-editor-expand">
                      详情
                    </span>
                  </span>
                  </summary>
                  <div className="persistent-authoring__io-editor-fields">
                <label>
                  变量名
                  <input
                    aria-label="输入名称"
                    defaultValue={descriptor.name}
                    disabled={!editable}
                    onBlur={(event) => {
                      if (event.target.value !== descriptor.name) {
                        updateInput(descriptor.name, {
                          ...descriptor,
                          name: event.target.value
                        })
                      }
                    }}
                  />
                </label>
                <SchemaControl
                  label={`${descriptor.name} 入参`}
                  schema={descriptor.schema}
                  disabled={!editable}
                  onProblem={setProblem}
                  onChange={(schema) => updateInput(descriptor.name, {
                    ...descriptor,
                    schema
                  })}
                />
                <label className="persistent-authoring__io-check">
                  <input
                    type="checkbox"
                    checked={descriptor.required}
                    disabled={
                      !editable || (
                        containsResourceSlot(descriptor.schema) &&
                        !isNullable(descriptor.schema)
                      )
                    }
                    onChange={(event) => updateInput(descriptor.name, {
                      ...descriptor,
                      required: event.target.checked
                    })}
                  />
                  必填
                </label>
                <label className="persistent-authoring__io-check">
                  <input
                    type="checkbox"
                    checked={isNullable(descriptor.schema)}
                    disabled={!editable}
                    onChange={(event) => updateInput(descriptor.name, {
                      ...descriptor,
                      schema: event.target.checked
                        ? nullableSchema(descriptor.schema)
                        : nonNullSchema(descriptor.schema),
                      required: event.target.checked
                        ? false
                        : containsResourceSlot(descriptor.schema)
                          ? true
                          : descriptor.required
                    })}
                  />
                  允许为空
                </label>
                <label>
                  默认值（JSON）
                  <input
                    key={`${descriptor.name}:${jsonValue(descriptor.default)}`}
                    defaultValue={'default' in descriptor
                      ? jsonValue(descriptor.default)
                      : ''}
                    placeholder={descriptor.required
                      ? '必填参数不使用默认值'
                      : '请输入 JSON 值'}
                    disabled={
                      !editable || descriptor.required ||
                      containsResourceSlot(descriptor.schema)
                    }
                    onBlur={(event) => {
                      const raw = event.target.value.trim()
                      mutate(() => updateWorkflowInput(
                        graph,
                        descriptor.name,
                        normalizeInputDescriptor(raw
                          ? {
                              ...descriptor,
                              required: false,
                              default: JSON.parse(raw) as WorkflowJsonValue
                            }
                          : withoutDefault(descriptor))
                      ))
                    }}
                  />
                </label>
                <DescriptorTextFields
                  descriptor={descriptor}
                  disabled={!editable}
                  onChange={(next) => updateInput(descriptor.name, next)}
                />
                <label>
                  绑定到节点入参
                  <select
                    aria-label="节点入参绑定"
                    value=""
                    disabled={!editable || options.inputTargets.length === 0}
                    onChange={(event) => {
                      if (!event.target.value) return
                      const target = options.inputTargets.find((item) =>
                        inputTargetValue(item) === event.target.value
                      )
                      if (!target) return
                      mutate(() => bindWorkflowInput(graph, {
                        parameter: descriptor.name,
                        ...target
                      }))
                    }}
                  >
                    <option value="">选择节点入参…</option>
                    {options.inputTargets.map((target) => (
                      <option
                        key={`${target.workflowNodeUuid}:${target.targetHandleUuid}`}
                        value={inputTargetValue(target)}
                        data-workflow-node-uuid={target.workflowNodeUuid}
                        data-workflow-handle-template-uuid={
                          target.targetHandleUuid
                        }
                      >
                        {handleLabel(
                          graph,
                          target.workflowNodeUuid,
                          target.targetHandleUuid
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <BindingList
                  graph={graph}
                  parameter={descriptor.name}
                  editable={editable}
                  onUnbind={(nodeUuid, handleUuid) => mutate(() =>
                    unbindWorkflowInput(graph, nodeUuid, handleUuid)
                  )}
                />
                  </div>
                </details>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="persistent-authoring__io-editor-add"
            disabled={!editable}
            onClick={() => mutate(() => addWorkflowInput(graph, {
              name: uniqueName(io.inputs.map(({ name }) => name), 'input'),
              schema: { type: 'string' },
              required: true
            }))}
          >
            添加输入参数
          </button>
        </IoGroup>

        <IoGroup
          id="output"
          title="输出参数"
          active={activeGroup === 'output'}
        >
          {io.outputs.length === 0 && (
            <p className="persistent-authoring__io-editor-empty">
              暂无输出参数。需要向工作流外部返回结果时再添加。
            </p>
          )}
          <ol>
            {io.outputs.map((descriptor, index) => {
              const readonly = descriptor.implicit || !editable
              const binding = io.outputBindings[descriptor.name]
              return (
                <li
                  key={descriptor.name}
                  data-workflow-output-name={descriptor.name}
                  aria-readonly={descriptor.implicit ? 'true' : undefined}
                >
                  <details>
                    <summary className="persistent-authoring__io-editor-row-heading">
                      <span className="persistent-authoring__io-editor-identity">
                        <span aria-hidden="true">◇</span>
                        <code>{descriptor.name}</code>
                      </span>
                      <span className="persistent-authoring__io-editor-type">
                        {schemaSummary(descriptor.schema)}
                      </span>
                      <span className="persistent-authoring__io-editor-status">
                        {descriptor.implicit ? '系统生成 · OS 管理' : '已配置'}
                      </span>
                      <span className="persistent-authoring__io-editor-row-actions">
                        {!descriptor.implicit && (
                          <>
                            <button
                              type="button"
                              disabled={!editable || index === 0}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                mutate(() => moveWorkflowOutput(
                                  graph,
                                  descriptor.name,
                                  'up'
                                ))
                              }}
                            >
                              上移
                            </button>
                            <button
                              type="button"
                              disabled={
                                !editable || index === io.outputs.length - 1
                              }
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                mutate(() => moveWorkflowOutput(
                                  graph,
                                  descriptor.name,
                                  'down'
                                ))
                              }}
                            >
                              下移
                            </button>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                mutate(() => removeWorkflowOutput(
                                  graph,
                                  descriptor.name
                                ))
                              }}
                            >
                              删除
                            </button>
                          </>
                        )}
                        <span className="persistent-authoring__io-editor-expand">
                          详情
                        </span>
                      </span>
                    </summary>
                    <div className="persistent-authoring__io-editor-fields">
                  <label>
                    变量名
                    <input
                      aria-label="输出名称"
                      defaultValue={descriptor.name}
                      disabled={readonly}
                      onBlur={(event) => {
                        if (event.target.value !== descriptor.name) {
                          updateOutput(descriptor.name, {
                            ...descriptor,
                            name: event.target.value
                          })
                        }
                      }}
                    />
                  </label>
                  <SchemaControl
                    label={`${descriptor.name} 出参`}
                    schema={descriptor.schema}
                    disabled={readonly}
                    onProblem={setProblem}
                    onChange={(schema) => updateOutput(descriptor.name, {
                      ...descriptor,
                      schema
                    })}
                  />
                  <label className="persistent-authoring__io-check">
                    <input
                      type="checkbox"
                      checked={isNullable(descriptor.schema)}
                      disabled={readonly}
                      onChange={(event) => updateOutput(descriptor.name, {
                        ...descriptor,
                        schema: event.target.checked
                          ? nullableSchema(descriptor.schema)
                          : nonNullSchema(descriptor.schema)
                      })}
                    />
                    允许为空
                  </label>
                  <DescriptorTextFields
                    descriptor={descriptor}
                    disabled={readonly}
                    onChange={(next) => updateOutput(descriptor.name, next)}
                  />
                  <label>
                    数据来源
                    <select
                      aria-label="工作流出参绑定"
                      value={bindingValue(binding)}
                      disabled={readonly}
                      onChange={(event) => {
                        const value = event.target.value
                        if (!value) {
                          mutate(() => unbindWorkflowOutput(
                            graph,
                            descriptor.name
                          ))
                          return
                        }
                        const source = options.outputSources.find(
                          (option) => sourceValue(option) === value
                        )
                        if (!source) return
                        mutate(() => bindWorkflowOutput(
                          graph,
                          descriptor.name,
                          source.kind === 'workflow_input'
                            ? source
                            : {
                                kind: 'node_output',
                                workflow_node_uuid: source.workflowNodeUuid,
                                source_handle_uuid: source.sourceHandleUuid
                              }
                        ))
                      }}
                    >
                      <option value="">选择数据来源…</option>
                      {options.outputSources.map((source) => (
                        <option
                          key={sourceValue(source)}
                          value={sourceValue(source)}
                          data-workflow-node-uuid={source.kind === 'node_output'
                            ? source.workflowNodeUuid
                            : undefined}
                          data-workflow-handle-template-uuid={
                            source.kind === 'node_output'
                              ? source.sourceHandleUuid
                              : undefined
                          }
                        >
                          {source.kind === 'workflow_input'
                            ? `工作流输入：${source.parameter}`
                            : handleLabel(
                                graph,
                                source.workflowNodeUuid,
                                source.sourceHandleUuid
                              )}
                        </option>
                      ))}
                    </select>
                  </label>
                    </div>
                  </details>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            className="persistent-authoring__io-editor-add"
            disabled={!editable}
            onClick={() => mutate(() => addWorkflowOutput(graph, {
              name: uniqueName(io.outputs.map(({ name }) => name), 'output'),
              schema: { type: 'object' },
              implicit: false
            }))}
          >
            添加输出参数
          </button>
        </IoGroup>
      </div>
    </section>
  )
}

function IoGroup({
  id,
  title,
  active,
  children
}: {
  id: 'input' | 'output'
  title: string
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      id={`workflow-io-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`workflow-io-tab-${id}`}
      hidden={!active}
    >
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function SchemaControl({
  label,
  schema,
  disabled,
  onProblem,
  onChange
}: {
  label: string
  schema: WorkflowValueSchema
  disabled: boolean
  onProblem: (message: string | null) => void
  onChange: (schema: WorkflowValueSchema) => void
}): React.JSX.Element {
  const nullable = isNullable(schema)
  const base = nonNullSchema(schema)
  const apply = (operation: () => NonNullableSchema): void => {
    try {
      const next = operation()
      onChange(nullable ? nullableSchema(next) : next)
      onProblem(null)
    } catch (value) {
      onProblem(value instanceof Error ? value.message : String(value))
    }
  }
  return (
    <>
      <SchemaTypeSelect
        label={label}
        mode={schemaMode(base)}
        allowArray
        disabled={disabled}
        onChange={(mode) => apply(() => schemaForMode(mode))}
      />
      {isArraySchema(base) ? (
        <>
          <SchemaTypeSelect
            label={`${label} 项目`}
            mode={schemaMode(base.items)}
            allowArray={false}
            disabled={disabled}
            onChange={(mode) => apply(() => ({
              ...base,
              items: schemaForItemMode(mode)
            }))}
          />
          <SchemaConstraintFields
            label={`${label} 项目`}
            schema={base.items as ArrayItemSchema}
            disabled={disabled}
            onChange={(items) => apply(() => ({ ...base, items }))}
            onProblem={onProblem}
          />
          <OptionalNumberField
            label="最少项目数"
            ariaLabel={`${label} 最少项目数`}
            value={base.minItems}
            integer
            nonNegative
            disabled={disabled}
            onChange={(value) => apply(() => withSchemaField(
              base,
              'minItems',
              value
            ))}
          />
          <OptionalNumberField
            label="最多项目数"
            ariaLabel={`${label} 最多项目数`}
            value={base.maxItems}
            integer
            nonNegative
            disabled={disabled}
            onChange={(value) => apply(() => withSchemaField(
              base,
              'maxItems',
              value
            ))}
          />
        </>
      ) : (
        <SchemaConstraintFields
          label={label}
          schema={base as ArrayItemSchema}
          disabled={disabled}
          onChange={(next) => apply(() => next)}
          onProblem={onProblem}
        />
      )}
    </>
  )
}

function SchemaTypeSelect({
  label,
  mode,
  allowArray,
  disabled,
  onChange
}: {
  label: string
  mode: SchemaMode
  allowArray: boolean
  disabled: boolean
  onChange: (mode: SchemaMode) => void
}): React.JSX.Element {
  return (
    <label>
      数据类型
      <select
        aria-label={`${label} 数据类型`}
        value={mode}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as SchemaMode)}
      >
        <option value="string">文本</option>
        <option value="integer">整数</option>
        <option value="number">数值</option>
        <option value="boolean">布尔值</option>
        <option value="object">对象（JSON）</option>
        {allowArray && <option value="array">列表</option>}
        <option value="resource_slot">资源位</option>
      </select>
    </label>
  )
}

function SchemaConstraintFields({
  label,
  schema,
  disabled,
  onChange,
  onProblem
}: {
  label: string
  schema: ArrayItemSchema
  disabled: boolean
  onChange: (schema: ArrayItemSchema) => void
  onProblem: (message: string | null) => void
}): React.JSX.Element | null {
  const applyJsonArray = (
    raw: string,
    field: 'enum' | 'allowed_resource_template_uuids'
  ): void => {
    try {
      const trimmed = raw.trim()
      if (!trimmed) {
        onChange(withSchemaField(schema, field, undefined))
        onProblem(null)
        return
      }
      const parsed = JSON.parse(trimmed) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('该字段必须是非空 JSON 数组')
      }
      onChange(withSchemaField(schema, field, parsed))
      onProblem(null)
    } catch (value) {
      onProblem(value instanceof Error ? value.message : String(value))
    }
  }

  if ('$slot' in schema) {
    return (
      <label>
        允许的资源模板 UUID（JSON）
        <input
          aria-label={`${label} 允许的资源模板 UUID`}
          defaultValue={jsonValue(schema.allowed_resource_template_uuids)}
          placeholder='["resource-template-uuid"]'
          disabled={disabled}
          onBlur={(event) => applyJsonArray(
            event.target.value,
            'allowed_resource_template_uuids'
          )}
        />
      </label>
    )
  }
  if (schema.type === 'object') return null

  const enumField = (
    <label>
      可选值（JSON）
      <input
        aria-label={`${label} 可选值 JSON`}
        defaultValue={jsonValue(schema.enum)}
        placeholder='["选项一", "选项二"]'
        disabled={disabled}
        onBlur={(event) => applyJsonArray(event.target.value, 'enum')}
      />
    </label>
  )
  if (schema.type === 'boolean') return enumField
  if (schema.type === 'integer' || schema.type === 'number') {
    return (
      <>
        {enumField}
        <OptionalNumberField
          label="最小值"
          ariaLabel={`${label} 最小值`}
          value={schema.minimum}
          integer={schema.type === 'integer'}
          disabled={disabled}
          onChange={(value) => onChange(withSchemaField(
            schema,
            'minimum',
            value
          ))}
        />
        <OptionalNumberField
          label="最大值"
          ariaLabel={`${label} 最大值`}
          value={schema.maximum}
          integer={schema.type === 'integer'}
          disabled={disabled}
          onChange={(value) => onChange(withSchemaField(
            schema,
            'maximum',
            value
          ))}
        />
      </>
    )
  }
  const stringSchema = schema as Extract<ArrayItemSchema, { type: 'string' }>
  return (
    <>
      {enumField}
      <OptionalNumberField
        label="最短长度"
        ariaLabel={`${label} 最短长度`}
        value={stringSchema.minLength}
        integer
        nonNegative
        disabled={disabled}
        onChange={(value) => onChange(withSchemaField(
          stringSchema,
          'minLength',
          value
        ))}
      />
      <OptionalNumberField
        label="最长长度"
        ariaLabel={`${label} 最长长度`}
        value={stringSchema.maxLength}
        integer
        nonNegative
        disabled={disabled}
        onChange={(value) => onChange(withSchemaField(
          stringSchema,
          'maxLength',
          value
        ))}
      />
      <label>
        输入控件
        <select
          aria-label={`${label} 输入控件`}
          value={stringSchema['x-unilabos-editor-control'] ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(withSchemaField(
            stringSchema,
            'x-unilabos-editor-control',
            event.target.value || undefined
          ))}
        >
          <option value="">默认</option>
          <option value="site_selector">位置选择器</option>
        </select>
      </label>
    </>
  )
}

function OptionalNumberField({
  label,
  ariaLabel,
  value,
  integer,
  nonNegative = false,
  disabled,
  onChange
}: {
  label: string
  ariaLabel: string
  value: number | undefined
  integer: boolean
  nonNegative?: boolean
  disabled: boolean
  onChange: (value: number | undefined) => void
}): React.JSX.Element {
  return (
    <label>
      {label}
      <input
        type="number"
        step={integer ? 1 : 'any'}
        min={nonNegative ? 0 : undefined}
        aria-label={ariaLabel}
        defaultValue={value}
        disabled={disabled}
        onBlur={(event) => {
          const raw = event.target.value.trim()
          onChange(raw ? Number(raw) : undefined)
        }}
      />
    </label>
  )
}

function DescriptorTextFields<T extends {
  title?: string
  description?: string
}>({
  descriptor,
  disabled,
  onChange
}: {
  descriptor: T
  disabled: boolean
  onChange: (descriptor: T) => void
}): React.JSX.Element {
  return (
    <>
      <label>
        显示名称
        <input
          defaultValue={descriptor.title ?? ''}
          disabled={disabled}
          onBlur={(event) => onChange(withOptionalText(
            descriptor,
            'title',
            event.target.value
          ))}
        />
      </label>
      <label>
        说明
        <input
          defaultValue={descriptor.description ?? ''}
          disabled={disabled}
          onBlur={(event) => onChange(withOptionalText(
            descriptor,
            'description',
            event.target.value
          ))}
        />
      </label>
    </>
  )
}

function BindingList({
  graph,
  parameter,
  editable,
  onUnbind
}: {
  graph: WorkflowAuthoringGraph
  parameter: string
  editable: boolean
  onUnbind: (nodeUuid: string, handleUuid: string) => void
}): React.JSX.Element | null {
  const bindings = graph.nodes.flatMap((node) => {
    const inputBindings = recordOrEmpty(
      recordOrEmpty(recordOrEmpty(node.meta_data).unilab).input_bindings
    )
    return Object.entries(inputBindings)
      .filter(([, value]) => recordOrEmpty(value).parameter === parameter)
      .map(([handleUuid]) => ({
        nodeUuid: String(node.uuid),
        handleUuid
      }))
  })
  if (bindings.length === 0) return null
  return (
    <div className="persistent-authoring__io-bindings">
      <small>已绑定到：</small>
      {bindings.map(({ nodeUuid, handleUuid }) => (
        <span key={`${nodeUuid}:${handleUuid}`}>
          {handleLabel(graph, nodeUuid, handleUuid)}
          <button
            type="button"
            data-workflow-node-uuid={nodeUuid}
            data-workflow-handle-template-uuid={handleUuid}
            disabled={!editable}
            onClick={() => onUnbind(nodeUuid, handleUuid)}
          >
            解除绑定
          </button>
        </span>
      ))}
    </div>
  )
}

function workflowIo(graph: WorkflowAuthoringGraph): {
  inputs: WorkflowInputDescriptor[]
  outputs: WorkflowOutputDescriptor[]
  outputBindings: Record<string, WorkflowOutputBinding>
} {
  const unilab = recordOrEmpty(graph.workflow.meta_data?.unilab)
  const inputContract = recordOrEmpty(unilab.input_contract)
  const outputContract = recordOrEmpty(unilab.output_contract)
  return {
    inputs: Array.isArray(inputContract.parameters)
      ? inputContract.parameters as WorkflowInputDescriptor[]
      : [],
    outputs: Array.isArray(outputContract.outputs)
      ? outputContract.outputs as WorkflowOutputDescriptor[]
      : [],
    outputBindings: recordOrEmpty(unilab.output_bindings) as Record<
      string,
      WorkflowOutputBinding
    >
  }
}

function normalizeInputDescriptor(
  descriptor: WorkflowInputDescriptor
): WorkflowInputDescriptor {
  if (descriptor.required) {
    const next = {
      ...descriptor,
      schema: nonNullSchema(descriptor.schema)
    }
    delete next.default
    return next
  }
  if (isNullable(descriptor.schema)) {
    return { ...descriptor, default: null }
  }
  if (containsResourceSlot(descriptor.schema)) {
    throw new Error('资源位入参设为选填前，需要先开启“允许为空”')
  }
  if ('default' in descriptor && descriptor.default !== null) return descriptor
  return { ...descriptor, default: defaultValue(descriptor.schema) }
}

function withoutDefault(
  descriptor: WorkflowInputDescriptor
): WorkflowInputDescriptor {
  const next = { ...descriptor }
  delete next.default
  return next
}

function defaultValue(schema: WorkflowValueSchema): WorkflowJsonValue {
  const base = nonNullSchema(schema)
  if (
    '$slot' in base ||
    (base.type === 'array' && containsResourceSlot(base.items))
  ) {
    throw new Error('资源位入参不能由前端生成默认值')
  }
  switch (base.type) {
    case 'string': return ''
    case 'integer':
    case 'number': return 0
    case 'boolean': return false
    case 'object': return {}
    case 'array': return []
  }
  throw new Error('当前工作流入参类型不支持由前端生成默认值')
}

function schemaMode(schema: WorkflowValueSchema): SchemaMode {
  const base = nonNullSchema(schema)
  if ('$slot' in base) return 'resource_slot'
  return base.type
}

function schemaSummary(schema: WorkflowValueSchema): string {
  const base = nonNullSchema(schema)
  const type = '$slot' in base
    ? '资源位'
    : base.type === 'array'
      ? `列表<${schemaSummary(base.items)}>`
      : schemaTypeLabel(base.type)
  return isNullable(schema) ? `${type} · 允许为空` : type
}

function schemaForMode(mode: SchemaMode): NonNullableSchema {
  if (mode === 'resource_slot') return { $slot: 'ResourceSlot' }
  if (mode === 'array') return { type: 'array', items: { type: 'string' } }
  return { type: mode }
}

function schemaForItemMode(mode: SchemaMode): ArrayItemSchema {
  if (mode === 'array') throw new Error('当前版本不支持嵌套列表类型')
  return schemaForMode(mode) as ArrayItemSchema
}

function schemaTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    string: '文本',
    integer: '整数',
    number: '数值',
    boolean: '布尔值',
    object: '对象',
    array: '列表',
    null: '空值'
  }
  return labels[type] ?? type
}

function nullableSchema(schema: WorkflowValueSchema): WorkflowValueSchema {
  if (isNullable(schema)) return schema
  return { anyOf: [nonNullSchema(schema), { type: 'null' }] }
}

function nonNullSchema(schema: WorkflowValueSchema): Exclude<
  WorkflowValueSchema,
  { anyOf: unknown }
> {
  return 'anyOf' in schema ? schema.anyOf[0] : schema
}

function isNullable(schema: WorkflowValueSchema): boolean {
  return 'anyOf' in schema
}

function isArraySchema(
  schema: NonNullableSchema
): schema is Extract<NonNullableSchema, { type: 'array' }> {
  return 'type' in schema && schema.type === 'array'
}

function containsResourceSlot(schema: WorkflowValueSchema): boolean {
  if ('anyOf' in schema) return containsResourceSlot(schema.anyOf[0])
  if ('$slot' in schema) return true
  return schema.type === 'array' && containsResourceSlot(schema.items)
}

function withSchemaField<T extends NonNullableSchema>(
  schema: T,
  field: string,
  value: unknown
): T {
  const next = { ...schema } as Record<string, unknown>
  if (value === undefined) delete next[field]
  else next[field] = value
  return next as T
}

function bindingValue(binding: WorkflowOutputBinding | undefined): string {
  if (!binding) return ''
  return binding.kind === 'workflow_input'
    ? `input:${binding.parameter}`
    : `node:${binding.workflow_node_uuid}:${binding.source_handle_uuid}`
}

function sourceValue(
  source:
    | { kind: 'workflow_input'; parameter: string }
    | {
        kind: 'node_output'
        workflowNodeUuid: string
        sourceHandleUuid: string
      }
): string {
  return source.kind === 'workflow_input'
    ? `input:${source.parameter}`
    : `node:${source.workflowNodeUuid}:${source.sourceHandleUuid}`
}

function inputTargetValue(target: {
  workflowNodeUuid: string
  targetHandleUuid: string
}): string {
  return `node:${target.workflowNodeUuid}:${target.targetHandleUuid}`
}

function handleLabel(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string
): string {
  const node = graph.nodes.find(({ uuid }) => uuid === nodeUuid)
  const handle = graph.handle_templates.find(({ uuid }) => uuid === handleUuid)
  const nodeLabel = String(node?.name || nodeUuid)
  const handleLabel = String(
    handle?.display_name || handle?.handle_key || handleUuid
  )
  return `${nodeLabel} · ${handleLabel}`
}

function uniqueName(names: string[], prefix: string): string {
  let suffix = 1
  while (names.includes(`${prefix}_${suffix}`)) suffix += 1
  return `${prefix}_${suffix}`
}

function withOptionalText<T extends object>(
  value: T,
  key: 'title' | 'description',
  text: string
): T {
  const next = { ...value } as Record<string, unknown>
  if (text) next[key] = text
  else delete next[key]
  return next as T
}

function jsonValue(value: unknown): string {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? '' : encoded
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
