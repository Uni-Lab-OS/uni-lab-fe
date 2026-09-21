import type { WorkflowAuthoringGraph } from '@unilab/services'

export interface WorkflowLoopEditor {
  nodeUuid: string
  loopVariable: string
  maxIterations: number
  until: Record<string, unknown>
  bodyNodeUuids: string[]
  successorNodeUuids: string[]
  candidateNodes: Array<{ uuid: string; name: string }>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
}

/** 从 Canonical repeat_until 参数投影循环编排编辑器状态。 */
export function projectWorkflowLoopEditor(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): WorkflowLoopEditor {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node || String(node.type) !== 'repeat_until') {
    throw new Error('选中节点不是循环节点')
  }
  const param = record(node.param)
  const maximum = Number(param.max_iterations)
  return {
    nodeUuid,
    loopVariable: String(param.loop_variable || 'loop'),
    maxIterations: Number.isInteger(maximum) && maximum > 0 ? maximum : 3,
    until: Object.keys(record(param.until)).length > 0 ? record(param.until) : { lit: true },
    bodyNodeUuids: strings(param.node_uuids),
    successorNodeUuids: strings(param.successor_node_uuids),
    candidateNodes: graph.nodes.flatMap((item) => {
      const uuid = String(item.uuid || '')
      const type = String(item.type || '')
      if (!uuid || uuid === nodeUuid || type === 'condition' || type === 'repeat_until') return []
      return [{ uuid, name: String(item.name || uuid) }]
    })
  }
}

/** 合并循环体成员，同步入口/出口边界，保留其它结构参数。 */
export function updateWorkflowLoopParam(
  param: unknown,
  patch: {
    loopVariable?: string
    maxIterations?: number
    until?: Record<string, unknown>
    bodyNodeUuids?: string[]
    successorNodeUuids?: string[]
  }
): Record<string, unknown> {
  const current = record(param)
  const body = patch.bodyNodeUuids ?? strings(current.node_uuids)
  const next: Record<string, unknown> = {
    ...current,
    loop_variable: (patch.loopVariable ?? String(current.loop_variable || 'loop')).trim() || 'loop',
    max_iterations: Math.max(1, Math.trunc(patch.maxIterations ?? (Number(current.max_iterations) || 3))),
    until: patch.until ?? (Object.keys(record(current.until)).length > 0 ? record(current.until) : { lit: true }),
    node_uuids: body,
    entry_node_uuids: body.length ? [body[0]!] : [],
    exit_node_uuids: body.length ? [body[body.length - 1]!] : [],
    successor_node_uuids: patch.successorNodeUuids ?? strings(current.successor_node_uuids)
  }
  return next
}

/** 把循环体成员写入 Canonical 图并同步成员 parent_uuid。 */
export function applyWorkflowLoopParam(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  param: Record<string, unknown>
): WorkflowAuthoringGraph {
  const target = graph.nodes.find((node) => node.uuid === nodeUuid)
  if (!target || String(target.type) !== 'repeat_until') {
    throw new Error('选中节点不是循环节点')
  }
  const members = new Set(strings(param.node_uuids))
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.uuid === nodeUuid) return { ...node, param }
      if (members.has(String(node.uuid))) return { ...node, parent_uuid: nodeUuid }
      if (node.parent_uuid === nodeUuid) {
        const { parent_uuid: _removed, ...rest } = node
        return rest
      }
      return node
    })
  }
}

/**
 * 把动作节点拖入或拖出 Loop，并原子维护容器成员与节点绝对坐标。
 */
export function moveWorkflowNodeToLoop(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  loopUuid: string | null,
  position: { x: number; y: number }
): WorkflowAuthoringGraph {
  const target = graph.nodes.find((node) => node.uuid === nodeUuid)
  if (!target) throw new Error('拖动的节点不存在')
  const targetType = String(target.type || '')
  if (targetType === 'condition' || targetType === 'repeat_until') {
    throw new Error('控制节点不能嵌套进循环体')
  }
  const previousParentUuid = typeof target.parent_uuid === 'string'
    ? target.parent_uuid : null
  const previousParent = previousParentUuid
    ? graph.nodes.find((node) => node.uuid === previousParentUuid) : undefined
  if (previousParentUuid && String(previousParent?.type || '') !== 'repeat_until') {
    throw new Error('复合工作流内部私有节点不能拖出调用边界')
  }
  if (loopUuid) {
    const loop = graph.nodes.find((node) => node.uuid === loopUuid)
    if (!loop || String(loop.type || '') !== 'repeat_until') {
      throw new Error('目标容器不是循环节点')
    }
  }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new Error('节点画布坐标必须是有限数值')
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.uuid === nodeUuid) {
        const pose = record(node.pose)
        const previousPosition = record(pose.position)
        const nextPose = {
          ...pose,
          position: { ...previousPosition, x: position.x, y: position.y }
        }
        if (loopUuid) return { ...node, pose: nextPose, parent_uuid: loopUuid }
        const { parent_uuid: _removed, ...withoutParent } = node
        return { ...withoutParent, pose: nextPose }
      }
      if (String(node.type || '') !== 'repeat_until') return node
      if (node.uuid !== previousParentUuid && node.uuid !== loopUuid) return node
      const current = projectWorkflowLoopEditor(graph, String(node.uuid)).bodyNodeUuids
      const members = current.filter((uuid) => uuid !== nodeUuid)
      if (node.uuid === loopUuid) members.push(nodeUuid)
      return { ...node, param: updateWorkflowLoopParam(node.param, { bodyNodeUuids: members }) }
    })
  }
}

/** 将外部节点连接到 Loop 左侧输入 handle。 */
export function connectWorkflowLoopPredecessor(
  graph: WorkflowAuthoringGraph,
  loopUuid: string,
  sourceNodeUuid: string
): WorkflowAuthoringGraph {
  return connectWorkflowLoopBoundary(
    graph,
    loopUuid,
    sourceNodeUuid,
    'predecessor_node_uuids'
  )
}

/** 将 Loop 右侧输出 handle 连接到外部后继节点。 */
export function connectWorkflowLoopSuccessor(
  graph: WorkflowAuthoringGraph,
  loopUuid: string,
  targetNodeUuid: string
): WorkflowAuthoringGraph {
  return connectWorkflowLoopBoundary(
    graph,
    loopUuid,
    targetNodeUuid,
    'successor_node_uuids'
  )
}

function connectWorkflowLoopBoundary(
  graph: WorkflowAuthoringGraph,
  loopUuid: string,
  boundaryNodeUuid: string,
  field: 'predecessor_node_uuids' | 'successor_node_uuids'
): WorkflowAuthoringGraph {
  const loop = graph.nodes.find((node) => node.uuid === loopUuid)
  const boundary = graph.nodes.find((node) => node.uuid === boundaryNodeUuid)
  if (!loop || String(loop.type || '') !== 'repeat_until') {
    throw new Error('连接边界不是循环节点')
  }
  if (!boundary) throw new Error('循环连接的外部节点不存在')
  if (boundaryNodeUuid === loopUuid) throw new Error('循环节点不能连接自身')
  if (typeof boundary.parent_uuid === 'string' && boundary.parent_uuid === loopUuid) {
    throw new Error('循环体内部节点不能作为循环外部边界')
  }
  const param = record(loop.param)
  const values = strings(param[field])
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.uuid === loopUuid
      ? {
          ...node,
          param: {
            ...param,
            [field]: [...new Set([...values, boundaryNodeUuid])]
          }
        }
      : node)
  }
}
