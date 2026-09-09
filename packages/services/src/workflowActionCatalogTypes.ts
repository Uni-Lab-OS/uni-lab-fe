/** 工作流动作模板编辑控件。 */
export type WorkflowActionEditorControl =
  | 'material_port'
  | 'site_selector'
  | 'variable_selector'

/** 动作或已发布工作流（PublishedWorkflow）的连接点模板。 */
export interface WorkflowActionHandleTemplate {
  uuid: string
  workflowNodeTemplateUuid: string
  handleKey: string
  ioType: 'source' | 'target'
  displayName: string
  valueType: string
  required: boolean
  dataSource: string | null
  dataKey: string | null
  valueSchema: Record<string, unknown>
  editorControl: WorkflowActionEditorControl
  allowedResourceTemplateUuids: string[] | null
  implicitPassthrough: boolean
  structuralRole: 'ready' | null
  wireValue?: Record<string, unknown>
}

/** 可由工作流编辑器实例化的动作节点模板。 */
export interface WorkflowActionNodeTemplate {
  uuid: string
  resourceTemplateUuid: string
  name: string
  displayName: string
  actionClass: string | null
  actionType: string
  /** Backend 节点类型（如 ``ILab``）；画布实例必须写入节点 ``type``，不能回落成 ``device``。 */
  nodeType: string
  schema: Record<string, unknown>
  goal: Record<string, unknown>
  goalDefault: Record<string, unknown>
  handles: WorkflowActionHandleTemplate[]
  wireValue?: Record<string, unknown>
}

/** 已发布工作流（PublishedWorkflow）的软件包来源证据。 */
export interface WorkflowPublishedSource {
  kind: 'package'
  definitionFqid: string
  module: string
  symbol: string
  packageCatalogDigest: string
  definitionContentHash: string
}

/** 作为边界节点使用的已发布工作流（PublishedWorkflow）模板。 */
export interface WorkflowPublishedNodeTemplate {
  uuid: string
  resourceTemplateUuid: string
  name: string
  displayName: string
  workflowClass: string
  workflowUuid: string
  workflowRevision: number
  appliedSourceHash: string
  contractDigest: string
  compositionAllowTransparent: boolean
  inputOrder: string[]
  outputOrder: string[]
  schema: Record<string, unknown>
  goal: Record<string, unknown>
  goalDefault: Record<string, unknown>
  result: Record<string, unknown>
  source: WorkflowPublishedSource
  handles: WorkflowActionHandleTemplate[]
  wireValue?: Record<string, unknown>
}

/** 动作与已发布工作流（PublishedWorkflow）的统一目录快照。 */
export interface WorkflowExecutableCatalogSnapshot {
  authorityId?: string
  authorityKind?: 'local' | 'backend'
  fingerprint?: string
  actionTemplates: WorkflowActionNodeTemplate[]
  workflowTemplates: WorkflowPublishedNodeTemplate[]
}

/** 兼容既有调用方的动作目录类型名称。 */
export type WorkflowActionCatalogSnapshot = WorkflowExecutableCatalogSnapshot
