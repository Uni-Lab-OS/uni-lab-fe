import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

export type BackendWorkflowGraphRecord = Record<string, unknown>

export interface BackendWorkflowGraph {
  workflow: BackendWorkflowGraphRecord & {
    uuid: string
    revision: number
    name?: string
  }
  nodes: Array<BackendWorkflowGraphRecord & {
    uuid: string
    name: string
    type: string
    disabled: boolean
  }>
  edges: Array<BackendWorkflowGraphRecord & {
    uuid: string
    source_node_uuid: string
    target_node_uuid: string
    source_handle_uuid: string
    target_handle_uuid: string
  }>
  node_templates: BackendWorkflowGraphRecord[]
  handle_templates: BackendWorkflowGraphRecord[]
  inventory_requirements: BackendWorkflowGraphRecord[]
}

/** 读取 Go Backend 可由画布直接编辑的完整工作流图。 */
export async function loadBackendEditableWorkflowGraph(
  http: HttpClient,
  workflowUuid: string
): Promise<BackendWorkflowGraph> {
  return decodeBackendEditableWorkflowGraph(
    await requestData<unknown>(
      http,
      `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/graph`
    ),
    workflowUuid
  )
}

/**
 * 通过 Go Backend revision CAS 原子保存完整画布图。
 * 响应的新 revision 是后续编辑的唯一基线。
 */
export async function saveBackendEditableWorkflowGraph(
  http: HttpClient,
  workflowUuid: string,
  graph: BackendWorkflowGraph
): Promise<BackendWorkflowGraph> {
  if (graph.workflow.uuid !== workflowUuid) {
    throw invalidBackendWorkflowGraph('workflow UUID changed before save')
  }
  const saved = await requestData<unknown>(
    http,
    `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/graph`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: graph.workflow.revision,
        nodes: graph.nodes.map(writableNode),
        edges: graph.edges.map(writableEdge),
        inventory_requirements: graph.inventory_requirements
      })
    }
  )
  return decodeBackendEditableWorkflowGraph(saved, workflowUuid)
}

function decodeBackendEditableWorkflowGraph(
  value: unknown,
  workflowUuid: string
): BackendWorkflowGraph {
  const graph = record(value)
  const workflow = record(graph.workflow)
  if (
    workflow.uuid !== workflowUuid ||
    !Number.isSafeInteger(workflow.revision) ||
    Number(workflow.revision) < 0
  ) throw invalidBackendWorkflowGraph('invalid workflow identity or revision')
  const nodes = array(graph.nodes).map((value, index) => {
    const node = record(value)
    if (
      !text(node.uuid) ||
      !text(node.name) ||
      !text(node.type) ||
      typeof node.disabled !== 'boolean'
    ) throw invalidBackendWorkflowGraph(`invalid node at index ${index}`)
    return node as BackendWorkflowGraph['nodes'][number]
  })
  const edges = array(graph.edges).map((value, index) => {
    const edge = record(value)
    if (
      !text(edge.uuid) ||
      !text(edge.source_node_uuid) ||
      !text(edge.target_node_uuid) ||
      !text(edge.source_handle_uuid) ||
      !text(edge.target_handle_uuid)
    ) throw invalidBackendWorkflowGraph(`invalid edge at index ${index}`)
    return edge as BackendWorkflowGraph['edges'][number]
  })
  return {
    workflow: workflow as BackendWorkflowGraph['workflow'],
    nodes,
    edges,
    node_templates: array(graph.node_templates).map(record),
    handle_templates: array(graph.handle_templates).map(record),
    inventory_requirements: array(graph.inventory_requirements).map(record)
  }
}

function writableNode(node: BackendWorkflowGraph['nodes'][number]) {
  return select(node, [
    'uuid',
    'workflow_node_template_uuid',
    'parent_uuid',
    'material_uuid',
    'name',
    'type',
    'pose',
    'param',
    'execution_policy',
    'disabled',
    'minimized',
    'script',
    'description',
    'meta_data'
  ])
}

function writableEdge(edge: BackendWorkflowGraph['edges'][number]) {
  return select(edge, [
    'uuid',
    'source_node_uuid',
    'target_node_uuid',
    'source_handle_uuid',
    'target_handle_uuid',
    'description',
    'meta_data'
  ])
}

function select(
  source: BackendWorkflowGraphRecord,
  fields: readonly string[]
): BackendWorkflowGraphRecord {
  return Object.fromEntries(fields
    .filter(field => Object.prototype.hasOwnProperty.call(source, field))
    .map(field => [field, source[field]]))
}

function invalidBackendWorkflowGraph(message: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_WORKFLOW_GRAPH',
    message: `Backend 工作流图合同无效：${message}`,
    retryable: false
  })
}

function record(value: unknown): BackendWorkflowGraphRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as BackendWorkflowGraphRecord
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
