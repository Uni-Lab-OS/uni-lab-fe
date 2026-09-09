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

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
