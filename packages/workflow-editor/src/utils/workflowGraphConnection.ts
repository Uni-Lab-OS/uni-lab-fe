import type { WorkflowAuthoringGraph } from '@unilab/services'

/** 判断新增 source → target 是否让 target 已有路径回到 source。 */
export function wouldCreateWorkflowCycle(
  graph: WorkflowAuthoringGraph,
  sourceNodeUuid: string,
  targetNodeUuid: string
): boolean {
  if (sourceNodeUuid === targetNodeUuid) return true
  const targetsBySource = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const source = requiredUuid(edge.source_node_uuid)
    const target = requiredUuid(edge.target_node_uuid)
    const targets = targetsBySource.get(source) ?? []
    targets.push(target)
    targetsBySource.set(source, targets)
  }
  const pending = [targetNodeUuid]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === sourceNodeUuid) return true
    visited.add(current)
    pending.push(...(targetsBySource.get(current) ?? []))
  }
  return false
}

function requiredUuid(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('工作流连线节点标识缺失')
  }
  return value
}
