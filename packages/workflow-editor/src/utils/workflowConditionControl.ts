import type { WorkflowAuthoringGraph } from '@unilab/services'

export interface WorkflowConditionBranch {
  label: string
  condition: Record<string, unknown> | null
  node_uuids: string[]
  entry_node_uuids: string[]
  exit_node_uuids: string[]
}

export interface WorkflowConditionEditor {
  nodeUuid: string
  branches: WorkflowConditionBranch[]
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

function branchLabel(index: number, total: number): string {
  if (index === 0) return 'if'
  if (index === total - 1) return 'else'
  return `elif${index - 1}`
}

function normalizeBranches(values: readonly WorkflowConditionBranch[]): WorkflowConditionBranch[] {
  const seeded = values.length === 0
    ? [{ label: 'if', condition: { lit: true }, node_uuids: [], entry_node_uuids: [], exit_node_uuids: [] }]
    : values.map((branch) => ({ ...branch }))
  if (seeded.length === 1) {
    if (seeded[0]!.condition == null) seeded[0]!.condition = { lit: true }
    seeded.push({ label: 'else', condition: null, node_uuids: [], entry_node_uuids: [], exit_node_uuids: [] })
  }
  return seeded.map((branch, index) => {
    const members = strings(branch.node_uuids)
    return {
      ...branch,
      label: branchLabel(index, values.length),
      condition: index === seeded.length - 1 ? null : record(branch.condition),
      node_uuids: members,
      entry_node_uuids: members.length ? [members[0]!] : [],
      exit_node_uuids: members.length ? [members[members.length - 1]!] : []
    }
  })
}

export function projectWorkflowConditionEditor(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): WorkflowConditionEditor {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node || String(node.type) !== 'condition') {
    throw new Error('选中节点不是条件节点')
  }
  const param = record(node.param)
  const rawBranches = Array.isArray(param.branches) ? param.branches : []
  const branches = normalizeBranches(rawBranches.map((value) => {
    const branch = record(value)
    return {
      label: String(branch.label || ''),
      condition: branch.condition == null ? null : record(branch.condition),
      node_uuids: strings(branch.node_uuids),
      entry_node_uuids: strings(branch.entry_node_uuids),
      exit_node_uuids: strings(branch.exit_node_uuids)
    }
  }))
  return {
    nodeUuid,
    branches,
    candidateNodes: graph.nodes.flatMap((item) => {
      const uuid = String(item.uuid || '')
      const type = String(item.type || '')
      if (!uuid || uuid === nodeUuid || type === 'condition' || type === 'repeat_until') return []
      return [{ uuid, name: String(item.name || uuid) }]
    })
  }
}

export function addWorkflowConditionBranch(
  branches: readonly WorkflowConditionBranch[]
): WorkflowConditionBranch[] {
  const next = branches.map((branch) => ({ ...branch }))
  const previousLast = next[next.length - 1]
  if (previousLast?.condition == null) previousLast.condition = { lit: true }
  next.push({ label: '', condition: null, node_uuids: [], entry_node_uuids: [], exit_node_uuids: [] })
  return normalizeBranches(next)
}

export function removeWorkflowConditionBranch(
  branches: readonly WorkflowConditionBranch[],
  index: number
): WorkflowConditionBranch[] {
  if (branches.length <= 2) return normalizeBranches(branches)
  return normalizeBranches(branches.filter((_, branchIndex) => branchIndex !== index))
}

export function updateWorkflowConditionBranch(
  branches: readonly WorkflowConditionBranch[],
  index: number,
  patch: Partial<WorkflowConditionBranch>
): WorkflowConditionBranch[] {
  return normalizeBranches(branches.map((branch, branchIndex) =>
    branchIndex === index ? { ...branch, ...patch } : branch
  ))
}

export function updateWorkflowConditionParam(
  param: unknown,
  branches: readonly WorkflowConditionBranch[]
): Record<string, unknown> {
  return { ...record(param), branches: normalizeBranches(branches) }
}

export function applyWorkflowConditionParam(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  param: Record<string, unknown>
): WorkflowAuthoringGraph {
  const target = graph.nodes.find((node) => node.uuid === nodeUuid)
  if (!target || String(target.type) !== 'condition') {
    throw new Error('选中节点不是条件节点')
  }
  const branches = Array.isArray(param.branches) ? param.branches : []
  const members = new Set(branches.flatMap((value) =>
    strings(record(value).node_uuids)
  ))
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

/** 从 IF/ELIF/ELSE handle 直连动作节点，并把目标移入对应分支。 */
export function connectWorkflowConditionBranch(
  graph: WorkflowAuthoringGraph,
  conditionUuid: string,
  branchIndex: number,
  targetNodeUuid: string
): WorkflowAuthoringGraph {
  const target = graph.nodes.find((node) => node.uuid === targetNodeUuid)
  if (!target) throw new Error('条件分支连接的目标节点不存在')
  const targetType = String(target.type || '')
  if (targetType === 'condition' || targetType === 'repeat_until') {
    throw new Error('条件分支入口必须是动作节点')
  }
  if (typeof target.parent_uuid === 'string' && target.parent_uuid !== conditionUuid) {
    throw new Error('目标节点已属于其它控制区域，请先移出原控制区域')
  }
  const editor = projectWorkflowConditionEditor(graph, conditionUuid)
  if (branchIndex < 0 || branchIndex >= editor.branches.length) {
    throw new Error('条件分支 handle 不存在')
  }
  const withoutTarget = editor.branches.map((branch) => ({
    ...branch,
    node_uuids: branch.node_uuids.filter((uuid) => uuid !== targetNodeUuid)
  }))
  const selected = withoutTarget[branchIndex]!
  const branches = updateWorkflowConditionBranch(withoutTarget, branchIndex, {
    node_uuids: [...selected.node_uuids, targetNodeUuid]
  })
  const node = graph.nodes.find((item) => item.uuid === conditionUuid)!
  return applyWorkflowConditionParam(
    graph,
    conditionUuid,
    updateWorkflowConditionParam(node.param, branches)
  )
}
