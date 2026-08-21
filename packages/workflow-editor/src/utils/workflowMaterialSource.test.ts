import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph,
  WorkflowMaterialSourceCatalogSnapshot
} from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  connectMaterialSourceToTypedActionEdge,
  createMaterialSourceNode,
  projectMaterialSourceEditor,
  updateMaterialSourceSelector
} from './workflowMaterialSource'

// 工作流 UUID 标识承载物料来源（MaterialSource）节点的测试创作图。
const workflowUuid = '10000000-0000-4000-8000-000000000001'
// 节点 UUID 标识测试中的唯一物料来源（MaterialSource）节点。
const nodeUuid = '20000000-0000-4000-8000-000000000001'
// 节点模板 UUID 标识物料来源框架节点合同。
const templateUuid = '30000000-0000-4000-8000-000000000001'
// 句柄模板 UUID 标识物料来源输出的物料占位符（ResourceSlot）。
const handleUuid = '40000000-0000-4000-8000-000000000001'
// 挂载物料 UUID 标识直接拥有候选库位（Site）的实例。
const mountUuid = '50000000-0000-4000-8000-000000000001'
// 固定物料 UUID 标识已有物料选择器中的具体物料（Material）。
const fixedMaterialUuid = '50000000-0000-4000-8000-000000000002'
// 资源模板 UUID 标识候选物料与库位兼容性使用的类型身份。
const resourceTemplateUuid = '60000000-0000-4000-8000-000000000001'
// 首个目录库位 UUID 字典序较小但 sort_order 较大，验证业务展示顺序。
const lateSiteUuid = '70000000-0000-4000-8000-000000000001'
// 第二目录库位 UUID 字典序较大但 sort_order 较小，验证排序优先级。
const earlySiteUuid = '70000000-0000-4000-8000-000000000009'
// 动作节点 UUID 标识消费物料占位符（ResourceSlot）的测试节点。
const actionNodeUuid = '80000000-0000-4000-8000-000000000001'
// 动作模板 UUID 标识测试中的类型化动作合同。
const actionTemplateUuid = '81000000-0000-4000-8000-000000000001'
// 动作目标句柄 UUID 标识接收物料占位符（ResourceSlot）的输入端口。
const actionTargetHandleUuid = '82000000-0000-4000-8000-000000000001'

/**
 * 注册物料来源（MaterialSource）闭合选择器测试。
 *
 * @returns 无。
 * @throws 任一选择器或物料流断言失败时由 Vitest 报告。
 */
function registerMaterialSourceClosedSelectorTests(): void {
  it('creates a non-Action framework node with the closed selector defaults', () => {
    const created = createMaterialSourceNode(catalog(), emptyGraph(), {
      nodeUuid,
      name: 'assay_plate'
    })

    expect(created.nodes).toEqual([
      expect.objectContaining({
        uuid: nodeUuid,
        workflow_node_template_uuid: templateUuid,
        name: 'assay_plate',
        type: 'material_source',
        param: {
          resource_template_uuid: resourceTemplateUuid,
          mode: 'existing',
          mount: { uuid: mountUuid },
          material_uuid: null,
          site: null,
          slot_range: null,
          flow_role: 'primary_sample'
        }
      })
    ])
    expect(created.node_templates).toHaveLength(1)
    expect(created.handle_templates).toHaveLength(1)
  })

  it('reuses the complete OS wire templates when Candidate already has MaterialSource', () => {
    const createdFirst = createMaterialSourceNode(catalog(), emptyGraph(), {
      nodeUuid,
      name: 'assay_plate'
    })
    const existing: WorkflowAuthoringGraph = {
      ...createdFirst,
      node_templates: createdFirst.node_templates.map((template) => ({
        ...template,
        header: { title: 'Canonical Candidate extension' }
      })),
      handle_templates: createdFirst.handle_templates.map((handle) => ({
        ...handle,
        description: 'Canonical Candidate extension'
      }))
    }
    const created = createMaterialSourceNode(catalog(), existing, {
      nodeUuid: '20000000-0000-4000-8000-000000000002',
      name: 'standards_plate'
    })

    expect(created.nodes).toHaveLength(2)
    expect(created.node_templates).toEqual(existing.node_templates)
    expect(created.handle_templates).toEqual(existing.handle_templates)
    expect(created.node_templates[0]).toMatchObject({
      description: 'OS-owned framework selector',
      meta_data: { unilab: { framework: true } }
    })
  })

  it(
    '库位（Site）保留 sort_order/UUID 业务顺序并规范化候选 UUID 持久化',
    preservesCatalogSiteOrder
  )

  it('clears fixed Material and enforces mutually exclusive Site forms for create_new', () => {
    const graph = createMaterialSourceNode(catalog(), emptyGraph(), {
      nodeUuid,
      name: 'assay_plate'
    })
    const updated = updateMaterialSourceSelector(catalog(), graph, nodeUuid, {
      mode: 'create_new',
      resourceTemplateUuid,
      mountUuid,
      fixedMaterialUuid,
      siteScope: 'fixed',
      fixedSiteUuid: earlySiteUuid,
      candidateSiteUuids: [lateSiteUuid],
      flowRole: 'consumable'
    })

    expect(updated.nodes[0].param).toMatchObject({
      mode: 'create_new',
      material_uuid: null,
      site: earlySiteUuid,
      slot_range: null,
      flow_role: 'consumable'
    })
  })

  it('connects its authoritative ResourceSlot source to a typed Action target', () => {
    const withSource = createMaterialSourceNode(catalog(), emptyGraph(), {
      nodeUuid,
      name: 'assay_plate'
    })
    const graph: WorkflowAuthoringGraph = {
      ...withSource,
      nodes: [
        ...withSource.nodes,
        {
          uuid: actionNodeUuid,
          workflow_node_template_uuid: actionTemplateUuid,
          name: 'consume_plate',
          type: 'device',
          status: 'idle',
          pose: {},
          param: { sample: { uuid: fixedMaterialUuid } },
          action_name: 'consume',
          execution_policy: {},
          disabled: false,
          minimized: false,
          meta_data: {
            unilab: {
              input_bindings: {
                [actionTargetHandleUuid]: { parameter: 'sample_input' }
              }
            }
          }
        }
      ]
    }

    const connected = connectMaterialSourceToTypedActionEdge(
      actionCatalog(),
      catalog(),
      graph,
      {
        sourceNodeUuid: nodeUuid,
        sourceHandleUuid: handleUuid,
        targetNodeUuid: actionNodeUuid,
        targetHandleUuid: actionTargetHandleUuid
      }
    )

    expect(connected.edges).toEqual([expect.objectContaining({
      source_node_uuid: nodeUuid,
      source_handle_uuid: handleUuid,
      target_node_uuid: actionNodeUuid,
      target_handle_uuid: actionTargetHandleUuid
    })])
    expect(connected.edges[0]?.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(connected.nodes[1]?.param).toEqual({})
    expect(connected.nodes[1]?.meta_data).toEqual({
      unilab: { input_bindings: {} }
    })

    const secondTarget: WorkflowAuthoringGraph = {
      ...connected,
      nodes: [
        ...connected.nodes,
        {
          ...connected.nodes[1]!,
          uuid: '86000000-0000-4000-8000-000000000003',
          name: 'consume_plate_again'
        }
      ]
    }
    expect(() => connectMaterialSourceToTypedActionEdge(
      actionCatalog(),
      catalog(),
      secondTarget,
      {
        sourceNodeUuid: nodeUuid,
        sourceHandleUuid: handleUuid,
        targetNodeUuid: '86000000-0000-4000-8000-000000000003',
        targetHandleUuid: actionTargetHandleUuid
      }
    )).toThrow(/输出端口.*一个目标/i)
  })
}

describe(
  '物料来源（MaterialSource）闭合选择器',
  registerMaterialSourceClosedSelectorTests
)

/**
 * 构造物料来源（MaterialSource）测试使用的闭合目录快照。
 *
 * @returns 含框架模板、挂载物料、具体物料和两个按 sort_order 排列的库位（Site）目录。
 * @throws 无。
 */
function catalog(): WorkflowMaterialSourceCatalogSnapshot {
  return {
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint: `sha256:${'c'.repeat(64)}`,
    template: {
      uuid: templateUuid,
      resourceTemplateUuid: '31000000-0000-4000-8000-000000000001',
      name: 'material_source',
      displayName: 'Material Source',
      actionClass: 'unilabos.workflow.authoring:material_source',
      actionType: 'material_source',
      schema: null,
      wireValue: materialSourceTemplateWire(),
      sourceHandle: {
        uuid: handleUuid,
        workflowNodeTemplateUuid: templateUuid,
        handleKey: 'material',
        ioType: 'source',
        displayName: 'Material',
        valueType: 'ResourceSlot',
        required: false,
        dataSource: 'executor',
        dataKey: 'material',
        wireValue: materialSourceHandleWire()
      }
    },
    resourceTemplates: [{
      uuid: resourceTemplateUuid,
      displayName: 'Plate96'
    }],
    materials: [
      {
        uuid: mountUuid,
        name: 'Stacker A',
        resourceTemplateUuid: '61000000-0000-4000-8000-000000000099',
        materialClass: 'Stacker'
      },
      {
        uuid: fixedMaterialUuid,
        name: 'Assay plate',
        resourceTemplateUuid,
        materialClass: 'Plate96'
      }
    ],
    sites: [
      {
        uuid: lateSiteUuid,
        name: 'Slot 2',
        sortOrder: 2,
        mountMaterialUuid: mountUuid,
        allowedResourceTemplateUuids: [resourceTemplateUuid],
        occupiedMaterialUuid: null
      },
      {
        uuid: earlySiteUuid,
        name: 'Slot 1',
        sortOrder: 1,
        mountMaterialUuid: mountUuid,
        allowedResourceTemplateUuids: [],
        occupiedMaterialUuid: fixedMaterialUuid
      }
    ]
  }
}

/**
 * 验证物料来源（MaterialSource）编辑投影保留公共物料图（MaterialGraph）的库位业务顺序，同时仅对持久化候选 UUID 规范排序。
 *
 * @returns 不返回值；展示顺序被 UUID 重排或候选 UUID 保存不稳定时断言失败。
 */
function preservesCatalogSiteOrder(): void {
  const graph = createMaterialSourceNode(catalog(), emptyGraph(), {
    nodeUuid,
    name: 'assay_plate'
  })
  const updated = updateMaterialSourceSelector(catalog(), graph, nodeUuid, {
    mode: 'existing',
    resourceTemplateUuid,
    mountUuid,
    fixedMaterialUuid,
    siteScope: 'candidates',
    candidateSiteUuids: [earlySiteUuid, lateSiteUuid],
    flowRole: 'reagent'
  })
  const projection = projectMaterialSourceEditor(
    catalog(),
    updated,
    nodeUuid
  )

  expect(workflowSiteUuids(projection.sites)).toEqual([
    earlySiteUuid,
    lateSiteUuid
  ])
  expect(updated.nodes[0].param).toEqual({
    resource_template_uuid: resourceTemplateUuid,
    mode: 'existing',
    mount: { uuid: mountUuid },
    material_uuid: fixedMaterialUuid,
    site: null,
    slot_range: [lateSiteUuid, earlySiteUuid].sort(),
    flow_role: 'reagent'
  })
}

/**
 * 提取工作流物料来源库位（Site）的稳定 UUID，并保持输入顺序。
 *
 * @param sites 物料来源（MaterialSource）编辑投影中的库位集合。
 * @returns 按目录既有 sort_order、UUID 顺序排列的库位 UUID。
 * @throws 不主动抛出异常。
 */
function workflowSiteUuids(
  sites: WorkflowMaterialSourceCatalogSnapshot['sites']
): string[] {
  // 库位（Site）UUID 集合保存物料来源（MaterialSource）目录给出的稳定库位（Site）身份。
  const uuids: string[] = []
  for (const site of sites) uuids.push(site.uuid)
  return uuids
}

function materialSourceTemplateWire(): Record<string, unknown> {
  return {
    uuid: templateUuid,
    resource_template_uuid: '31000000-0000-4000-8000-000000000001',
    name: 'material_source',
    display_name: 'Material Source',
    description: 'OS-owned framework selector',
    class: 'unilabos.workflow.authoring:material_source',
    goal: {},
    goal_default: {},
    feedback: {},
    result: {},
    schema: null,
    type: 'material_source',
    node_type: 'material_source',
    meta_data: { unilab: { framework: true } }
  }
}

function materialSourceHandleWire(): Record<string, unknown> {
  return {
    uuid: handleUuid,
    workflow_node_template_uuid: templateUuid,
    handle_key: 'material',
    io_type: 'source',
    display_name: 'Material',
    type: 'ResourceSlot',
    required: false,
    data_source: 'executor',
    data_key: 'material',
    meta_data: { unilab: { framework: true } }
  }
}

function actionCatalog(): WorkflowActionCatalogSnapshot {
  return {
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    actionTemplates: [{
      uuid: actionTemplateUuid,
      resourceTemplateUuid: '83000000-0000-4000-8000-000000000001',
      name: 'consume',
      displayName: 'Consume material',
      actionClass: 'lab.devices:Consumer',
      actionType: 'UniLabJsonCommand',
      schema: {
        type: 'object',
        'x-unilabos-action-contract': {
          version: 1,
          input_order: ['sample'],
          output_order: [],
          resource_template_symbols: { goal: {}, result: {} }
        }
      },
      goal: {},
      goalDefault: {},
      handles: [{
        uuid: actionTargetHandleUuid,
        workflowNodeTemplateUuid: actionTemplateUuid,
        handleKey: 'sample',
        ioType: 'target',
        displayName: 'Sample',
        valueType: 'ResourceSlot',
        required: true,
        dataSource: 'goal',
        dataKey: 'sample',
        valueSchema: { $slot: 'ResourceSlot' },
        editorControl: 'material_port',
        allowedResourceTemplateUuids: [resourceTemplateUuid],
        implicitPassthrough: false,
        structuralRole: null
      }]
    }],
    workflowTemplates: []
  }
}

function emptyGraph(): WorkflowAuthoringGraph {
  return {
    workflow: { uuid: workflowUuid, meta_data: {} },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}
