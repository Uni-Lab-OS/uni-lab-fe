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
  view?: 'all' | 'parameters' | 'mapping' | 'inputs' | 'outputs'
  /** 操作调试右侧面板不展示物料参数。 */
  hideMaterialFields?: boolean
  /** 使用实验操作参数面板的文案，而不是节点参数面板文案。 */
  presentation?: 'node' | 'operation'
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
  view = 'all',
  hideMaterialFields = false,
  presentation = 'node',
  resourceSlotOptions,
  onProviderChange,
  onLiteralBlur,
  onResourceChange,
  onClear,
  onNull
}: WorkflowActionParameterEditorProps): React.JSX.Element {
  const visibleFields = hideMaterialFields
    ? editor?.fields.filter((field) => !isMaterialInputField(field)) ?? []
    : editor?.fields ?? []
  const visibleDiagnostics = hideMaterialFields
    ? editor?.diagnostics.filter((diagnostic) => {
        const field = editor.fields.find(
          (item) => item.handleUuid === diagnostic.handleUuid
        )
        return !field || !isMaterialInputField(field)
    }) ?? []
    : editor?.diagnostics ?? []
  const configuredInputCount = visibleFields.filter(
    (field) => field.providerKind !== 'missing'
  ).length
  const missingRequiredCount = visibleDiagnostics.filter(
    (diagnostic) => diagnostic.code === 'required_action_parameter_missing'
  ).length
  const businessOutputHandles = outputHandles.filter(
    (handle) => handle.structuralRole === null
  )
  const showParameterEditor = view === 'all' || view === 'parameters'
  const showIoMapping = view === 'all' || view === 'mapping' ||
    view === 'inputs' || view === 'outputs'
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
    <div className="persistent-authoring__parameter-drawer node-contract-editor">
        {showParameterEditor && presentation !== 'operation' && <header className="contract-editor-intro">
          <div>
            <strong>设备动作参数映射</strong>
            <p>
              参数定义来自 OS 操作模板；本节点只配置输入来源和值，输出合同保持只读。
            </p>
          </div>
          <dl aria-label="节点参数数量">
            <div><dt>已配置</dt><dd>{configuredInputCount}</dd></div>
            <div className={missingRequiredCount > 0 ? 'has-error' : undefined}>
              <dt>待补</dt><dd>{missingRequiredCount}</dd>
            </div>
            <div><dt>输出</dt><dd>{businessOutputHandles.length}</dd></div>
          </dl>
        </header>}

        {!editor ? (
          <p className="persistent-authoring__parameter-empty">
            当前节点没有可编辑的操作参数。
          </p>
        ) : (
          <div className="persistent-authoring__parameter-columns">
            {showParameterEditor && presentation === 'operation' && (
              <div className={[
                'contract-validation',
                missingRequiredCount > 0 ? 'warn' : ''
              ].filter(Boolean).join(' ')}>
                {missingRequiredCount > 0
                  ? `⚠ ${missingRequiredCount} 个必填输入仍待配置`
                  : '✓ 参数契约有效'}
              </div>
            )}
            {showParameterEditor && (
            <ParameterSection
              title={presentation === 'operation' ? '业务参数' : '输入参数'}
              description="选择参数来源；固定值和工作流输入都在此设置。"
              count={visibleFields.length}
            >
              {visibleFields.length === 0 ? (
                <p className="persistent-authoring__parameter-empty">
                  当前操作没有外部输入。
                </p>
              ) : (
                <ol className="persistent-authoring__parameter-list contract-param-list">
                  {visibleFields.map((field) => {
                    const literalDraft = literalDraftHandles.has(
                      field.handleUuid
                    )
                    const providerKind = literalDraft
                      ? 'literal'
                      : field.providerKind
                    const diagnostics = literalDraft
                      ? visibleDiagnostics.filter((diagnostic) =>
                          diagnostic.handleUuid === field.handleUuid &&
                          diagnostic.code !== 'required_action_parameter_missing'
                        )
                          : visibleDiagnostics.filter(
                          (diagnostic) =>
                            diagnostic.handleUuid === field.handleUuid
                        )
                    return (
                      <li
                        key={field.handleUuid}
                        className="contract-param-card"
                        data-workflow-handle-template-uuid={field.handleUuid}
                      >
                      <div className="persistent-authoring__parameter-heading contract-param-meta">
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

                      <div className="persistent-authoring__parameter-fields contract-source-grid">
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

                      <div className="persistent-authoring__parameter-meta contract-source-note">
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
                diagnostics={visibleDiagnostics.filter(
                  (diagnostic) => !diagnostic.handleUuid
                )}
              />
            </ParameterSection>
            )}
            {showIoMapping && (
              <WorkflowActionIoMapping
                editor={editor}
                outputHandles={businessOutputHandles}
                graph={graph}
                view={view === 'inputs' || view === 'outputs' ? view : 'all'}
                hideMaterial={hideMaterialFields}
              />
            )}
            {showParameterEditor && presentation !== 'operation' && (
              <div className={[
                'contract-validation',
                missingRequiredCount > 0 ? 'warn' : ''
              ].filter(Boolean).join(' ')}>
                {missingRequiredCount > 0
                  ? `⚠ ${missingRequiredCount} 个必填输入仍待配置`
                  : '✓ 输入映射与输出合同配置有效'}
              </div>
            )}
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
    <section className="persistent-authoring__parameter-section editable-contract-section">
      <header className="editable-contract-head">
        <strong>{title}</strong>
        <span>{count} 项 · 来源可配置</span>
      </header>
      <p className="persistent-authoring__parameter-section-note">
        {description}
      </p>
      {children}
    </section>
  )
}

/** 严格复用 HTML 原型的 mapping-section / mapping-row 输入输出合同。 */
function WorkflowActionIoMapping({
  editor,
  outputHandles,
  graph,
  view,
  hideMaterial = false
}: {
  editor: TypedActionEditorProjection
  outputHandles: readonly WorkflowActionHandleTemplate[]
  graph: WorkflowAuthoringGraph | null
  view: 'all' | 'inputs' | 'outputs'
  hideMaterial?: boolean
}): React.JSX.Element {
  const materialInputs = hideMaterial
    ? []
    : editor.fields.filter(isMaterialInputField)
  const deviceInputs = editor.fields.filter((field) => !isMaterialInputField(field))
  const materialOutputs = hideMaterial
    ? []
    : outputHandles.filter(isMaterialOutputHandle)
  const deviceOutputs = outputHandles.filter(
    (handle) => !isMaterialOutputHandle(handle)
  )
  const showInputs = view !== 'outputs'
  const showOutputs = view !== 'inputs'
  const hasMaterialContract = (
    showInputs && materialInputs.length > 0
  ) || (
    showOutputs && materialOutputs.length > 0
  )
  return (
    <div className="persistent-authoring__mapping-contract">
      <div className="mapping-toolbar">
        <span>{view === 'inputs'
          ? '输入来自 OS 操作模板与当前节点绑定'
          : view === 'outputs'
            ? '输出来自 OS 操作模板的只读 Handle'
            : '参数来自 OS 操作模板与真实 Handle'}</span>
      </div>
      <MappingSection
        title="设备参数"
        description={view === 'inputs'
          ? '输入契约'
          : view === 'outputs' ? '输出契约' : '输入与输出契约'}
        inputs={deviceInputs}
        outputs={deviceOutputs}
        editor={editor}
        graph={graph}
        showInputs={showInputs}
        showOutputs={showOutputs}
      />
      {hasMaterialContract && (
        <MappingSection
          material
          title="物料参数"
          description="来源：公共物料主数据"
          inputs={materialInputs}
          outputs={materialOutputs}
          editor={editor}
          graph={graph}
          showInputs={showInputs}
          showOutputs={showOutputs}
        />
      )}
      <div className="parameter-provenance">
        {view === 'inputs'
          ? '输入映射随节点草稿保存，连接只接受真实 Handle UUID。'
          : view === 'outputs'
            ? '输出合同保持只读；实际值与运行状态由 OS 权威任务投影提供。'
            : '输入映射随节点草稿保存；输出由 OS 操作模板定义，连接只使用真实 Handle UUID。'}
      </div>
    </div>
  )
}

function MappingSection({
  material = false,
  title,
  description,
  inputs,
  outputs,
  editor,
  graph,
  showInputs,
  showOutputs
}: {
  material?: boolean
  title: string
  description: string
  inputs: readonly TypedActionFieldProjection[]
  outputs: readonly WorkflowActionHandleTemplate[]
  editor: TypedActionEditorProjection
  graph: WorkflowAuthoringGraph | null
  showInputs: boolean
  showOutputs: boolean
}): React.JSX.Element {
  return (
    <section className={`mapping-section${material ? ' material' : ''}`}>
      <header className="mapping-section-head">
        <strong>{title}</strong>
        <small>{description}</small>
      </header>
      {showInputs && <div className="mapping-group-label">
        {material ? '输入物料' : '输入参数'}
      </div>}
      {showInputs && (inputs.length === 0 ? (
        <p className="mapping-empty">没有声明输入</p>
      ) : inputs.map((field) => (
        <div
          key={field.handleUuid}
          className="mapping-row"
          data-workflow-handle-template-uuid={field.handleUuid}
        >
          <div>
            <code>{field.dataKey}</code>
            <small>← {inputProviderLabel(field)}</small>
          </div>
          <strong>{inputValueLabel(field)}</strong>
        </div>
      )))}
      {showOutputs && <div className="mapping-group-label">
        {material ? '输出物料' : '输出参数'}
      </div>}
      {showOutputs && (outputs.length === 0 ? (
        <p className="mapping-empty">没有声明输出</p>
      ) : outputs.map((handle) => {
        const destinations = outputDestinations(
          graph,
          editor.nodeUuid,
          handle.uuid
        )
        return (
          <div
            key={handle.uuid}
            className="mapping-row"
            data-workflow-handle-template-uuid={handle.uuid}
            title={`端口 UUID · ${handle.uuid}`}
          >
            <div>
              <code>{handle.handleKey}</code>
              <small>← OS 动作结果 · {handle.displayName}</small>
            </div>
            <strong>
              {destinations.length > 0
                ? `${destinations.length} 处使用`
                : handle.valueType || schemaLabel(handle.valueSchema)}
            </strong>
            {destinations.length > 0 && (
              <span className="mapping-row-destinations">
                {destinations.join(' · ')}
              </span>
            )}
          </div>
        )
      }))}
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

function isMaterialInputField(field: TypedActionFieldProjection): boolean {
  return field.editorControl === 'material_port' ||
    isResourceSlotSchema(field.valueSchema)
}

function isMaterialOutputHandle(handle: WorkflowActionHandleTemplate): boolean {
  return handle.editorControl === 'material_port' ||
    handle.valueType === 'ResourceSlot' ||
    isResourceSlotSchema(handle.valueSchema)
}

function isResourceSlotSchema(schema: unknown): boolean {
  return isRecord(schema) && schema.$slot === 'ResourceSlot'
}

function inputProviderLabel(field: TypedActionFieldProjection): string {
  if (field.providerKind === 'workflow_input') {
    return `工作流输入 ${field.workflowInput || field.dataKey}`
  }
  if (field.providerKind === 'upstream_output') return '上一节点输出'
  if (field.providerKind === 'missing') return '尚未配置'
  return field.editorControl === 'material_port'
    ? '公共物料主数据'
    : '当前节点固定值'
}

function inputValueLabel(field: TypedActionFieldProjection): string {
  if (field.providerKind === 'missing') {
    return field.required ? '必填' : '可选'
  }
  if (field.providerKind === 'workflow_input') return '运行时提供'
  if (field.providerKind === 'upstream_output') return '按拓扑解析'
  if (field.value === undefined) {
    return field.hasDefault ? jsonLabel(field.defaultValue) : '未设置'
  }
  return jsonLabel(field.value)
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
