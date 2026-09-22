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
    const reason = workflowNodeDeletionDisabledReason(node, nodeByUuid)
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
  recordExplicitReadySuppressions(
    next,
    graph,
    new Set(selection.edgeUuids ?? []),
    removedNodeUuids
  )
  next.nodes = clearRemovedEdgeProviders(
    next.nodes,
    next.handle_templates,
    removedEdges,
    removedNodeUuids
  )
  next.nodes = clearRemovedControlMembers(next.nodes, removedNodeUuids)
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
  node: Record<string, unknown>,
  nodeByUuid?: ReadonlyMap<string, Record<string, unknown>>
): string | null {
  const parentUuid = typeof node.parent_uuid === 'string'
    ? node.parent_uuid : ''
  const parent = parentUuid ? nodeByUuid?.get(parentUuid) : undefined
  if (
    parentUuid &&
    !['condition', 'repeat_until'].includes(String(parent?.type || '')) &&
    !hasOnlyPresentationGroupAncestors(node, nodeByUuid)
  ) {
    return '复合工作流内部私有节点只读；请删除或编辑调用边界'
  }
  const unilab = nodeUnilab(node)
  // Condition and RepeatUntil are authoring controls. They may carry
  // framework metadata, but remain user-owned canvas nodes and must be
  // deletable from the editor.
  const controlNode = node.type === 'condition' || node.type === 'repeat_until'
  if (
    node.type === 'group' ||
    unilab.presentation_group === true ||
    unilab.authoring_read_only === true ||
    (!controlNode && unilab.system_generated === true)
  ) return '系统生成或结构节点只读，不能直接删除'
  return null
}

/**
 * 判断节点的所有父级是否只是作者源码中的展示分组。
 *
 * 展示分组不构成组合工作流私有边界；其中的调用节点仍是作者可编辑的调用边界。
 * 一旦父链进入真实 Composite 或缺失节点，则保持 fail-closed。
 */
function hasOnlyPresentationGroupAncestors(
  node: Record<string, unknown>,
  nodeByUuid: ReadonlyMap<string, Record<string, unknown>> | undefined
): boolean {
  if (!nodeByUuid) return false
  let parentUuid = stringValue(node.parent_uuid)
  const visited = new Set<string>()
  while (parentUuid) {
    if (visited.has(parentUuid)) return false
    visited.add(parentUuid)
    const parent = nodeByUuid.get(parentUuid)
    if (!parent) return false
    const parentUnilab = nodeUnilab(parent)
    if (
      parent.type !== 'group' ||
      parentUnilab.presentation_group !== true ||
      parentUnilab.authoring_read_only === true ||
      parentUnilab.system_generated === true
    ) return false
    parentUuid = stringValue(parent.parent_uuid)
  }
  return true
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
    edgeUnilab.authoring_read_only === true
  ) return '工作流连线被标记为只读，不能直接删除'
  for (const nodeUuid of [
    stringValue(edge.source_node_uuid),
    stringValue(edge.target_node_uuid)
  ]) {
    if (!nodeByUuid.has(nodeUuid)) return '工作流连线引用的节点已不存在'
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
      const handle = handleByUuid.get(handleUuid)
      const dataKey = stringValue(handle?.data_key)
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
 * 把用户显式删除的 ready 边记录为交给 OS 的一次性并行化生成意图。
 *
 * 节点级联删除产生的关联边不记录；只有两端仍存在、且源/目标连接点均为 ready
 * 的直接连线选择才属于“取消先后关系”。该字段不是源码或候选图的持久语义；
 * OS 必须消费后生成真实的结构化 ``parallel/group``，并从返回图中删除该字段。
 */
function recordExplicitReadySuppressions(
  next: WorkflowAuthoringGraph,
  original: WorkflowAuthoringGraph,
  explicitlyRemovedEdgeUuids: ReadonlySet<string>,
  removedNodeUuids: ReadonlySet<string>
): void {
  if (explicitlyRemovedEdgeUuids.size === 0) return
  const handleByUuid = new Map(original.handle_templates.map((handle) => [
    stringValue(handle.uuid),
    handle
  ]))
  const additions = original.edges
    .filter((edge) => explicitlyRemovedEdgeUuids.has(stringValue(edge.uuid)))
    .filter((edge) =>
      !removedNodeUuids.has(stringValue(edge.source_node_uuid)) &&
      !removedNodeUuids.has(stringValue(edge.target_node_uuid)) &&
      isReadyHandle(handleByUuid.get(stringValue(edge.source_handle_uuid))) &&
      isReadyHandle(handleByUuid.get(stringValue(edge.target_handle_uuid)))
    )
    .map((edge) => ({
      source_node_uuid: stringValue(edge.source_node_uuid),
      target_node_uuid: stringValue(edge.target_node_uuid)
    }))
  if (additions.length === 0) return

  const metaData = { ...record(next.workflow.meta_data) }
  const unilab = { ...record(metaData.unilab) }
  const existing = Array.isArray(unilab.order_dependency_suppressions)
    ? unilab.order_dependency_suppressions
      .map(record)
      .map((item) => ({
        source_node_uuid: stringValue(item.source_node_uuid),
        target_node_uuid: stringValue(item.target_node_uuid)
      }))
      .filter((item) => item.source_node_uuid && item.target_node_uuid)
    : []
  const byIdentity = new Map([...existing, ...additions].map((item) => [
    `${item.source_node_uuid}:${item.target_node_uuid}`,
    item
  ]))
  next.workflow.meta_data = {
    ...metaData,
    unilab: {
      ...unilab,
      order_dependency_suppressions: [...byIdentity.values()].sort((left, right) =>
        left.source_node_uuid.localeCompare(right.source_node_uuid) ||
        left.target_node_uuid.localeCompare(right.target_node_uuid)
      )
    }
  } as WorkflowAuthoringGraph['workflow']['meta_data']
}

/** 判断连接点是否是只表达执行先后的 ready 结构连接点。 */
function isReadyHandle(handle: Record<string, unknown> | undefined): boolean {
  return stringValue(handle?.handle_key) === 'ready' ||
    stringValue(handle?.data_key) === 'ready'
}


/** 删除控制域成员后清理 Condition/RepeatUntil 中的所有失效 UUID。 */
function clearRemovedControlMembers(
  nodes: Array<Record<string, unknown>>,
  removedNodeUuids: ReadonlySet<string>
): Array<Record<string, unknown>> {
  return nodes.map((node) => {
    const type = stringValue(node.type)
    const param = record(node.param)
    if (type === 'condition') {
      const branches = Array.isArray(param.branches)
        ? param.branches.map((value) => {
            const branch = record(value)
            const members = retainedNodeUuids(branch.node_uuids, removedNodeUuids)
            return {
              ...branch,
              node_uuids: members,
              entry_node_uuids: members.length > 0 ? [members[0]] : [],
              exit_node_uuids: members.length > 0 ? [members[members.length - 1]] : []
            }
          })
        : []
      return {
        ...node,
        param: {
          ...param,
          predecessor_node_uuids: retainedNodeUuids(
            param.predecessor_node_uuids, removedNodeUuids
          ),
          branches
        }
      }
    }
    if (type === 'repeat_until') {
      const members = retainedNodeUuids(param.node_uuids, removedNodeUuids)
      return {
        ...node,
        param: {
          ...param,
          predecessor_node_uuids: retainedNodeUuids(
            param.predecessor_node_uuids, removedNodeUuids
          ),
          successor_node_uuids: retainedNodeUuids(
            param.successor_node_uuids, removedNodeUuids
          ),
          node_uuids: members,
          entry_node_uuids: members.length > 0 ? [members[0]] : [],
          exit_node_uuids: members.length > 0 ? [members[members.length - 1]] : []
        }
      }
    }
    return node
  })
}

function retainedNodeUuids(
  value: unknown,
  removedNodeUuids: ReadonlySet<string>
): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string')
      .filter((uuid) => !removedNodeUuids.has(uuid))
    : []
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
