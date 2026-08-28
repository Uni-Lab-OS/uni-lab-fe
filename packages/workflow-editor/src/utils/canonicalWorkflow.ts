import type { WorkflowRevision } from '@unilab/services'
import type {
  WorkflowLink,
  WorkflowNode,
  WorkflowStructure
} from './parseWorkflow'

export interface CanonicalWorkflowParseResult extends WorkflowStructure {
  revision: WorkflowRevision | null
}

const SUBWORKFLOW_GROUP_PREFIX = 'subworkflow::'

export function parseCanonicalWorkflow(
  text: string
): CanonicalWorkflowParseResult {
  const empty: CanonicalWorkflowParseResult = {
    revision: null,
    nodes: [],
    links: [],
    steps: [],
    error: null
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : 'JSON 解析失败'
    }
  }
  if (!isRecord(value)) return { ...empty, error: '工作流必须是 JSON 对象' }
  const revision = value as WorkflowRevision
  if (
    revision.schema_version !== '2' ||
    !revision.workflow_id ||
    !revision.revision_id ||
    !Array.isArray(revision.invocations) ||
    !Array.isArray(revision.control_edges)
  ) {
    return {
      ...empty,
      error: '文件不是受支持的标准工作流格式（v2）'
    }
  }
  const layout = isRecord(revision.layout) ? revision.layout : {}
  const layoutNodes = isRecord(layout.nodes) ? layout.nodes : {}
  const preliminaryNodes: WorkflowNode[] = revision.invocations.map((invocation) => {
    const position = isRecord(layoutNodes[invocation.node_id])
      ? layoutNodes[invocation.node_id] as Record<string, unknown>
      : {}
    const nodeType = String(invocation.node_type || 'action')
    const control = isRecord(invocation.control) ? invocation.control : {}
    const groupName = nodeType === 'group' ? String(control.name || '') : ''
    const subworkflow = groupName.startsWith(SUBWORKFLOW_GROUP_PREFIX)
    const displayName = subworkflow
      ? groupName.slice(SUBWORKFLOW_GROUP_PREFIX.length)
      : String(invocation.name || groupName || invocation.action_ref)
    return {
      id: invocation.node_id,
      name: displayName,
      type: nodeType,
      className: invocation.action_ref,
      labNodeType: nodeType,
      x: finite(position.x),
      y: finite(position.y),
      ...(nodeType === 'group'
        ? {
            groupKind: subworkflow ? 'subworkflow' as const : 'group' as const,
            collapsedByDefault: subworkflow
          }
        : {})
    }
  })
  const nodeIds = new Set(preliminaryNodes.map((node) => node.id))
  const sourceMap = isRecord(revision.source_map) ? revision.source_map : {}
  const sourceEntries = Array.isArray(sourceMap.entries)
    ? sourceMap.entries.filter(isRecord)
    : []
  const descendantsByGroup = new Map<string, string[]>()
  for (const node of preliminaryNodes) {
    if (node.type !== 'group') continue
    const sourceEntry = sourceEntries.find(
      (entry) => entry.node_id === node.id
    )
    descendantsByGroup.set(
      node.id,
      stringArray(sourceEntry?.compiled_node_ids).filter(
        (nodeId) => nodeId !== node.id && nodeIds.has(nodeId)
      )
    )
  }
  const parentByNode = new Map<string, string>()
  for (const node of preliminaryNodes) {
    const containingGroups = [...descendantsByGroup.entries()]
      .filter(([, descendants]) => descendants.includes(node.id))
      .sort((left, right) => left[1].length - right[1].length)
    if (containingGroups[0]) parentByNode.set(node.id, containingGroups[0][0])
  }
  const childrenByGroup = new Map(
    [...descendantsByGroup].map(([groupId]) => [groupId, [] as string[]])
  )
  for (const [nodeId, groupId] of parentByNode) {
    childrenByGroup.get(groupId)?.push(nodeId)
  }
  const nodes = preliminaryNodes.map((node) => ({
    ...node,
    ...(parentByNode.has(node.id)
      ? { parentGroupId: parentByNode.get(node.id) }
      : {}),
    ...(node.type === 'group'
      ? {
          childNodeIds: childrenByGroup.get(node.id) || [],
          descendantNodeIds: descendantsByGroup.get(node.id) || []
        }
      : {})
  }))
  const links: WorkflowLink[] = revision.control_edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: 'control',
    branch: edge.branch
  }))
  return {
    revision,
    nodes,
    links,
    steps: revision.invocations.map((invocation) => ({
      action: invocation.action_ref,
      args: isRecord(invocation.input_bindings)
        ? invocation.input_bindings
        : {},
      schema: null
    })),
    error: null
  }
}

export interface NestedWorkflowProjection {
  nodes: WorkflowNode[]
  links: WorkflowLink[]
  collapsedGroupIds: Set<string>
  hiddenNodeIds: Set<string>
}

/**
 * 把真实执行节点解析为当前折叠投影中真正可见的画布节点。
 *
 * @param nodes 完整的工作流节点集合。
 * @param collapsedGroupIds 当前折叠的组合工作流 UUID。
 * @param nodeId 需要在画布中揭示的真实节点 UUID。
 * @returns 当前画布可见的节点 UUID；未知节点保持原值。
 */
export function visibleNestedWorkflowNodeId(
  nodes: ReadonlyArray<WorkflowNode>,
  collapsedGroupIds: ReadonlySet<string>,
  nodeId: string
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  return visibleNestedWorkflowNodeIdFromIndex(
    nodeById,
    collapsedGroupIds,
    nodeId
  )
}

function visibleNestedWorkflowNodeIdFromIndex(
  nodeById: ReadonlyMap<string, WorkflowNode>,
  collapsedGroupIds: ReadonlySet<string>,
  nodeId: string
): string {
  let result = nodeId
  let current = nodeById.get(nodeId)
  const visited = new Set<string>()
  while (current?.parentGroupId && !visited.has(current.parentGroupId)) {
    const parentId = current.parentGroupId
    visited.add(parentId)
    if (collapsedGroupIds.has(parentId)) result = parentId
    current = nodeById.get(parentId)
  }
  return result
}

/**
 * 将平面工作流（Workflow）执行图投影为可折叠的组合工作流调用视图，并隐藏仅
 * 表达源码范围的原生分组节点。
 *
 * @param nodes OS 返回的完整工作流节点；其身份与父子关系保持不变。
 * @param links OS 返回的完整控制边与物料流（MaterialFlow）边。
 * @param expandedGroupIds 当前由用户展开的组合工作流调用节点 UUID 集合。
 * @returns 仅包含可见节点和重接边的投影，以及折叠和隐藏节点 UUID 集合。
 */
export function projectNestedWorkflow(
  nodes: ReadonlyArray<WorkflowNode>,
  links: ReadonlyArray<WorkflowLink>,
  expandedGroupIds: ReadonlySet<string>
): NestedWorkflowProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const nativeGroupIds = new Set(
    nodes
      .filter((node) =>
        node.type.toLowerCase() === 'group' &&
        node.groupKind !== 'subworkflow'
      )
      .map((node) => node.id)
  )
  const collapsedGroupIds = new Set(
    nodes
      .filter(
        (node) =>
          node.groupKind === 'subworkflow' &&
          node.collapsedByDefault &&
          !expandedGroupIds.has(node.id)
      )
      .map((node) => node.id)
  )
  const representative = (nodeId: string): string =>
    visibleNestedWorkflowNodeIdFromIndex(
      nodeById,
      collapsedGroupIds,
      nodeId
    )
  const hiddenNodeIds = new Set(
    nodes
      .filter((node) => representative(node.id) !== node.id)
      .map((node) => node.id)
  )
  const projectedLinks: WorkflowLink[] = []
  const linkKeys = new Set<string>()
  for (const link of links) {
    if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue
    if (nativeGroupIds.has(link.source) || nativeGroupIds.has(link.target)) {
      continue
    }
    const source = representative(link.source)
    const target = representative(link.target)
    if (source === target) continue
    const key = JSON.stringify([source, target, link.type, link.branch ?? null])
    if (linkKeys.has(key)) continue
    linkKeys.add(key)
    projectedLinks.push({ ...link, source, target })
  }
  return {
    nodes: nodes.filter((node) =>
      !hiddenNodeIds.has(node.id) && !nativeGroupIds.has(node.id)
    ),
    links: projectedLinks,
    collapsedGroupIds,
    hiddenNodeIds
  }
}

export function remapWorkflowBreakpoints(
  previous: WorkflowRevision,
  next: WorkflowRevision,
  breakpoints: ReadonlySet<string>
): Set<string> {
  const nextIds = new Set(next.invocations.map((item) => item.node_id))
  const mapped = new Set<string>()
  for (const nodeId of breakpoints) {
    if (nextIds.has(nodeId)) {
      mapped.add(nodeId)
      continue
    }
    const previousInvocation = previous.invocations.find(
      (item) => item.node_id === nodeId
    )
    if (!previousInvocation) continue
    const samePrevious = previous.invocations.filter(
      (item) => sameInvocationKind(item, previousInvocation)
    )
    const ordinal = samePrevious.findIndex((item) => item.node_id === nodeId)
    const sameNext = next.invocations.filter(
      (item) => sameInvocationKind(item, previousInvocation)
    )
    const replacement = sameNext[Math.max(0, ordinal)]
    if (replacement) mapped.add(replacement.node_id)
  }
  return mapped
}

export function remapWorkflowNodeId(
  previous: WorkflowRevision,
  next: WorkflowRevision,
  nodeId: string | null
): string | null {
  if (!nodeId) return null
  return remapWorkflowBreakpoints(previous, next, new Set([nodeId]))
    .values()
    .next()
    .value ?? null
}

export function createWorkflowExecutionScope(
  nodes: ReadonlyArray<WorkflowNode>,
  links: ReadonlyArray<WorkflowLink>,
  startNodeId: string | null
): {
  startNodeId: string | null
  executableNodeIds: Set<string>
  beforeStartNodeIds: Set<string>
} {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const normalizedStart = startNodeId && nodeIds.has(startNodeId)
    ? startNodeId
    : null
  if (!normalizedStart) {
    return {
      startNodeId: null,
      executableNodeIds: nodeIds,
      beforeStartNodeIds: new Set()
    }
  }

  const outgoing = new Map(
    nodes.map((node) => [node.id, [] as string[]])
  )
  for (const link of links) {
    if (nodeIds.has(link.source) && nodeIds.has(link.target)) {
      outgoing.get(link.source)?.push(link.target)
    }
  }
  const executableNodeIds = new Set<string>()
  const pending = [normalizedStart]
  while (pending.length > 0) {
    const current = pending.pop() as string
    if (executableNodeIds.has(current)) continue
    executableNodeIds.add(current)
    pending.push(...(outgoing.get(current) || []))
  }
  return {
    startNodeId: normalizedStart,
    executableNodeIds,
    beforeStartNodeIds: new Set(
      nodes
        .map((node) => node.id)
        .filter((nodeId) => !executableNodeIds.has(nodeId))
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function sameInvocationKind(
  left: WorkflowRevision['invocations'][number],
  right: WorkflowRevision['invocations'][number]
): boolean {
  return (
    left.action_ref === right.action_ref &&
    String(left.node_type || 'action') === String(right.node_type || 'action')
  )
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

export const CONTROL_DAG_REVISION: WorkflowRevision = {
  schema_version: '2',
  revision_id: 'control-demo-rev-1',
  workflow_id: 'control-demo',
  invocations: [
    {
      node_id: 'measure',
      action_ref: 'balance-1.measure',
      name: '称量样品'
    },
    {
      node_id: 'branch',
      action_ref: 'os_control.branch',
      node_type: 'branch',
      name: '质量是否合格？',
      input_bindings: {
        condition: { kind: 'literal', value: true }
      }
    },
    {
      node_id: 'dose',
      action_ref: 'pump-1.dose',
      name: '合格：定量加液',
      input_bindings: {
        volume: { kind: 'literal', value: 5 }
      }
    },
    {
      node_id: 'inspect',
      action_ref: 'camera-1.inspect',
      name: '不合格：视觉复检'
    },
    {
      node_id: 'join',
      action_ref: 'os_control.join',
      node_type: 'join',
      name: '分支汇合'
    },
    {
      node_id: 'heat',
      action_ref: 'heater-1.heat',
      name: '加热至 60°C',
      input_bindings: {
        temperature: { kind: 'literal', value: 60 }
      }
    }
  ],
  control_edges: [
    { edge_id: 'e1', source: 'measure', target: 'branch' },
    {
      edge_id: 'e2',
      source: 'branch',
      target: 'dose',
      branch: 'true'
    },
    {
      edge_id: 'e3',
      source: 'branch',
      target: 'inspect',
      branch: 'false'
    },
    { edge_id: 'e4', source: 'dose', target: 'join' },
    { edge_id: 'e5', source: 'inspect', target: 'join' },
    { edge_id: 'e6', source: 'join', target: 'heat' }
  ],
  layout: {
    nodes: {
      measure: { x: 30, y: 170 },
      branch: { x: 245, y: 170 },
      dose: { x: 465, y: 70 },
      inspect: { x: 465, y: 275 },
      join: { x: 690, y: 170 },
      heat: { x: 905, y: 170 }
    }
  }
}

export const CONTROL_DAG_JSON = JSON.stringify(
  CONTROL_DAG_REVISION,
  null,
  2
)
