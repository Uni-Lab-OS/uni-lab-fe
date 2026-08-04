import { SlideOverDrawer } from '@unilab/design-system'
import type {
  WorkflowActionHandleTemplate,
  WorkflowAuthoringGraph
} from '@unilab/services'

import type {
  TypedActionEditorProjection,
  TypedActionFieldProjection
} from '../utils/workflowActionCatalog'

interface WorkflowActionParameterDrawerProps {
  open: boolean
  nodeName: string
  templateName: string
  editor: TypedActionEditorProjection | null
  outputHandles: readonly WorkflowActionHandleTemplate[]
  graph: WorkflowAuthoringGraph | null
  editable: boolean
  onClose: () => void
  onProviderChange: (
    field: TypedActionFieldProjection,
    provider: string
  ) => void
  onLiteralBlur: (field: TypedActionFieldProjection, raw: string) => void
  onClear: (handleUuid: string) => void
  onNull: (handleUuid: string) => void
}

export function WorkflowActionParameterDrawer({
  open,
  nodeName,
  templateName,
  editor,
  outputHandles,
  graph,
  editable,
  onClose,
  onProviderChange,
  onLiteralBlur,
  onClear,
  onNull
}: WorkflowActionParameterDrawerProps): React.JSX.Element {
  const inputCount = editor?.fields.length ?? 0
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
      <div className="persistent-authoring__parameter-drawer">
        <header>
          <div>
            <strong>设置节点参数</strong>
            <p>
              输入决定节点如何执行；输出由 OS 操作模板定义，可连接下游节点或工作流输出。
            </p>
          </div>
          <dl aria-label="节点参数数量">
            <div><dt>输入</dt><dd>{inputCount}</dd></div>
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
                  {editor.fields.map((field) => (
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
                            value={field.providerKind === 'workflow_input'
                              ? `workflow:${field.workflowInput}`
                              : field.providerKind}
                            disabled={!editable}
                            onChange={(event) => onProviderChange(
                              field,
                              event.target.value
                            )}
                          >
                            <option value="missing">未设置</option>
                            <option value="literal">固定值</option>
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
                          editable={editable}
                          onLiteralBlur={onLiteralBlur}
                        />
                      </div>

                      <div className="persistent-authoring__parameter-meta">
                        <span>{schemaLabel(field.valueSchema)}</span>
                        <span>{field.hasDefault
                          ? `默认 ${jsonLabel(field.defaultValue)}`
                          : '无默认值'}</span>
                        <span>{field.nullable ? '允许为空' : '不可为空'}</span>
                      </div>

                      <div className="persistent-authoring__parameter-actions">
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => onClear(field.handleUuid)}
                        >
                          清除值
                        </button>
                        {field.nullable && (
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() => onNull(field.handleUuid)}
                          >
                            传入空值
                          </button>
                        )}
                      </div>

                      <ParameterDiagnostics
                        diagnostics={editor.diagnostics.filter(
                          (diagnostic) => diagnostic.handleUuid === field.handleUuid
                        )}
                      />
                    </li>
                  ))}
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
    </SlideOverDrawer>
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
  editable,
  onLiteralBlur
}: {
  field: TypedActionFieldProjection
  editable: boolean
  onLiteralBlur: (field: TypedActionFieldProjection, raw: string) => void
}): React.JSX.Element {
  const disabled = !editable ||
    field.providerKind === 'workflow_input' ||
    field.providerKind === 'upstream_output'
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
        aria-label={field.editorControl === 'material_port'
          ? `${field.displayName} 物料引用（JSON）`
          : `${field.displayName} 参数值`}
        defaultValue={typedFieldInputValue(field)}
        placeholder={field.editorControl === 'material_port'
          ? '请输入物料引用（JSON）'
          : field.hasDefault
            ? `默认 ${jsonLabel(field.defaultValue)}`
            : '未设置'}
        disabled={disabled}
        onBlur={(event) => onLiteralBlur(field, event.target.value)}
      />
    </label>
  )
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
