import type { WorkflowActionNodeTemplate, WorkflowAuthoringGraph } from '@unilab/services'

/** 人工确认包装保留设备动作模板、参数及连线身份，与 OS frontend 合同一致。 */
export function configureManualConfirmation(
  graph: WorkflowAuthoringGraph, nodeUuid: string, template: WorkflowActionNodeTemplate,
  config: { deviceUuid: string; timeoutSeconds: number } | null
): WorkflowAuthoringGraph {
  const node = graph.nodes.find(item => item.uuid === nodeUuid)
  if (!node || node.workflow_node_template_uuid !== template.uuid) throw new Error('设备动作节点不存在')
  if (template.actionClass?.startsWith('unilabos.workflow.authoring:')) throw new Error('人工确认只支持设备动作')
  if (config && (!config.deviceUuid || !Number.isInteger(config.timeoutSeconds) || config.timeoutSeconds < 1 || config.timeoutSeconds > 86400)) {
    throw new Error('请选择设备，确认超时必须为 1 到 86400 的整数秒')
  }
  const meta = (node.meta_data || {}) as Record<string, unknown>
  const unilab = (meta.unilab || {}) as Record<string, unknown>
  return { ...graph, nodes: graph.nodes.map(item => item.uuid !== nodeUuid ? item : {
    ...item,
    type: config ? 'manual_confirm' : String(template.wireValue?.node_type || template.nodeType),
    manual_confirmation: config ? { timeout_seconds: config.timeoutSeconds } : {},
    ...(config ? {
      material_uuid: config.deviceUuid,
      meta_data: { ...meta, unilab: { ...unilab, executor_binding: { mode: 'fixed', device_id: config.deviceUuid } } }
    } : {})
  }) }
}
