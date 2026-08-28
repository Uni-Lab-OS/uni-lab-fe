import { SlideOverDrawer } from '@unilab/design-system'
import type {
  WorkflowActionHandleTemplate,
  WorkflowAuthoringGraph
} from '@unilab/services'
import { useEffect, useState } from 'react'

import type {
  TypedActionEditorProjection,
  TypedActionFieldProjection
} from '../utils/workflowActionCatalog'
import type {
  WorkflowResourceSlotOptionsState
} from '../utils/workflowResourceSlotOptions'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowResourceSelector } from './WorkflowResourceSelector'

export interface WorkflowActionParameterEditorProps {
  editor: TypedActionEditorProjection | null
  outputHandles: readonly WorkflowActionHandleTemplate[]
  graph: WorkflowAuthoringGraph | null
  editable: boolean
  resourceSlotOptions?: WorkflowResourceSlotOptionsState
  onProviderChange: (
    field: TypedActionFieldProjection,
    provider: string
  ) => void
  onLiteralBlur: (
    field: TypedActionFieldProjection,
    raw: string
  ) => string | null | void
  onResourceChange?: (
    field: TypedActionFieldProjection,
    materialUuid: string | null
  ) => void
  onClear: (handleUuid: string) => void
  onNull: (handleUuid: string) => void
}

interface WorkflowActionParameterDrawerProps
  extends WorkflowActionParameterEditorProps {
  open: boolean
  nodeName: string
  templateName: string
  onClose: () => void
}

export function WorkflowActionParameterDrawer({
  open,
  nodeName,
  templateName,
  onClose,
  ...editorProps
}: WorkflowActionParameterDrawerProps): React.JSX.Element {
  return (
    <SlideOverDrawer
      open={open}
      size="medium"
      ariaLabel={`节点参数 ${nodeName}`}
      title={(
        <span className="persistent-authoring__drawer-title">
          <span>节点输入与输出</span>
          <strong>{nodeName || '未选择节点'}</strong>
          {templateName && <small>{templateName}</small>}
        </span>
      )}
      onClose={onClose}
      footer={(
        <div className="persistent-authoring__drawer-footer">
          <span>修改暂存在画布编辑区，保存草稿后生效。</span>
          <button type="button" onClick={onClose}>完成</button>
        </div>
      )}
    >
      <WorkflowActionParameterEditor {...editorProps} />
    </SlideOverDrawer>
  )
}

/**
 * 可嵌入检查器或抽屉的操作参数编辑主体。
 *
 * 临时文本只在本组件内保存，失焦后才交给 Canonical 草稿命令解析。
 */
export function WorkflowActionParameterEditor({
  editor,
  outputHandles,
  graph,
  editable,
  resourceSlotOptions,
  onProviderChange,
  onLiteralBlur,
  onResourceChange,
  onClear,
  onNull
}: WorkflowActionParameterEditorProps): React.JSX.Element {
  const configuredInputCount = editor?.fields.filter(
    (field) => field.providerKind !== 'missing'
  ).length ?? 0
  const missingRequiredCount = editor?.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'required_action_parameter_missing'
  ).length ?? 0
  const [literalDraftHandles, setLiteralDraftHandles] = useState<Set<string>>(
    () => new Set()
  )
  const [literalErrors, setLiteralErrors] = useState<Map<string, string>>(
    () => new Map()
  )
  useEffect(() => {
    setLiteralDraftHandles(new Set())
    setLiteralErrors(new Map())
  }, [editor?.nodeUuid])
  const selectProvider = (
    field: TypedActionFieldProjection,
    provider: string
  ): void => {
    setLiteralDraftHandles((current) => withLiteralDraft(
      current,
      field.handleUuid,
      provider === 'literal'
    ))
    onProviderChange(field, provider)
  }
  const commitLiteral = (
    field: TypedActionFieldProjection,
    raw: string
  ): void => {
    const error = onLiteralBlur(field, raw) || null
    setLiteralErrors((current) => {
      const next = new Map(current)
      if (error) next.set(field.handleUuid, error)
      else next.delete(field.handleUuid)
      return next
    })
    if (error) return
    setLiteralDraftHandles((current) => withLiteralDraft(
      current,
      field.handleUuid,
      false
    ))
  }
  return (
    <div className="persistent-authoring__parameter-drawer">
        <header>
          <div>
            <strong>设置节点参数</strong>
            <p>
              输入决定节点如何执行；输出由 OS 操作模板定义，可连接下游节点或工作流输出。
            </p>
          </div>
          <dl aria-label="节点参数数量">
            <div><dt>已配置</dt><dd>{configuredInputCount}</dd></div>
            <div className={missingRequiredCount > 0 ? 'has-error' : undefined}>
              <dt>待补</dt><dd>{missingRequiredCount}</dd>
            </div>
            <div><dt>输出</dt><dd>{outputHandles.length}</dd></div>
          </dl>
        </header>

        {!editor ? (
          <p className="persistent-authoring__parameter-empty">
            当前节点没有可编辑的操作参数。
          </p>
        ) : (
          <div className="persistent-authoring__parameter-columns">
            <ParameterSection
              title="输入参数"
              description="选择参数来源；固定值和工作流输入都在此设置。"
              count={editor.fields.length}
            >
              {editor.fields.length === 0 ? (
                <p className="persistent-authoring__parameter-empty">
                  当前操作没有外部输入。
                </p>
              ) : (
                <ol className="persistent-authoring__parameter-list">
                  {editor.fields.map((field) => {
                    const literalDraft = literalDraftHandles.has(
                      field.handleUuid
                    )
                    const providerKind = literalDraft
                      ? 'literal'
                      : field.providerKind
                    const diagnostics = literalDraft
                      ? editor.diagnostics.filter((diagnostic) =>
                          diagnostic.handleUuid === field.handleUuid &&
                          diagnostic.code !== 'required_action_parameter_missing'
                        )
                      : editor.diagnostics.filter(
                          (diagnostic) =>
                            diagnostic.handleUuid === field.handleUuid
                        )
                    return (
                      <li
                        key={field.handleUuid}
                        data-workflow-handle-template-uuid={field.handleUuid}
                      >
                      <div className="persistent-authoring__parameter-heading">
                        <span>
                          <strong>{field.displayName}</strong>
                          <code>{field.dataKey}</code>
                        </span>
                        <span className={
                          field.required
                            ? 'persistent-authoring__parameter-required'
                            : 'persistent-authoring__parameter-optional'
                        }>
                          {field.required ? '必填' : '选填'}
                        </span>
                      </div>

                      <div className="persistent-authoring__parameter-fields">
                        <label>
                          <select
                            aria-label={`${field.displayName} 参数来源`}
                            value={providerKind === 'workflow_input'
                              ? `workflow:${field.workflowInput}`
                              : providerKind}
                            disabled={!editable}
                            onChange={(event) => selectProvider(
                              field,
                              event.target.value
                            )}
                          >
                            <option value="missing">未设置</option>
                            <option value="literal">
                              {field.editorControl === 'material_port'
                                ? '实验室物料'
                                : '固定值'}
                            </option>
                            {field.workflowInputOptions.map((name) => (
                              <option key={name} value={`workflow:${name}`}>
                                工作流输入：{name}
                              </option>
                            ))}
                            <option
                              value="upstream_output"
                              disabled={field.providerKind !== 'upstream_output'}
                            >
                              由上游节点提供
                            </option>
                          </select>
                        </label>
                        <ParameterValueControl
                          field={field}
                          providerKind={providerKind}
                          editable={editable}
                          resourceSlotOptions={resourceSlotOptions}
                          onLiteralBlur={commitLiteral}
                          onResourceChange={onResourceChange}
                        />
                        {literalErrors.get(field.handleUuid) && (
                          <p
                            className="persistent-authoring__parameter-inline-error"
                            role="alert"
                          >
                            {literalErrors.get(field.handleUuid)}
                          </p>
                        )}
                      </div>

                      <div className="persistent-authoring__parameter-meta">
                        <span>{schemaLabel(field.valueSchema)}</span>
                        <span>{field.hasDefault
                          ? `默认 ${jsonLabel(field.defaultValue)}`
                          : '无默认值'}</span>
                        <span>{field.nullable ? '允许为空' : '不可为空'}</span>
                      </div>

                      <div className="persistent-authoring__parameter-actions">
                        <WorkflowButton
                          type="button"
                          disabled={!editable}
                          disabledReason="当前模式只允许查看节点参数"
                          onClick={() => onClear(field.handleUuid)}
                        >
                          清除值
                        </WorkflowButton>
                        {field.nullable && (
                          <WorkflowButton
                            type="button"
                            disabled={!editable}
                            disabledReason="当前模式只允许查看节点参数"
                            onClick={() => onNull(field.handleUuid)}
                          >
                            传入空值
                          </WorkflowButton>
                        )}
                      </div>

                      <ParameterDiagnostics
                        diagnostics={diagnostics}
                      />
                      </li>
                    )
                  })}
                </ol>
              )}
              <ParameterDiagnostics
                diagnostics={editor.diagnostics.filter(
                  (diagnostic) => !diagnostic.handleUuid
                )}
              />
            </ParameterSection>

            <ParameterSection
              title="输出参数"
              description="输出类型由 OS 操作模板定义，连接去向会显示在这里。"
              count={outputHandles.length}
            >
              {outputHandles.length === 0 ? (
                <p className="persistent-authoring__parameter-empty">
                  当前操作没有对外输出。
                </p>
              ) : (
                <ol className="persistent-authoring__output-list">
                  {outputHandles.map((handle) => {
                    const destinations = outputDestinations(
                      graph,
                      editor.nodeUuid,
                      handle.uuid
                    )
                    return (
                      <li
                        key={handle.uuid}
                        data-workflow-handle-template-uuid={handle.uuid}
                        title={`端口 UUID · ${handle.uuid}`}
                      >
                        <div className="persistent-authoring__parameter-heading">
                          <span>
                            <strong>{handle.displayName}</strong>
                            <code>{handle.handleKey}</code>
                          </span>
                          <span className="persistent-authoring__parameter-output">
                            输出
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>值类型</dt>
                            <dd>{handle.valueType || schemaLabel(handle.valueSchema)}</dd>
                          </div>
                        </dl>
                        <div className="persistent-authoring__output-destinations">
                          <strong>已连接到</strong>
                          {destinations.length === 0 ? (
                            <span>尚未连接下游节点或工作流输出</span>
                          ) : destinations.map((destination) => (
                            <span key={destination}>{destination}</span>
                          ))}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </ParameterSection>
          </div>
        )}
    </div>
  )
}

function ParameterSection({
  title,
  description,
  count,
  children
}: {
  title: string
  description: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="persistent-authoring__parameter-section">
      <header>
        <span><strong>{title}</strong><small>{count}</small></span>
        <p>{description}</p>
      </header>
      {children}
    </section>
  )
}

function ParameterValueControl({
  field,
  providerKind,
  editable,
  resourceSlotOptions,
  onLiteralBlur,
  onResourceChange
}: {
  field: TypedActionFieldProjection
  providerKind: TypedActionFieldProjection['providerKind']
  editable: boolean
  resourceSlotOptions?: WorkflowResourceSlotOptionsState
  onLiteralBlur: (
    field: TypedActionFieldProjection,
    raw: string
  ) => string | null | void
  onResourceChange?: (
    field: TypedActionFieldProjection,
    materialUuid: string | null
  ) => void
}): React.JSX.Element {
  const disabled = !editable ||
    providerKind === 'workflow_input' ||
    providerKind === 'upstream_output'
  if (field.editorControl === 'material_port') {
    return (
      <WorkflowResourceSelector
        label={`${field.displayName} 实验室物料`}
        value={resourceSlotUuid(field.value)}
        optionsState={resourceSlotOptions}
        allowedResourceTemplateUuids={field.allowedResourceTemplateUuids}
        disabled={disabled || !onResourceChange}
        onChange={(materialUuid) => onResourceChange?.(field, materialUuid)}
      />
    )
  }
  if (field.enumValues) {
    return (
      <label>
        <select
          aria-label={`${field.displayName} 参数值`}
          value={typedFieldInputValue(field)}
          disabled={disabled}
          onChange={(event) => onLiteralBlur(field, event.target.value)}
        >
          <option value="">未设置</option>
          {field.enumValues.map((value) => (
            <option key={JSON.stringify(value)} value={JSON.stringify(value)}>
              {String(value)}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <label>
      <input
        key={`${field.handleUuid}:${typedFieldInputValue(field)}`}
        aria-label={`${field.displayName} 参数值`}
        defaultValue={typedFieldInputValue(field)}
        placeholder={field.hasDefault
          ? `默认 ${jsonLabel(field.defaultValue)}`
          : '未设置'}
        disabled={disabled}
        onBlur={(event) => onLiteralBlur(field, event.target.value)}
      />
    </label>
  )
}

function withLiteralDraft(
  current: ReadonlySet<string>,
  handleUuid: string,
  selected: boolean
): Set<string> {
  const next = new Set(current)
  if (selected) next.add(handleUuid)
  else next.delete(handleUuid)
  return next
}

function ParameterDiagnostics({
  diagnostics
}: {
  diagnostics: TypedActionEditorProjection['diagnostics']
}): React.JSX.Element | null {
  if (diagnostics.length === 0) return null
  return (
    <ul className="persistent-authoring__parameter-diagnostics" role="alert">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}:${index}`}>
          <code>{diagnostic.code}</code>
          <span>{diagnostic.message}</span>
        </li>
      ))}
    </ul>
  )
}

function outputDestinations(
  graph: WorkflowAuthoringGraph | null,
  nodeUuid: string,
  handleUuid: string
): string[] {
  if (!graph) return []
  const destinations = graph.edges
    .filter((edge) => (
      edge.source_node_uuid === nodeUuid &&
      edge.source_handle_uuid === handleUuid
    ))
    .map((edge) => {
      const target = graph.nodes.find(
        (node) => node.uuid === edge.target_node_uuid
      )
      return `下游节点：${String(target?.name || edge.target_node_uuid)}`
    })
  const bindings = graph.workflow.meta_data?.unilab?.output_bindings ?? {}
  for (const [name, value] of Object.entries(bindings)) {
    if (!isRecord(value)) continue
    if (
      value.kind === 'node_output' &&
      value.workflow_node_uuid === nodeUuid &&
      value.source_handle_uuid === handleUuid
    ) {
      destinations.push(`工作流输出：${name}`)
    }
  }
  return destinations
}

function typedFieldInputValue(field: TypedActionFieldProjection): string {
  if (field.valueState === 'missing') return ''
  if (field.enumValues) return JSON.stringify(field.value)
  return jsonLabel(field.value)
}

function resourceSlotUuid(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).uuid === 'string'
  ) return String((value as Record<string, unknown>).uuid)
  return ''
}

function schemaLabel(schema: Record<string, unknown>): string {
  if (typeof schema.type === 'string') return schemaTypeLabel(schema.type)
  if (Array.isArray(schema.anyOf)) return '允许为空'
  if (typeof schema.$slot === 'string') return '资源位'
  return 'JSON'
}

function schemaTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    string: '文本',
    integer: '整数',
    number: '数值',
    boolean: '布尔值',
    object: '对象',
    array: '列表'
  }
  return labels[type] ?? type
}

function jsonLabel(value: unknown): string {
  if (typeof value === 'string') return value
  const encoded = JSON.stringify(value)
  return encoded === undefined ? '' : encoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
