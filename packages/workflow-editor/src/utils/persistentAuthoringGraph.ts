import type {
  WorkflowAuthoringGraph,
  WorkflowMaterialSourceCatalogSnapshot
} from '@unilab/services'

import type {
  WorkflowLink,
  WorkflowNode,
  WorkflowStructure
} from './parseWorkflow'
import { layoutDag } from './dagLayout'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from './workflowDagLayoutStrategy'
import { layoutWorkflowMaterialSwimlanes } from './workflowMaterialSwimlaneLayout'
import {
  workflowNodeVisualKind,
  type WorkflowNodeVisualKind
} from './workflowNodeVisualKind'
import { workflowNodeDeletionDisabledReason } from './workflowGraphDeletion'
import {
  handleTemplateIndex,
  nodeTemplateIndex,
  resourceTemplateIndex
} from './persistentAuthoringProjectionIndexes'

export function projectPersistentAuthoringGraph(
  graph: WorkflowAuthoringGraph,
  materialSourceCatalog?: Pick<
    WorkflowMaterialSourceCatalogSnapshot,
    'resourceTemplates'
  > | null
): WorkflowStructure {
  const resourceTemplateByUuid = resourceTemplateIndex(materialSourceCatalog)
  const templates = nodeTemplateIndex(graph)
  const handlesByTemplate = handleTemplateIndex(graph)
  const nodeByUuid = nodeIndex(graph)
  const childrenByParent = childNodeIndex(graph, nodeByUuid)
  const compositeByNode = compositeNodeIndex(graph, templates)
  const { owningComposite, descendants } = graphHierarchyNavigation(
    nodeByUuid,
    childrenByParent,
    compositeByNode
  )
  const projectionContext: NodeProjectionContext = {
    graph,
    resourceTemplateByUuid,
    templates,
    handlesByTemplate,
    nodeByUuid,
    childrenByParent,
    compositeByNode,
    owningComposite,
    descendants
  }
  const nodes = graph.nodes.map((node) =>
    projectPersistentAuthoringNode(node, projectionContext)
  )
  const links: WorkflowLink[] = graph.edges.map((edge) => {
    const metaData = isRecord(edge.meta_data) ? edge.meta_data : {}
    return {
      id: String(edge.uuid),
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

type AuthoringNode = WorkflowAuthoringGraph['nodes'][number]
type AuthoringNodeTemplate = WorkflowAuthoringGraph['node_templates'][number]
type MaterialSourceTemplate =
  WorkflowMaterialSourceCatalogSnapshot['resourceTemplates'][number]

interface NodeProjectionContext {
  graph: WorkflowAuthoringGraph
  resourceTemplateByUuid: Map<string, MaterialSourceTemplate>
  templates: Map<string, AuthoringNodeTemplate>
  handlesByTemplate: Map<string, WorkflowNode['handles']>
  nodeByUuid: Map<string, AuthoringNode>
  childrenByParent: Map<string, string[]>
  compositeByNode: Map<string, PublishedWorkflowProjection>
  owningComposite: (nodeUuid: string) => string | null
  descendants: (nodeUuid: string) => string[]
}

function projectPersistentAuthoringNode(
  node: AuthoringNode,
  context: NodeProjectionContext
): WorkflowNode {
  const nodeUuid = String(node.uuid)
  const templateUuid = String(node.workflow_node_template_uuid || '')
  const template = context.templates.get(templateUuid)
  const type = String(
    node.type || template?.node_type || template?.type || 'action'
  )
  return {
    ...projectNodeIdentity(node, template, type),
    handles: context.handlesByTemplate.get(templateUuid) ?? [],
    ...projectNodeParent(node, context.nodeByUuid),
    ...projectNodeReadOnlyState(node),
    ...projectCompositeState(nodeUuid, context),
    ...projectMaterialSourceState(node, type, context.resourceTemplateByUuid),
    ...nodePosition(node.pose)
  }
}

function projectNodeIdentity(
  node: AuthoringNode,
  template: AuthoringNodeTemplate | undefined,
  type: string
): Pick<WorkflowNode, 'id' | 'name' | 'type' | 'className' | 'labNodeType'> {
  return {
    id: String(node.uuid),
    name: String(
      node.name || template?.display_name || template?.name || node.uuid
    ),
    type,
    className: String(
      node.action_type || node.action_name || template?.class || type
    ),
    labNodeType: type
  }
}

function projectNodeParent(
  node: AuthoringNode,
  nodeByUuid: Map<string, AuthoringNode>
): Pick<WorkflowNode, 'parentGroupId'> {
  const parentUuid = nullableString(node.parent_uuid)
  if (!parentUuid || !nodeByUuid.has(parentUuid)) return {}
  return { parentGroupId: parentUuid }
}

function projectNodeReadOnlyState(
  node: AuthoringNode
): Pick<WorkflowNode, 'authoringReadOnly' | 'authoringReadOnlyReason'> {
  const reason = workflowNodeDeletionDisabledReason(node)
  if (!reason) return {}
  return { authoringReadOnly: true, authoringReadOnlyReason: reason }
}

function projectCompositeState(
  nodeUuid: string,
  context: NodeProjectionContext
): Pick<WorkflowNode,
  | 'groupKind'
  | 'childNodeIds'
  | 'descendantNodeIds'
  | 'collapsedByDefault'
  | 'openChildWorkflowUuid'
  | 'visualKind'
  | 'compositeSignature'
> {
  const composite = context.compositeByNode.get(nodeUuid)
  if (!composite) {
    const ownerUuid = context.owningComposite(nodeUuid)
    const owner = ownerUuid
      ? context.compositeByNode.get(ownerUuid)
      : undefined
    return owner ? { openChildWorkflowUuid: owner.workflowUuid } : {}
  }
  return {
    groupKind: 'subworkflow',
    childNodeIds: [...(context.childrenByParent.get(nodeUuid) ?? [])],
    descendantNodeIds: context.descendants(nodeUuid),
    collapsedByDefault: true,
    openChildWorkflowUuid: composite.workflowUuid,
    ...(composite.visualKind ? { visualKind: composite.visualKind } : {}),
    compositeSignature: [
      String(context.graph.workflow.uuid || ''),
      String(context.graph.workflow.revision ?? ''),
      nodeUuid,
      composite.contractDigest
    ].join(':')
  }
}

function projectMaterialSourceState(
  node: AuthoringNode,
  type: string,
  resourceTemplateByUuid: Map<string, MaterialSourceTemplate>
): Pick<WorkflowNode, 'materialSource'> {
  if (type !== 'material_source') return {}
  const param = isRecord(node.param) ? node.param : {}
  const mount = isRecord(param.mount) ? param.mount : {}
  const resourceTemplateUuid = String(param.resource_template_uuid || '')
  const resourceTemplate = resourceTemplateByUuid.get(resourceTemplateUuid)
  return {
    materialSource: {
      mode: String(param.mode || ''),
      flowRole: String(param.flow_role || ''),
      mountUuid: String(mount.uuid || ''),
      resourceTemplateUuid,
      ...(resourceTemplate?.shape ? { shape: resourceTemplate.shape } : {})
    }
  }
}

function nodeIndex(graph: WorkflowAuthoringGraph): Map<string, AuthoringNode> {
  return new Map(graph.nodes.map((node) => [String(node.uuid || ''), node]))
}

function childNodeIndex(
  graph: WorkflowAuthoringGraph,
  nodeByUuid: Map<string, AuthoringNode>
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const nodeUuid = String(node.uuid || '')
    const parentUuid = nullableString(node.parent_uuid)
    if (!nodeUuid || !parentUuid || !nodeByUuid.has(parentUuid)) continue
    const children = index.get(parentUuid) ?? []
    children.push(nodeUuid)
    index.set(parentUuid, children)
  }
  return index
}

function compositeNodeIndex(
  graph: WorkflowAuthoringGraph,
  templates: Map<string, AuthoringNodeTemplate>
): Map<string, PublishedWorkflowProjection> {
  const index = new Map<string, PublishedWorkflowProjection>()
  for (const node of graph.nodes) {
    const nodeUuid = String(node.uuid || '')
    const templateUuid = String(node.workflow_node_template_uuid || '')
    const projection = publishedWorkflowProjection(templates.get(templateUuid))
    if (nodeUuid && projection) index.set(nodeUuid, projection)
  }
  return index
}

function graphHierarchyNavigation(
  nodeByUuid: Map<string, AuthoringNode>,
  childrenByParent: Map<string, string[]>,
  compositeByNode: Map<string, PublishedWorkflowProjection>
): {
  owningComposite: (nodeUuid: string) => string | null
  descendants: (nodeUuid: string) => string[]
} {
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
  return { owningComposite, descendants }
}

/**
 * 按完整工作流拓扑重新排列持久编写图，同时保留 OS 节点姿态中的非平面信息。
 *
 * @param graph OS 返回或前端候选区持有的工作流编写图。
 * @param strategy 用户选择的工作流（Workflow）画布布局策略。
 * @param swimlaneDirection 物料泳道策略当前选中的流向。
 * @returns 新的工作流编写图；原图及其节点不会被修改。
 */
export function beautifyPersistentAuthoringGraph(
  graph: WorkflowAuthoringGraph,
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
): WorkflowAuthoringGraph {
  const structure = projectPersistentAuthoringGraph(graph)
  // 六边形物料来源比动作条更高；上移一小段可保证第一条物料流明确向下。
  const materialSourceNodeIds = new Set(
    structure.nodes
      .filter((node) => node.type === 'material_source')
      .map((node) => node.id)
  )
  const layout = strategy === 'material-swimlanes'
    ? layoutWorkflowMaterialSwimlanes(
        structure.nodes,
        structure.links,
        swimlaneDirection
      )
    : layoutDag(structure.nodes, structure.links, {
        preserveExistingPositions: false
      })
  const positionByNodeUuid = new Map(
    layout.nodes.map((node) => [node.id, {
      x: node.x,
      y: materialSourceNodeIds.has(node.id) && layout.direction === 'vertical'
        ? node.y - 24
        : node.y
    }])
  )
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const nodeUuid = String(node.uuid || '')
      const position = positionByNodeUuid.get(nodeUuid)
      if (!position) return node
      const pose = isRecord(node.pose) ? node.pose : {}
      const previousPosition = isRecord(pose.position) ? pose.position : {}
      return {
        ...node,
        pose: {
          ...pose,
          position: {
            ...previousPosition,
            ...position
          }
        }
      }
    })
  }
}

interface PublishedWorkflowProjection {
  workflowUuid: string
  contractDigest: string
  visualKind?: WorkflowNodeVisualKind
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
  const metaData = isRecord(template.meta_data) ? template.meta_data : {}
  const unilab = isRecord(metaData.unilab) ? metaData.unilab : {}
  const source = isRecord(unilab.workflow_source)
    ? unilab.workflow_source
    : {}
  const visualKind = workflowNodeVisualKind({
    symbol: nullableString(source.symbol),
    definitionFqid: nullableString(source.definition_fqid)
  })
  return {
    workflowUuid,
    contractDigest,
    ...(visualKind ? { visualKind } : {})
  }
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

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
