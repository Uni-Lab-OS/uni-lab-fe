import { describe, expect, it } from 'vitest'
import type { WorkflowActionNodeTemplate, WorkflowAuthoringGraph } from '@unilab/services'
import { configureManualConfirmation } from './workflowManualConfirmation'
const template: WorkflowActionNodeTemplate = {
  uuid: 'template', name: 'stir', displayName: '搅拌', resourceTemplateUuid: 'resource',
  nodeType: 'ILab', actionType: 'Stir', actionClass: 'device:stir',
  schema: {}, goal: {}, goalDefault: {}, handles: []
}
const graph: WorkflowAuthoringGraph = {
  workflow: { uuid: 'workflow' }, nodes: [{ uuid: 'node', name: 'stir', type: 'ILab', workflow_node_template_uuid: 'template',
    param: { speed: 42 }, meta_data: { unilab: { authoring_source_order: 0, input_bindings: { sample: 'plate' } } } }],
  edges: [], node_templates: [], handle_templates: []
}
describe('人工确认设备动作包装', () => {
  it('保留参数和作者身份，并以物料 UUID 固定设备；关闭后恢复原始类型', () => {
    const next = configureManualConfirmation(graph, 'node', template, { deviceUuid: 'device-material', timeoutSeconds: 3600 })
    expect(next.nodes[0]).toMatchObject({ type: 'manual_confirm', material_uuid: 'device-material',
      workflow_node_template_uuid: 'template', param: { speed: 42 }, manual_confirmation: { timeout_seconds: 3600 },
      meta_data: { unilab: { authoring_source_order: 0, input_bindings: { sample: 'plate' }, executor_binding: { mode: 'fixed', device_id: 'device-material' } } } })
    expect(graph.nodes[0]!.type).toBe('ILab')
    expect(configureManualConfirmation(next, 'node', template, null).nodes[0]).toMatchObject({ type: 'ILab', material_uuid: 'device-material', manual_confirmation: {}, param: { speed: 42 } })
  })
  it.each([0, 86401, 1.5, NaN])('拒绝非法超时 %s', timeoutSeconds => {
    expect(() => configureManualConfirmation(graph, 'node', template, { deviceUuid: 'device', timeoutSeconds })).toThrow('整数秒')
  })
  it('拒绝缺少设备和流程控制模板', () => {
    expect(() => configureManualConfirmation(graph, 'node', template, { deviceUuid: '', timeoutSeconds: 3600 })).toThrow('请选择设备')
    expect(() => configureManualConfirmation(graph, 'node', { ...template, actionClass: 'unilabos.workflow.authoring:condition' }, { deviceUuid: 'device', timeoutSeconds: 3600 })).toThrow('只支持设备动作')
  })
})
