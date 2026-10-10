import { describe, expect, it } from 'vitest'
import {
  nodeLabel,
  nodeUuid,
  resolveWorkflowResourceName,
  workflowContracts,
  workflowCounts,
  workflowNodeDetails,
  workflowTypeLabel,
  workflowValueText,
  workflowStatusLabel,
  jsonText,
  readString,
} from './workflowPresentation'

describe('workflow presentation helpers', () => {
  it('maps published graph metadata without inventing counts', () => {
    const revision = {
      source: 'os' as const,
      workflowUuid: 'wf-1',
      name: '粉末转移',
      revision: 2,
      workflowType: 'workflow' as const,
      status: 'published' as const,
      kind: 'published_revision' as const,
      graph: {
        workflow: {},
        nodes: [{ uuid: 'n-1' }],
        edges: [{ source: 'n-1', target: 'n-2' }],
        nodeTemplates: [],
        handleTemplates: [],
        inventoryRequirements: [],
      },
    }
    expect(workflowCounts(revision)).toEqual({ nodes: 1, edges: 1, requirements: 0 })
    expect(workflowTypeLabel(revision.workflowType)).toBe('工作流')
    expect(nodeUuid(revision.graph.nodes[0], 0)).toBe('n-1')
    expect(nodeLabel(revision.graph.nodes[0], 0)).toBe('节点 1')
  })

  it('derives workflow and node IO from contracts and handle templates', () => {
    const revision = {
      source: 'os' as const,
      workflowUuid: 'wf-1',
      name: '转运',
      revision: 2,
      workflowType: 'workflow' as const,
      status: 'published' as const,
      kind: 'published_revision' as const,
      graph: {
        workflow: {
          meta_data: {
            unilab: {
              output_contract: {
                outputs: [{ name: 'result', schema: { type: 'string' } }],
              },
            },
          },
        },
        inputParameters: [{ name: 'source', required: true, schema: { $slot: 'ResourceSlot' } }],
        nodes: [
          {
            uuid: 'node-1',
            name: '转运',
            type: 'ILab',
            param: {
              source: {
                uuid: 'slot-1',
                resource_template_uuid: 'template-vial',
                mount: { uuid: 'mount-1' },
                site: 'site-1',
                material_uuid: 'material-1',
              },
            },
            meta_data: { unilab: { executor_binding: { device_id: 'device-1' } } },
            workflow_node_template_uuid: 'template-1',
          },
        ],
        edges: [],
        nodeTemplates: [],
        handleTemplates: [
          {
            workflow_node_template_uuid: 'template-1',
            io_type: 'target',
            data_key: 'source',
            display_name: '来源',
            required: true,
            type: 'ResourceSlot',
          },
          {
            workflow_node_template_uuid: 'template-1',
            io_type: 'source',
            data_key: 'result',
            display_name: '结果',
            required: false,
            type: 'string',
          },
        ],
        inventoryRequirements: [
          {
            uuid: 'requirement-1',
            consumeNodeUuid: 'node-1',
            requirementKey: 'buffer',
            targetType: 'reagent',
            requiredQuantity: 100,
            quantityUnit: 'uL',
            allowSplit: false,
            metadata: {},
          },
        ],
      },
    }
    expect(workflowContracts(revision).outputs[0]?.name).toBe('result')
    const details = workflowNodeDetails(revision, revision.graph.nodes[0])
    expect(details.inputs[0]).toMatchObject({ name: '来源', value: { uuid: 'slot-1' } })
    expect(details.outputs[0]).toMatchObject({ name: '结果', ioType: 'output' })
    expect(details.resources).toEqual([
      { kind: 'device', kindLabel: '设备', value: 'device-1' },
      { kind: 'resource_template', kindLabel: '资源模板', value: 'template-vial' },
      { kind: 'material', kindLabel: '挂载物料', value: 'mount-1' },
      { kind: 'site', kindLabel: '库位', value: 'site-1' },
      { kind: 'material', kindLabel: '物料', value: 'material-1' },
      { kind: 'reagent', kindLabel: '试剂', value: 'buffer · 100 uL' },
    ])
  })

  it('resolves resource identifiers to names when a workflow directory is available', () => {
    const directory = {
      resourceTemplates: [{ uuid: 'template-1', displayName: '烧杯' }],
      materials: [{ uuid: 'material-1', name: '样品瓶' }],
      sites: [{ uuid: 'site-1', name: 'S041' }],
      devices: [{ deviceUuid: 'device-1', deviceKey: 'mixer', label: '混合器' }],
    }
    expect(resolveWorkflowResourceName('resource_template', 'template-1', directory)).toBe('烧杯')
    expect(resolveWorkflowResourceName('site', 'site-1', directory)).toBe('S041')
    expect(resolveWorkflowResourceName('site', 'material-1', directory)).toBe('样品瓶')
    expect(resolveWorkflowResourceName('device', 'device-1', directory)).toBe('混合器')
    expect(workflowValueText({ uuid: 'material-1' }, directory)).toBe('样品瓶')
    expect(workflowValueText('site-1', directory)).toBe('S041')
  })

  it('does not infer resources from arbitrary parameter names', () => {
    const revision = {
      source: 'os' as const,
      workflowUuid: 'wf-1',
      name: '参数测试',
      revision: 1,
      workflowType: 'workflow' as const,
      status: 'published' as const,
      kind: 'published_revision' as const,
      graph: {
        workflow: {},
        nodes: [
          {
            uuid: 'node-1',
            param: { device_name: 'mixer', material_hint: 'sample-1' },
            workflow_node_template_uuid: 'template-1',
          },
        ],
        edges: [],
        nodeTemplates: [],
        handleTemplates: [
          {
            workflow_node_template_uuid: 'template-1',
            io_type: 'target',
            data_key: 'device_name',
            type: 'string',
          },
          {
            workflow_node_template_uuid: 'template-1',
            io_type: 'target',
            data_key: 'material_hint',
            type: 'string',
          },
        ],
        inventoryRequirements: [],
      },
    }

    expect(workflowNodeDetails(revision, revision.graph.nodes[0]).resources).toEqual([])
  })

  it('covers fallback resource names, contracts and value forms', () => {
    const directory = {
      resourceTemplates: [],
      materials: [],
      sites: [],
      devices: [{ deviceUuid: 'd-1', deviceKey: 'key-1', label: '设备' }],
    }
    expect(resolveWorkflowResourceName('device', 'key-1', directory)).toBe('设备')
    expect(resolveWorkflowResourceName('material', 'missing', directory)).toBe('missing')
    expect(resolveWorkflowResourceName('resource', 'x', directory)).toBe('x')
    expect(workflowValueText(null)).toBe('未填写')
    expect(workflowValueText({ a: 1 })).toContain('"a": 1')
    expect(workflowValueText('unknown', directory)).toBe('unknown')
    expect(workflowStatusLabel('published')).toBe('已发布')
    expect(workflowStatusLabel('source')).toBe('未发布')
    expect(readString({ title: '标题' }, ['name', 'title'])).toBe('标题')
    expect(readString(undefined, ['name'])).toBeNull()
    expect(jsonText(null)).toBe('暂无后端数据')
    const revision = {
      source: 'os' as const, workflowUuid: 'wf', name: 'W', revision: 1, workflowType: 'experiment_operation' as const, status: 'source' as const, kind: 'published_revision' as const,
      graph: {
        workflow: { meta_data: { unilab: { input_contract: { parameters: [{ display_name: '输入', required: true, schema: { type: 'string' } }, null] }, output_contract: { outputs: [{ display_name: '输出', required: true, implicit: true }, null] } } } },
        nodes: [], edges: [], nodeTemplates: [], handleTemplates: [], inventoryRequirements: [],
      },
    }
    expect(workflowContracts(revision).inputs[0]).toMatchObject({ name: '输入', required: true })
    expect(workflowContracts(revision).outputs[0]).toMatchObject({ name: '输出', implicit: true })
  })
})
