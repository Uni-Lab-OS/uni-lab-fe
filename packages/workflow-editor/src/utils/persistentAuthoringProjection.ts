import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringSourceMapEntry,
  WorkflowIoMetadata
} from '@unilab/services'

import { authoringProjection } from './persistentAuthoringSession'
import type { TypedActionFieldProjection } from './workflowActionCatalog'

/** 为目录缺失的资源模板生成稳定短标签。 */
export function shortTemplateLabel(uuid: string): string {
  return `Template · ${uuid.replace(/-/g, '').slice(-6)}`
}

/** 从候选图读取完整工作流输入输出合同。 */
export function workflowIoMetadata(
  graph: WorkflowAuthoringGraph
): WorkflowIoMetadata | null {
  const unilab = graph.workflow.meta_data?.unilab
  if (
    !unilab?.input_contract ||
    !unilab.output_contract ||
    !unilab.output_bindings
  ) return null
  return {
    input_contract: unilab.input_contract,
    output_contract: unilab.output_contract,
    output_bindings: unilab.output_bindings
  }
}

/** 选择当前聚合中可供编辑器展示的权威 Python 文本。 */
export function authoritativePython(
  aggregate: WorkflowAuthoringAggregate
): string {
  return aggregate.draft?.python_source ||
    aggregate.applied_source?.python_source ||
    ''
}

/** 选择与给定 Python 文本严格对应的源代码映射。 */
export function workflowSourceMap(
  aggregate: WorkflowAuthoringAggregate | null,
  source: string
): WorkflowAuthoringSourceMapEntry[] {
  if (!aggregate) return []
  if (
    aggregate.candidate &&
    (
      aggregate.candidate.normalized_python_source === source ||
      (
        aggregate.draft?.python_source === source &&
        aggregate.candidate.draft_hash === aggregate.draft.draft_hash
      )
    )
  ) return aggregate.candidate.source_map
  if (aggregate.applied_source?.python_source === source) {
    return aggregate.applied_source.source_map
  }
  return []
}

/** 用远端工作流身份重定位本地候选图，同时保留本地节点编辑。 */
export function rebaseGraphIdentity(
  local: WorkflowAuthoringGraph,
  remote: WorkflowAuthoringAggregate
): WorkflowAuthoringGraph {
  const remoteGraph = authoringProjection(remote).graph
  return {
    ...local,
    workflow: {
      ...local.workflow,
      ...remoteGraph.workflow
    }
  }
}

/** 将 OS 签发的候选图投影为稳定、只读的 JSON 文本。 */
export function workflowGraphJsonProjection(
  graph: WorkflowAuthoringGraph
): string {
  return JSON.stringify({
    nodes: graph.nodes,
    edges: graph.edges,
    workflow: graph.workflow,
    node_templates: graph.node_templates,
    handle_templates: graph.handle_templates
  }, null, 2)
}

/** 把未知异常转换为可展示消息。 */
export function errorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return /reconnecting channel/i.test(message)
    ? '连接暂时中断，恢复后将自动重试。'
    : message
}

/** 按动作句柄 schema 解析表单原始值。 */
export function parseTypedFieldValue(
  field: TypedActionFieldProjection,
  raw: string
): unknown {
  if (field.enumValues) return raw === '' ? undefined : JSON.parse(raw)
  const base = typedNonNullSchema(field.valueSchema)
  if (base.$slot === 'ResourceSlot') {
    if (raw.trim() === '') return undefined
    try {
      const value: unknown = JSON.parse(raw)
      if (!isRecordValue(value)) throw new Error('not an object')
      return value
    } catch {
      throw new Error(`${field.displayName}必须是明确 Material reference JSON`)
    }
  }
  if (base.type === 'string') return raw
  if (base.type === 'number' || base.type === 'integer') {
    if (raw.trim() === '') return undefined
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      throw new Error(`${field.displayName}必须是有限数字`)
    }
    if (base.type === 'integer' && !Number.isInteger(value)) {
      throw new Error(`${field.displayName}必须是整数`)
    }
    return value
  }
  if (base.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') {
      throw new Error(`${field.displayName}必须是 true 或 false`)
    }
    return raw === 'true'
  }
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${field.displayName}必须是合法 JSON`)
  }
}

/** 从 nullable anyOf 中选择实际字段 schema。 */
function typedNonNullSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  if (!Array.isArray(schema.anyOf)) return schema
  const value = schema.anyOf.find((item) =>
    item && typeof item === 'object' &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type !== 'null'
  )
  return value as Record<string, unknown> || {}
}

/** 判断未知值是否为普通记录对象。 */
export function isRecordValue(
  value: unknown
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
