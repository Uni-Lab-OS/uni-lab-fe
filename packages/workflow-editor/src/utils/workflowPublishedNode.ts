import type {
  WorkflowActionCatalogSnapshot,
  WorkflowActionHandleTemplate,
  WorkflowAuthoringGraph,
  WorkflowPublishedNodeTemplate
} from '@unilab/services'

/** 从真实已发布工作流目录创建一个折叠的调用边界节点。 */
export function createPublishedWorkflowNode(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    nodeUuid: string
    templateUuid: string
    name: string
    position?: { x: number; y: number }
  }
): WorkflowAuthoringGraph {
  const template = publishedWorkflowTemplate(catalog, input.templateUuid)
  if (graph.nodes.some((node) => node.uuid === input.nodeUuid)) {
    throw new Error('工作流节点 UUID 已存在')
  }
  if (!input.name || graph.nodes.some((node) => node.name === input.name)) {
    throw new Error('工作流节点名称无效或重复')
  }
  return {
    ...graph,
    nodes: [...graph.nodes, {
      uuid: input.nodeUuid,
      workflow_node_template_uuid: template.uuid,
      name: input.name,
      status: 'idle',
      type: 'workflow',
      pose: input.position ? { position: { ...input.position } } : {},
      param: {},
      execution_policy: {},
      disabled: false,
      minimized: false,
      meta_data: { unilab: { input_bindings: {} } }
    }],
    node_templates: appendRecords(
      graph.node_templates,
      [structuredClone(template.wireValue ?? publishedTemplateWireValue(template))]
    ),
    handle_templates: appendRecords(
      graph.handle_templates,
      template.handles.map((handle) => structuredClone(
        handle.wireValue ?? handleTemplateWireValue(handle)
      ))
    )
  }
}

function publishedWorkflowTemplate(
  catalog: WorkflowActionCatalogSnapshot,
  templateUuid: string
): WorkflowPublishedNodeTemplate {
  const template = catalog.workflowTemplates.find((item) =>
    item.uuid === templateUuid
  )
  const contract = template?.schema['x-unilabos-workflow-contract']
  if (
    !template || !contract || typeof contract !== 'object' ||
    Array.isArray(contract) ||
    (contract as Record<string, unknown>).version !== 1
  ) throw new Error('已发布工作流模板不存在')
  return template
}

function appendRecords(
  existing: Array<Record<string, unknown>>,
  additions: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const identities = new Set(existing.map((item) => requiredUuid(item.uuid)))
  const appended = [...existing]
  for (const item of additions) {
    const uuid = requiredUuid(item.uuid)
    if (identities.has(uuid)) continue
    identities.add(uuid)
    appended.push(item)
  }
  return appended
}

function publishedTemplateWireValue(
  template: WorkflowPublishedNodeTemplate
): Record<string, unknown> {
  return {
    uuid: template.uuid,
    resource_template_uuid: template.resourceTemplateUuid,
    name: template.name,
    display_name: template.displayName,
    class: template.workflowClass,
    type: 'workflow',
    node_type: 'workflow',
    schema: template.schema,
    goal: template.goal,
    goal_default: template.goalDefault,
    feedback: {},
    result: template.result,
    meta_data: { unilab: {
      framework_owner_only: true,
      workflow_source: {
        kind: template.source.kind,
        definition_fqid: template.source.definitionFqid,
        module: template.source.module,
        symbol: template.source.symbol,
        package_catalog_digest: template.source.packageCatalogDigest,
        definition_content_hash: template.source.definitionContentHash
      }
    } }
  }
}

function handleTemplateWireValue(
  handle: WorkflowActionHandleTemplate
): Record<string, unknown> {
  return {
    uuid: handle.uuid,
    workflow_node_template_uuid: handle.workflowNodeTemplateUuid,
    handle_key: handle.handleKey,
    io_type: handle.ioType,
    display_name: handle.displayName,
    type: handle.valueType,
    required: handle.required,
    data_source: handle.dataSource,
    data_key: handle.dataKey,
    meta_data: { unilab: {
      value_schema: handle.valueSchema,
      editor_control: handle.editorControl,
      allowed_resource_template_uuids: handle.allowedResourceTemplateUuids,
      implicit_passthrough: handle.implicitPassthrough,
      structural_role: handle.structuralRole
    } }
  }
}

function requiredUuid(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('目录 UUID 缺失')
  return value
}
