import type { WorkflowAuthoringGraph } from '@unilab/services'

/** 与 OS ``keyword.iskeyword`` 对齐的 Python 关键字集合。 */
const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
])

/**
 * 把展示文本规范为安全 Python 局部名称（对齐 OS ``_safe_identifier``）。
 *
 * @param value 节点名或候选结果变量。
 * @param fallback 清洗为空时的替代名。
 */
export function authoringSafeIdentifier(
  value: string,
  fallback = 'result'
): string {
  let normalized = value.replace(/\W+/gu, '_').replace(/^_+|_+$/g, '')
  if (!normalized || /^\d/u.test(normalized)) normalized = fallback
  if (PYTHON_KEYWORDS.has(normalized)) normalized = `${normalized}_value`
  return normalized
}

/** 读取图中已占用的作者源码顺序，返回下一个可用非负整数。 */
export function nextAuthoringSourceOrder(
  graph: WorkflowAuthoringGraph
): number {
  let maxOrder = -1
  for (const node of graph.nodes) {
    const meta = recordOrNull(node.meta_data)
    const unilab = meta ? recordOrNull(meta.unilab) : null
    const order = unilab?.authoring_source_order
    if (typeof order === 'number' && Number.isInteger(order) && order >= 0) {
      maxOrder = Math.max(maxOrder, order)
    }
  }
  return maxOrder + 1
}

/**
 * 构造画布新建节点所需的作者身份元数据。
 *
 * OS validate 会把图再编译一遍并要求与输入语义等价；缺少
 * ``authoring_result_name`` / ``authoring_source_order`` 时会稳定报
 * ``round_trip_mismatch``。
 */
export function createAuthoringNodeMeta(
  graph: WorkflowAuthoringGraph,
  nodeName: string,
  extraUnilab: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    unilab: {
      input_bindings: {},
      authoring_result_name: authoringSafeIdentifier(nodeName),
      authoring_source_order: nextAuthoringSourceOrder(graph),
      ...extraUnilab
    }
  }
}

/** 按执行依赖稳定排序源码编号；保留节点数组、坐标及其他作者元数据。 */
export function reorderAuthoringSourceAfterConnection(
  graph: WorkflowAuthoringGraph
): WorkflowAuthoringGraph {
  const entries = graph.nodes.map((node, index) => {
    if (typeof node.uuid !== 'string' || !node.uuid) {
      throw new Error('工作流节点标识缺失')
    }
    const meta = recordOrNull(node.meta_data)
    const unilab = recordOrNull(meta?.unilab)
    const order = unilab?.authoring_source_order
    return {
      uuid: node.uuid,
      index,
      order: typeof order === 'number' && Number.isInteger(order) && order >= 0
        ? order
        : Infinity
    }
  })
  const byUuid = new Map(entries.map((entry) => [entry.uuid, entry]))
  if (byUuid.size !== entries.length) throw new Error('工作流节点标识重复')
  const incoming = new Map(entries.map((entry) => [entry.uuid, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const source = String(edge.source_node_uuid)
    const target = String(edge.target_node_uuid)
    if (!byUuid.has(source) || !byUuid.has(target)) {
      throw new Error('工作流连线引用了不存在的节点')
    }
    const targets = outgoing.get(source) ?? []
    targets.push(target)
    outgoing.set(source, targets)
    incoming.set(target, incoming.get(target)! + 1)
  }
  const ready = entries.filter((entry) => incoming.get(entry.uuid) === 0)
  const orderedUuids: string[] = []
  while (ready.length > 0) {
    // 无依赖冲突时优先沿用源码顺序；缺少编号时使用原节点数组顺序。
    ready.sort((left, right) => left.order - right.order || left.index - right.index)
    const entry = ready.shift()!
    orderedUuids.push(entry.uuid)
    for (const target of outgoing.get(entry.uuid) ?? []) {
      const count = incoming.get(target)! - 1
      incoming.set(target, count)
      if (count === 0) ready.push(byUuid.get(target)!)
    }
  }
  if (orderedUuids.length !== entries.length) {
    throw new Error('工作流连线会形成环路')
  }
  const sourceOrder = new Map(orderedUuids.map((uuid, index) => [uuid, index]))
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const meta = recordOrNull(node.meta_data) ?? {}
      const unilab = recordOrNull(meta.unilab) ?? {}
      const order = sourceOrder.get(String(node.uuid))!
      if (unilab.authoring_source_order === order) return node
      return {
        ...node,
        meta_data: {
          ...meta,
          unilab: { ...unilab, authoring_source_order: order }
        }
      }
    })
  }
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
