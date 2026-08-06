import type { WorkflowAuthoringGraph } from '@unilab/services'

export interface WorkflowGraphDeletionSelection {
  nodeUuids?: readonly string[]
  edgeUuids?: readonly string[]
}

export type WorkflowGraphDeletionDecision =
  | {
      kind: 'allowed'
      nodeUuids: string[]
      edgeUuids: string[]
      connectedEdgeCount: number
      removedOutputCount: number
    }
  | {
      kind: 'denied'
      reason: string
    }

export interface WorkflowGraphDeletionResult {
  graph: WorkflowAuthoringGraph
  removedNodeUuids: string[]
  removedEdgeUuids: string[]
  removedOutputCount: number
}

/**
 * 判断画布选中元素能否从规范化工作流候选删除，并计算原子清理范围。
 *
 * @param graph 当前规范化工作流创作候选。
 * @param selection 用户选中的节点和连线稳定 UUID。
 * @returns 可删除时返回包含级联节点、关联边和出参影响的决策；否则返回中文原因。
 */
export function workflowGraphDeletionDecision(
  graph: WorkflowAuthoringGraph,
  selection: WorkflowGraphDeletionSelection
): WorkflowGraphDeletionDecision {
  const requestedNodeUuids = uniqueSorted(selection.nodeUuids ?? [])
  const requestedEdgeUuids = uniqueSorted(selection.edgeUuids ?? [])
  if (requestedNodeUuids.length === 0 && requestedEdgeUuids.length === 0) {
    return { kind: 'denied', reason: '请先选择允许编辑的节点或连线' }
  }

  const nodeByUuid = new Map(graph.nodes.map((node) => [
    stringValue(node.uuid),
    node
  ]))
  const edgeByUuid = new Map(graph.edges.map((edge) => [
    stringValue(edge.uuid),
    edge
  ]))
  for (const nodeUuid of requestedNodeUuids) {
    const node = nodeByUuid.get(nodeUuid)
    if (!node) return { kind: 'denied', reason: '选择的工作流节点已不存在' }
    const reason = workflowNodeDeletionDisabledReason(node)
    if (reason) return { kind: 'denied', reason }
  }
  for (const edgeUuid of requestedEdgeUuids) {
    const edge = edgeByUuid.get(edgeUuid)
    if (!edge) return { kind: 'denied', reason: '选择的工作流连线已不存在' }
    const reason = workflowEdgeDeletionDisabledReason(edge, nodeByUuid)
    if (reason) return { kind: 'denied', reason }
  }

  const removedNodeUuids = descendantNodeUuids(
    graph,
    new Set(requestedNodeUuids)
  )
  const removedEdgeUuids = new Set(requestedEdgeUuids)
  const connectedEdgeUuids = new Set<string>()
  for (const edge of graph.edges) {
    const edgeUuid = stringValue(edge.uuid)
    if (
      removedNodeUuids.has(stringValue(edge.source_node_uuid)) ||
      removedNodeUuids.has(stringValue(edge.target_node_uuid))
    ) {
      connectedEdgeUuids.add(edgeUuid)
      removedEdgeUuids.add(edgeUuid)
    }
  }

  return {
    kind: 'allowed',
    nodeUuids: [...removedNodeUuids].sort(),
    edgeUuids: [...removedEdgeUuids].sort(),
    connectedEdgeCount: connectedEdgeUuids.size,
    removedOutputCount: outputNamesOwnedByNodes(
      graph,
      removedNodeUuids
    ).size
  }
}

/**
 * 从规范化工作流候选原子删除节点或连线及其所有失效引用。
 *
 * @param graph 当前规范化工作流创作候选。
 * @param selection 已确认的节点与连线选择。
 * @returns 新候选及实际删除的节点、连线、工作流出参数量；原图保持不变。
 * @throws 选择不存在或只读元素时抛出可直接展示的中文错误。
 */
export function deleteWorkflowGraphElements(
  graph: WorkflowAuthoringGraph,
  selection: WorkflowGraphDeletionSelection
): WorkflowGraphDeletionResult {
  const decision = workflowGraphDeletionDecision(graph, selection)
  if (decision.kind === 'denied') throw new Error(decision.reason)

  const removedNodeUuids = new Set(decision.nodeUuids)
  const removedEdgeUuids = new Set(decision.edgeUuids)
  const removedEdges = graph.edges.filter((edge) =>
    removedEdgeUuids.has(stringValue(edge.uuid))
  )
  const next = structuredClone(graph)
  next.nodes = next.nodes.filter((node) =>
    !removedNodeUuids.has(stringValue(node.uuid))
  )
  next.edges = next.edges.filter((edge) =>
    !removedEdgeUuids.has(stringValue(edge.uuid))
  )
  next.nodes = clearRemovedEdgeProviders(
    next.nodes,
    next.handle_templates,
    removedEdges,
    removedNodeUuids
  )
  removeDeletedNodeOutputs(next, removedNodeUuids)
  pruneUnreferencedTemplates(next)
  return {
    graph: next,
    removedNodeUuids: decision.nodeUuids,
    removedEdgeUuids: decision.edgeUuids,
    removedOutputCount: decision.removedOutputCount
  }
}

/**
 * 返回单个规范化工作流节点不能直接删除的原因。
 *
 * @param node OS 候选中的节点记录。
 * @returns 可删除时返回 null；内部、系统或结构节点返回中文禁用原因。
 */
export function workflowNodeDeletionDisabledReason(
  node: Record<string, unknown>
): string | null {
  if (typeof node.parent_uuid === 'string' && node.parent_uuid.length > 0) {
    return '复合工作流内部私有节点只读；请删除或编辑调用边界'
  }
  const unilab = nodeUnilab(node)
  if (
    node.type === 'group' ||
    unilab.presentation_group === true ||
    unilab.authoring_read_only === true ||
    unilab.system_generated === true
  ) return '系统生成或结构节点只读，不能直接删除'
  return null
}

/**
 * 判断连线自身及两端节点是否属于可编辑边界。
 *
 * @param edge OS 候选中的连线记录。
 * @param nodeByUuid 当前候选的节点身份索引。
 * @returns 可删除时返回 null；只读边界返回中文禁用原因。
 */
function workflowEdgeDeletionDisabledReason(
  edge: Record<string, unknown>,
  nodeByUuid: ReadonlyMap<string, Record<string, unknown>>
): string | null {
  const edgeUnilab = record(record(edge.meta_data).unilab)
  if (
    edgeUnilab.authoring_read_only === true ||
    edgeUnilab.system_generated === true
  ) return '系统生成的工作流连线只读，不能直接删除'
  for (const nodeUuid of [
    stringValue(edge.source_node_uuid),
    stringValue(edge.target_node_uuid)
  ]) {
    const node = nodeByUuid.get(nodeUuid)
    if (!node) return '工作流连线引用的节点已不存在'
    if (workflowNodeDeletionDisabledReason(node)) {
      return '复合工作流内部或系统节点的连线只读，不能直接删除'
    }
  }
  return null
}

/**
 * 扩展删除节点集合，确保调用边界的所有私有后代随边界原子移除。
 *
 * @param graph 当前规范化工作流候选。
 * @param roots 用户直接选择的可编辑节点 UUID。
 * @returns 包含所有后代的稳定节点 UUID 集合。
 */
function descendantNodeUuids(
  graph: WorkflowAuthoringGraph,
  roots: ReadonlySet<string>
): Set<string> {
  const removed = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const node of graph.nodes) {
      const nodeUuid = stringValue(node.uuid)
      const parentUuid = stringValue(node.parent_uuid)
      if (!removed.has(nodeUuid) && removed.has(parentUuid)) {
        removed.add(nodeUuid)
        changed = true
      }
    }
  }
  return removed
}

/**
 * 清理已删除连线在剩余目标节点中的实参和工作流入参绑定。
 *
 * @param nodes 已去除删除节点的候选节点数组。
 * @param handles 删除前候选中的连接点模板数组。
 * @param removedEdges 本次删除的完整连线记录。
 * @param removedNodeUuids 本次删除的节点 UUID 集合。
 * @returns 清理目标连接点提供者后的新节点数组。
 */
function clearRemovedEdgeProviders(
  nodes: Array<Record<string, unknown>>,
  handles: Array<Record<string, unknown>>,
  removedEdges: Array<Record<string, unknown>>,
  removedNodeUuids: ReadonlySet<string>
): Array<Record<string, unknown>> {
  const targetHandlesByNode = new Map<string, Set<string>>()
  for (const edge of removedEdges) {
    const targetNodeUuid = stringValue(edge.target_node_uuid)
    if (removedNodeUuids.has(targetNodeUuid)) continue
    const targetHandles = targetHandlesByNode.get(targetNodeUuid) ?? new Set()
    targetHandles.add(stringValue(edge.target_handle_uuid))
    targetHandlesByNode.set(targetNodeUuid, targetHandles)
  }
  const handleByUuid = new Map(handles.map((handle) => [
    stringValue(handle.uuid),
    handle
  ]))
  return nodes.map((node) => {
    const targetHandles = targetHandlesByNode.get(stringValue(node.uuid))
    if (!targetHandles || targetHandles.size === 0) return node
    const param = { ...record(node.param) }
    const metaData = { ...record(node.meta_data) }
    const unilab = { ...record(metaData.unilab) }
    const inputBindings = { ...record(unilab.input_bindings) }
    const resourceRefs = { ...record(unilab.resource_refs) }
    for (const handleUuid of targetHandles) {
      const dataKey = stringValue(handleByUuid.get(handleUuid)?.data_key)
      if (dataKey) delete param[dataKey]
      delete inputBindings[handleUuid]
      delete resourceRefs[handleUuid]
    }
    const nextUnilab: Record<string, unknown> = {
      ...unilab,
      input_bindings: inputBindings
    }
    if (Object.keys(resourceRefs).length > 0) {
      nextUnilab.resource_refs = resourceRefs
    } else {
      delete nextUnilab.resource_refs
    }
    return {
      ...node,
      param,
      meta_data: {
        ...metaData,
        unilab: nextUnilab
      }
    }
  })
}

/**
 * 删除引用已移除节点的显式工作流出参描述与绑定。
 *
 * @param graph 正在构造的新规范化工作流候选。
 * @param removedNodeUuids 已移除节点 UUID 集合。
 * @returns 无返回值；仅修改传入的独立候选副本。
 */
function removeDeletedNodeOutputs(
  graph: WorkflowAuthoringGraph,
  removedNodeUuids: ReadonlySet<string>
): void {
  const removedNames = outputNamesOwnedByNodes(graph, removedNodeUuids)
  if (removedNames.size === 0) return
  const metaData = { ...record(graph.workflow.meta_data) }
  const unilab = { ...record(metaData.unilab) }
  const outputContract = { ...record(unilab.output_contract) }
  const outputs = Array.isArray(outputContract.outputs)
    ? outputContract.outputs.filter((output) =>
        !removedNames.has(stringValue(record(output).name))
      )
    : []
  const outputBindings = { ...record(unilab.output_bindings) }
  for (const outputName of removedNames) delete outputBindings[outputName]
  graph.workflow.meta_data = {
    ...metaData,
    unilab: {
      ...unilab,
      output_contract: { ...outputContract, outputs },
      output_bindings: outputBindings
    }
  } as WorkflowAuthoringGraph['workflow']['meta_data']
}

/**
 * 收集工作流出参中由指定节点提供的名称。
 *
 * @param graph 当前规范化工作流候选。
 * @param nodeUuids 即将删除的节点 UUID 集合。
 * @returns 需要随节点删除的工作流出参名称集合。
 */
function outputNamesOwnedByNodes(
  graph: WorkflowAuthoringGraph,
  nodeUuids: ReadonlySet<string>
): Set<string> {
  const unilab = record(record(graph.workflow.meta_data).unilab)
  const bindings = record(unilab.output_bindings)
  return new Set(Object.entries(bindings)
    .filter(([, rawBinding]) => {
      const binding = record(rawBinding)
      return binding.kind === 'node_output' &&
        nodeUuids.has(stringValue(binding.workflow_node_uuid))
    })
    .map(([name]) => name))
}

/**
 * 移除没有任何剩余节点引用的节点模板及其连接点模板。
 *
 * @param graph 正在构造的新规范化工作流候选。
 * @returns 无返回值；仅修改传入的独立候选副本。
 */
function pruneUnreferencedTemplates(graph: WorkflowAuthoringGraph): void {
  const templateUuids = new Set(graph.nodes.map((node) =>
    stringValue(node.workflow_node_template_uuid)
  ))
  graph.node_templates = graph.node_templates.filter((template) =>
    templateUuids.has(stringValue(template.uuid))
  )
  graph.handle_templates = graph.handle_templates.filter((handle) =>
    templateUuids.has(stringValue(handle.workflow_node_template_uuid))
  )
}

/** 读取节点级 Uni-Lab 创作元数据。 */
function nodeUnilab(node: Record<string, unknown>): Record<string, unknown> {
  return record(record(node.meta_data).unilab)
}

/** 去重并按稳定 UUID 排序用户选择。 */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

/** 把未知值收敛为空字符串或其原始字符串值。 */
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把未知值安全投影为普通对象。 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
