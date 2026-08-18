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
import { layoutWorkflowPrimarySampleFlow } from './workflowPrimarySampleLayout'
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
    disabled: node.disabled === true,
    handles: context.handlesByTemplate.get(templateUuid) ?? [],
    ...projectNodeParent(node, context.nodeByUuid),
    ...projectNodeReadOnlyState(node, context.nodeByUuid),
    ...projectCompositeState(nodeUuid, context),
    ...projectMaterialSourceState(node, type, context.resourceTemplateByUuid),
    ...nodePosition(node.pose)
  }
}

function projectNodeIdentity(
  node: AuthoringNode,
  template: AuthoringNodeTemplate | undefined,
  type: string
): Pick<
  WorkflowNode,
  'id' | 'name' | 'description' | 'type' | 'className' | 'labNodeType'
> {
  const nodeName = nullableString(node.name)
  const actionName = nullableString(node.action_name)
  const templateName = nullableString(template?.name)
  const templateDisplayName = nullableString(template?.display_name)
  const nodeUsesTechnicalDefault = Boolean(
    nodeName && (nodeName === actionName || nodeName === templateName)
  )
  const displayName = nodeUsesTechnicalDefault
    ? templateDisplayName ?? nodeName
    : nodeName ?? templateDisplayName ?? templateName
  const description = nullableString(node.description) ??
    nullableString(template?.description)
  return {
    id: String(node.uuid),
    name: displayName ?? String(node.uuid),
    ...(description ? { description } : {}),
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
  node: AuthoringNode,
  nodeByUuid: Map<string, AuthoringNode>
): Pick<WorkflowNode, 'authoringReadOnly' | 'authoringReadOnlyReason'> {
  const reason = workflowNodeDeletionDisabledReason(node, nodeByUuid)
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
    const projection = publishedWorkflowProjection(
      templates.get(templateUuid),
      node
    )
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
 * @throws 不主动抛错；不完整的拓扑由布局器的容错规则处理。
 * @safety 只写回可编辑节点的平面坐标，组合工作流私有节点姿态保持不变。
 */
export function beautifyPersistentAuthoringGraph(
  graph: WorkflowAuthoringGraph,
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
): WorkflowAuthoringGraph {
  const structure = projectPersistentAuthoringGraph(graph)
  const editableNodeUuids = new Set(
    structure.nodes
      .filter((node) => !node.authoringReadOnly)
      .map((node) => node.id)
  )
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
    : strategy === 'primary-sample-serpentine'
      ? layoutWorkflowPrimarySampleFlow(structure.nodes, structure.links)
      : layoutDag(structure.nodes, structure.links, {
          preserveExistingPositions: false
        })
  const positionByNodeUuid = new Map(
    layout.nodes
      .filter((node) => editableNodeUuids.has(node.id))
      .map((node) => [node.id, {
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

/**
 * 从目录模板读取组合工作流调用（CompositeWorkflowInvocation）的稳定投影。
 *
 * @param template 当前工作流节点模板；缺失时没有可投影的已发布工作流合同。
 * @returns 合同版本有效且身份完整时返回工作流、摘要和视觉类型，否则返回空。
 * @throws 不抛异常；非对象或非兼容合同都按不可用模板关闭失败。
 */
function publishedWorkflowProjection(
  template: Record<string, unknown> | undefined,
  node?: Record<string, unknown>
): PublishedWorkflowProjection | null {
  if (!template) return null
  const schema = workflowTemplateSchema(template.schema)
  const templateMetaData = isRecord(template.meta_data)
    ? template.meta_data
    : {}
  const templateUnilab = isRecord(templateMetaData.unilab)
    ? templateMetaData.unilab
    : {}
  const nodeMetaData = isRecord(node?.meta_data) ? node.meta_data : {}
  const nodeUnilab = isRecord(nodeMetaData.unilab) ? nodeMetaData.unilab : {}
  const contracts = [
    schema['x-unilabos-workflow-contract'],
    templateUnilab.workflow_contract,
    nodeUnilab.composite
  ].filter(isRecord).filter((contract) => contract.version === 1)
  const identities = contracts.map((contract) => ({
    workflowUuid: nullableString(
      contract.workflow_uuid ?? contract.child_workflow_uuid
    ),
    contractDigest: nullableString(contract.contract_digest)
  })).filter((identity): identity is {
    workflowUuid: string
    contractDigest: string
  } => Boolean(identity.workflowUuid && identity.contractDigest))
  if (identities.length === 0) return null
  const [{ workflowUuid, contractDigest }] = identities
  if (identities.some((identity) =>
    identity.workflowUuid !== workflowUuid ||
    identity.contractDigest !== contractDigest
  )) return null
  const templateSource = isRecord(templateUnilab.workflow_source)
    ? templateUnilab.workflow_source
    : {}
  const nodeSource = isRecord(nodeUnilab.workflow_source)
    ? nodeUnilab.workflow_source
    : {}
  const visualKind = workflowNodeVisualKind({
    symbol: nullableString(templateSource.symbol) ??
      nullableString(nodeSource.symbol),
    definitionFqid: nullableString(templateSource.definition_fqid) ??
      nullableString(nodeSource.definition_fqid)
  })
  return {
    workflowUuid,
    contractDigest,
    ...(visualKind ? { visualKind } : {})
  }
}

/**
 * 解析 OS 工作流节点模板在数据库读投影中的对象或 JSON 文本 Schema。
 *
 * @param value 节点模板的未信任 `schema` 字段。
 * @returns 合法对象 Schema；缺失、畸形 JSON 或非对象结果返回空对象。
 * @throws 不抛异常；解析失败按非已发布工作流模板关闭处理。
 */
function workflowTemplateSchema(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string') return {}
  try {
    const decoded: unknown = JSON.parse(value)
    return isRecord(decoded) ? decoded : {}
  } catch {
    return {}
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

export function updatePersistentAuthoringNodeDisabled(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  disabled: boolean
): WorkflowAuthoringGraph {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node) throw new Error('节点不存在或已被删除')
  if (node.parent_uuid !== undefined && node.parent_uuid !== null) {
    throw new Error('复合工作流的内部私有节点只读；请编辑调用边界')
  }
  return {
    ...graph,
    nodes: graph.nodes.map((item) => item.uuid === nodeUuid
      ? { ...item, disabled }
      : item)
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
