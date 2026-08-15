export type WorkflowNodeVisualKind = 'robot-transfer'

export interface PublishedWorkflowSourceIdentity {
  symbol?: string | null
  definitionFqid?: string | null
}

const MATERIAL_TRANSFER_SYMBOLS = new Set([
  'material_transfer',
  's_z_lab_标准物料转运',
  'robot_a_material_transfer',
  'robot_b_material_transfer'
])

const MATERIAL_TRANSFER_DEFINITION_FQIDS = new Set([
  'szlab_poly_studio.workflows.material_transfer.s_z_lab_标准物料转运',
  'pylabrobot_unilab.workflows.material_transfer_robot_a.' +
    'robot_a_material_transfer',
  'pylabrobot_unilab.workflows.material_transfer_robot_b.' +
    'robot_b_material_transfer'
])

/**
 * 根据已发布工作流的来源身份选择画布视觉，不从可编辑节点名称推断语义。
 *
 * @param source OS 模板中 `meta_data.unilab.workflow_source` 的稳定来源字段。
 * @returns 当前支持的专用节点视觉；无匹配时返回空。
 */
export function workflowNodeVisualKind(
  source: PublishedWorkflowSourceIdentity
): WorkflowNodeVisualKind | undefined {
  return (
    typeof source.symbol === 'string' &&
      MATERIAL_TRANSFER_SYMBOLS.has(source.symbol)
  ) || (
    typeof source.definitionFqid === 'string' &&
      MATERIAL_TRANSFER_DEFINITION_FQIDS.has(source.definitionFqid)
  )
    ? 'robot-transfer'
    : undefined
}
