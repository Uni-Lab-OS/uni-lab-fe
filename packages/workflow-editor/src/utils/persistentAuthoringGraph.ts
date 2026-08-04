import type { WorkflowAuthoringGraph } from '@unilab/services'

import type {
  WorkflowLink,
  WorkflowNode,
  WorkflowStructure
} from './parseWorkflow'

export function projectPersistentAuthoringGraph(
  graph: WorkflowAuthoringGraph
): WorkflowStructure {
  const templates = new Map(
    graph.node_templates.map((template) => [
      String(template.uuid || ''),
      template
    ])
  )
  const handlesByTemplate = new Map<string, WorkflowNode['handles']>()
  for (const handle of graph.handle_templates) {
    const templateUuid = String(handle.workflow_node_template_uuid || '')
    const ioType = String(handle.io_type || '')
    if (!templateUuid || (ioType !== 'source' && ioType !== 'target')) continue
    const handles = handlesByTemplate.get(templateUuid) ?? []
    const metaData = isRecord(handle.meta_data) ? handle.meta_data : {}
    const unilab = isRecord(metaData.unilab) ? metaData.unilab : {}
    const valueSchema = isRecord(unilab.value_schema)
      ? unilab.value_schema
      : undefined
    const handleKey = String(handle.handle_key || '')
    const dataKey = typeof handle.data_key === 'string'
      ? handle.data_key
      : null
    const displayName = String(handle.display_name || handleKey)
    const schemaTitle = valueSchema
      ? nullableString(valueSchema.title)
      : null
    const schemaDescription = valueSchema
      ? nullableString(valueSchema.description)
      : null
    const title = nullableString(handle.title) ?? schemaTitle ?? (
      displayName !== (dataKey || handleKey) ? displayName : null
    )
    const description = nullableString(handle.description) ?? schemaDescription
    const allowlist = stringArrayOrNull(
      unilab.allowed_resource_template_uuids
    )
    handles.push({
      uuid: String(handle.uuid || ''),
      handleKey,
      displayName,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ioType,
      ...(typeof handle.type === 'string'
        ? { valueType: handle.type }
        : {}),
      ...(valueSchema ? { valueSchema } : {}),
      ...(typeof handle.data_key === 'string' || handle.data_key === null
        ? { dataKey: handle.data_key }
        : {}),
      ...(typeof unilab.editor_control === 'string' ||
        unilab.editor_control === null
        ? { editorControl: unilab.editor_control }
        : {}),
      ...(allowlist !== undefined
        ? { allowedResourceTemplateUuids: allowlist }
        : {}),
      ...(typeof unilab.implicit_passthrough === 'boolean'
        ? { implicitPassthrough: unilab.implicit_passthrough }
        : {})
    })
    handlesByTemplate.set(templateUuid, handles)
  }
  const nodeByUuid = new Map(
    graph.nodes.map((node) => [String(node.uuid || ''), node])
  )
  const childrenByParent = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const nodeUuid = String(node.uuid || '')
    const parentUuid = nullableString(node.parent_uuid)
    if (!nodeUuid || !parentUuid || !nodeByUuid.has(parentUuid)) continue
    const children = childrenByParent.get(parentUuid) ?? []
    children.push(nodeUuid)
    childrenByParent.set(parentUuid, children)
  }
  const compositeByNode = new Map<string, PublishedWorkflowProjection>()
  for (const node of graph.nodes) {
    const nodeUuid = String(node.uuid || '')
    const templateUuid = String(node.workflow_node_template_uuid || '')
    const projection = publishedWorkflowProjection(templates.get(templateUuid))
    if (nodeUuid && projection) compositeByNode.set(nodeUuid, projection)
  }
  const owningComposite = (nodeUuid: string): string | null => {
    let current = nodeByUuid.get(nodeUuid)
    const visited = new Set<string>()
    while (current) {
      const parentUuid = nullableString(current.parent_uuid)
      if (!parentUuid || visited.has(parentUuid)) return null
      if (compositeByNode.has(parentUuid)) return parentUuid
      visited.add(parentUuid)
      current = nodeByUuid.get(parentUuid)
    }
    return null
  }
  const descendants = (nodeUuid: string): string[] => {
    const result: string[] = []
    const visited = new Set([nodeUuid])
    const visit = (parentUuid: string): void => {
      for (const childUuid of childrenByParent.get(parentUuid) ?? []) {
        if (visited.has(childUuid)) continue
        visited.add(childUuid)
        result.push(childUuid)
        visit(childUuid)
      }
    }
    visit(nodeUuid)
    return result
  }
  const nodes: WorkflowNode[] = graph.nodes.map((node) => {
    const nodeUuid = String(node.uuid)
    const templateUuid = String(node.workflow_node_template_uuid || '')
    const template = templates.get(templateUuid)
    const composite = compositeByNode.get(nodeUuid)
    const parentUuid = nullableString(node.parent_uuid)
    const ownerUuid = composite ? nodeUuid : owningComposite(nodeUuid)
    const owner = ownerUuid ? compositeByNode.get(ownerUuid) : undefined
    const type = String(
      node.type || template?.node_type || template?.type || 'action'
    )
    const position = nodePosition(node.pose)
    const param = isRecord(node.param) ? node.param : {}
    const mount = isRecord(param.mount) ? param.mount : {}
    return {
      id: nodeUuid,
      name: String(
        node.name || template?.display_name || template?.name || node.uuid
      ),
      type,
      className: String(
        node.action_type || node.action_name || template?.class || type
      ),
      labNodeType: type,
      handles: handlesByTemplate.get(templateUuid) ?? [],
      ...(parentUuid && nodeByUuid.has(parentUuid)
        ? { parentGroupId: parentUuid, authoringReadOnly: true }
        : {}),
      ...(composite
        ? {
            groupKind: 'subworkflow' as const,
            childNodeIds: [...(childrenByParent.get(nodeUuid) ?? [])],
            descendantNodeIds: descendants(nodeUuid),
            collapsedByDefault: true,
            openChildWorkflowUuid: composite.workflowUuid,
            compositeSignature: [
              String(graph.workflow.uuid || ''),
              String(graph.workflow.revision ?? ''),
              nodeUuid,
              composite.contractDigest
            ].join(':')
          }
        : owner
          ? { openChildWorkflowUuid: owner.workflowUuid }
          : {}),
      ...(type === 'material_source'
        ? {
            materialSource: {
              mode: String(param.mode || ''),
              flowRole: String(param.flow_role || ''),
              mountUuid: String(mount.uuid || '')
            }
          }
        : {}),
      ...position
    }
  })
  const links: WorkflowLink[] = graph.edges.map((edge) => {
    const metaData = isRecord(edge.meta_data) ? edge.meta_data : {}
    return {
      source: String(edge.source_node_uuid),
      target: String(edge.target_node_uuid),
      type: 'control',
      sourceHandleUuid: String(edge.source_handle_uuid || ''),
      targetHandleUuid: String(edge.target_handle_uuid || ''),
      branch: typeof metaData.branch === 'string'
        ? metaData.branch
        : null
    }
  })
  return {
    nodes,
    links,
    steps: graph.nodes.map((node) => ({
      action: String(node.action_name || node.type || 'action'),
      args: isRecord(node.param) ? node.param : {},
      schema: null
    })),
    error: null
  }
}

interface PublishedWorkflowProjection {
  workflowUuid: string
  contractDigest: string
}

function publishedWorkflowProjection(
  template: Record<string, unknown> | undefined
): PublishedWorkflowProjection | null {
  if (!template) return null
  const schema = isRecord(template.schema) ? template.schema : {}
  const contract = isRecord(schema['x-unilabos-workflow-contract'])
    ? schema['x-unilabos-workflow-contract']
    : null
  if (!contract || contract.version !== 1) return null
  const workflowUuid = nullableString(contract.workflow_uuid)
  const contractDigest = nullableString(contract.contract_digest)
  if (!workflowUuid || !contractDigest) return null
  return { workflowUuid, contractDigest }
}

export function updatePersistentAuthoringNodeName(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  rawName: string
): WorkflowAuthoringGraph {
  const name = rawName.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('节点名称必须是可生成 Python 的标识符')
  }
  if (graph.nodes.some(
    (node) => node.uuid !== nodeUuid && node.name === name
  )) {
    throw new Error('节点名称不能重复')
  }
  if (!graph.nodes.some((node) => node.uuid === nodeUuid)) {
    throw new Error('节点不存在或已被删除')
  }
  if (graph.nodes.some((node) =>
    node.uuid === nodeUuid &&
    node.parent_uuid !== undefined &&
    node.parent_uuid !== null
  )) {
    throw new Error('复合工作流的内部私有节点只读；请编辑调用边界')
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.uuid !== nodeUuid) return node
      return {
        ...node,
        name
      }
    })
  }
}

export function parseWorkflowAuthoringGraphImport(
  content: string,
  workflowUuid: string
): WorkflowAuthoringGraph {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('JSON 文件无法解析，请检查文件格式')
  }
  const root = isRecord(parsed) && isRecord(parsed.data)
    ? parsed.data
    : parsed
  const graph = importedGraphCandidate(root)
  if (!isWorkflowAuthoringGraph(graph)) {
    throw new Error(
      '当前持久 Authoring 只接受 OS WorkflowAuthoringGraph 导出；' +
      'Canonical v2/Cloud JSON 需要先提供 OS conversion contract'
    )
  }
  const importedWorkflowUuid = String(graph.workflow.uuid || '')
  if (!importedWorkflowUuid) {
    throw new Error('导入的工作流编辑数据缺少 workflow.uuid')
  }
  if (importedWorkflowUuid !== workflowUuid) {
    throw new Error(
      `导入文件属于 Workflow ${importedWorkflowUuid}，` +
      `不能覆盖当前 Workflow ${workflowUuid}`
    )
  }
  return graph
}

function importedGraphCandidate(value: unknown): unknown {
  if (!isRecord(value)) return null
  if (isRecord(value.graph)) return value.graph
  if (isRecord(value.candidate) && isRecord(value.candidate.graph)) {
    return value.candidate.graph
  }
  if (isRecord(value.applied_graph)) return value.applied_graph
  return value
}

function isWorkflowAuthoringGraph(
  value: unknown
): value is WorkflowAuthoringGraph {
  if (!isRecord(value) || !isRecord(value.workflow)) return false
  return [
    value.nodes,
    value.edges,
    value.node_templates,
    value.handle_templates
  ].every((items) =>
    Array.isArray(items) && items.every((item) => isRecord(item))
  )
}

function nodePosition(value: unknown): { x?: number; y?: number } {
  const pose = isRecord(value) ? value : {}
  const position = isRecord(pose.position) ? pose.position : pose
  return {
    ...(finite(position.x) === undefined ? {} : { x: finite(position.x) }),
    ...(finite(position.y) === undefined ? {} : { y: finite(position.y) })
  }
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function stringArrayOrNull(value: unknown): string[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value)) return undefined
  if (!value.every((item) => typeof item === 'string')) return undefined
  return [...value]
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
