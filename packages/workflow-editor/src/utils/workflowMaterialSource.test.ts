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
          flow_role: 'primary_sample',
          custody_policy: 'task_exclusive'
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
  it(
    '旧选择器按任务全程独占迁移并在下次更新写回新字段',
    migratesLegacySelectorToTaskExclusive
  )
  it(
    '共享来源不能流入物料移动动作',
    rejectsSharedSourceMovement
  )
  it(
    '共享来源只跟踪多物料动作中对应的透传句柄',
    followsOnlyMatchingMaterialPassThrough
  )
  it(
    '共享来源不能穿过复合工作流边界进入移动子图',
    rejectsCompositeWorkflowMovement
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
      flowRole: 'consumable',
      custodyPolicy: 'shared_source'
    })

    expect(updated.nodes[0].param).toMatchObject({
      mode: 'create_new',
      material_uuid: null,
      site: earlySiteUuid,
      slot_range: null,
      flow_role: 'consumable',
      custody_policy: 'shared_source'
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
    flowRole: 'reagent',
    custodyPolicy: 'shared_source'
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
    flow_role: 'reagent',
    custody_policy: 'shared_source'
  })
  expect(projection.custodyPolicy).toBe('shared_source')
}

/**
 * 验证升级前七字段选择器保留原独占语义，并在编辑后写回八字段合同。
 *
 * @returns 无返回值；迁移默认值或规范写回漂移时由 Vitest 报告失败。
 * @throws 无；只操作内存候选图。
 */
function migratesLegacySelectorToTaskExclusive(): void {
  const created = createMaterialSourceNode(catalog(), emptyGraph(), {
    nodeUuid,
    name: 'legacy_reagent'
  })
  const source = created.nodes[0]!
  const legacyParam = { ...(source.param as Record<string, unknown>) }
  delete legacyParam.custody_policy
  const legacyGraph: WorkflowAuthoringGraph = {
    ...created,
    nodes: [{ ...source, param: legacyParam }]
  }

  const projection = projectMaterialSourceEditor(catalog(), legacyGraph, nodeUuid)
  expect(projection.custodyPolicy).toBe('task_exclusive')
  const updated = updateMaterialSourceSelector(
    catalog(),
    legacyGraph,
    nodeUuid,
    {
      mode: projection.mode,
      resourceTemplateUuid: projection.resourceTemplateUuid,
      mountUuid: projection.mountUuid,
      fixedMaterialUuid: projection.fixedMaterialUuid,
      siteScope: projection.siteScope,
      fixedSiteUuid: projection.fixedSiteUuid,
      candidateSiteUuids: projection.candidateSiteUuids,
      flowRole: projection.flowRole,
      custodyPolicy: projection.custodyPolicy
    }
  )
  expect(updated.nodes[0]?.param).toMatchObject({
    custody_policy: 'task_exclusive'
  })
}

/**
 * 验证共享来源沿 ResourceSlot 连到物料移动动作时前端失败关闭。
 *
 * @returns 无返回值；属性投影给出可行动原因，更新共享策略时抛错。
 * @throws 预期 ``updateMaterialSourceSelector`` 抛出领域错误。
 */
function rejectsSharedSourceMovement(): void {
  const created = createMaterialSourceNode(catalog(), emptyGraph(), {
    nodeUuid,
    name: 'stationary_reagent'
  })
  const movementNodeUuid = '87000000-0000-4000-8000-000000000001'
  const movementTemplateUuid = '88000000-0000-4000-8000-000000000001'
  const movementTargetHandleUuid = '89000000-0000-4000-8000-000000000001'
  const graph: WorkflowAuthoringGraph = {
    ...created,
    nodes: [
      ...created.nodes,
      {
        uuid: movementNodeUuid,
        workflow_node_template_uuid: movementTemplateUuid,
        name: 'move_reagent',
        type: 'ILab',
        action_name: 'transfer_resource',
        param: {}
      }
    ],
    edges: [{
      uuid: '8a000000-0000-4000-8000-000000000001',
      source_node_uuid: nodeUuid,
      source_handle_uuid: handleUuid,
      target_node_uuid: movementNodeUuid,
      target_handle_uuid: movementTargetHandleUuid
    }],
    handle_templates: [
      ...created.handle_templates,
      {
        uuid: movementTargetHandleUuid,
        workflow_node_template_uuid: movementTemplateUuid,
        handle_key: 'resource',
        io_type: 'target',
        display_name: '物料',
        type: 'ResourceSlot'
      }
    ]
  }
  const projection = projectMaterialSourceEditor(catalog(), graph, nodeUuid)
  expect(projection.sharedSourceBlockedReason).toContain('transfer_resource')
  expect(() => updateMaterialSourceSelector(catalog(), graph, nodeUuid, {
    mode: projection.mode,
    resourceTemplateUuid: projection.resourceTemplateUuid,
    mountUuid: projection.mountUuid,
    fixedMaterialUuid: projection.fixedMaterialUuid,
    siteScope: projection.siteScope,
    fixedSiteUuid: projection.fixedSiteUuid,
    candidateSiteUuids: projection.candidateSiteUuids,
    flowRole: projection.flowRole,
    custodyPolicy: 'shared_source'
  })).toThrow(/共享来源.*transfer_resource/)
}

/**
 * 验证溶剂瓶不会因同一加液动作的烧杯输出后续移动而被误判，同时保留真实移动链的拦截。
 *
 * @returns 无返回值；物料句柄血缘串线时断言失败。
 * @throws 真实移动链预期由选择器更新抛出领域错误。
 */
function followsOnlyMatchingMaterialPassThrough(): void {
  const created = createMaterialSourceNode(catalog(), emptyGraph(), {
    nodeUuid,
    name: 'solvent_pump_1'
  })
  const processNodeUuid = '8b000000-0000-4000-8000-000000000001'
  const processTemplateUuid = '8c000000-0000-4000-8000-000000000001'
  const solventInputUuid = '8d000000-0000-4000-8000-000000000001'
  const solventOutputUuid = '8e000000-0000-4000-8000-000000000001'
  const beakerInputUuid = '8f000000-0000-4000-8000-000000000001'
  const beakerOutputUuid = '90000000-0000-4000-8000-000000000001'
  const movementNodeUuid = '91000000-0000-4000-8000-000000000001'
  const movementTemplateUuid = '92000000-0000-4000-8000-000000000001'
  const movementTargetUuid = '93000000-0000-4000-8000-000000000001'
  const graph: WorkflowAuthoringGraph = {
    ...created,
    nodes: [
      ...created.nodes,
      {
        uuid: processNodeUuid,
        workflow_node_template_uuid: processTemplateUuid,
        name: 'add_solvent_with_materials',
        type: 'ILab',
        action_name: 'add_solvent_with_materials',
        param: {},
        meta_data: {
          unilab: {
            material_passthrough_handles: {
              [solventOutputUuid]: solventInputUuid,
              [beakerOutputUuid]: beakerInputUuid
            }
          }
        }
      },
      {
        uuid: movementNodeUuid,
        workflow_node_template_uuid: movementTemplateUuid,
        name: 'place_beaker',
        type: 'ILab',
        action_name: 'place',
        param: {}
      }
    ],
    edges: [
      {
        uuid: '94000000-0000-4000-8000-000000000001',
        source_node_uuid: nodeUuid,
        source_handle_uuid: handleUuid,
        target_node_uuid: processNodeUuid,
        target_handle_uuid: solventInputUuid
      },
      {
        uuid: '95000000-0000-4000-8000-000000000001',
        source_node_uuid: processNodeUuid,
        source_handle_uuid: beakerOutputUuid,
        target_node_uuid: movementNodeUuid,
        target_handle_uuid: movementTargetUuid
      }
    ],
    handle_templates: [
      ...created.handle_templates,
      materialHandle(processTemplateUuid, solventInputUuid, 'solvent_pump_1', 'target'),
      materialHandle(processTemplateUuid, solventOutputUuid, 'solvent_pump_1', 'source'),
      materialHandle(processTemplateUuid, beakerInputUuid, 'beaker', 'target'),
      materialHandle(processTemplateUuid, beakerOutputUuid, 'beaker', 'source'),
      materialHandle(movementTemplateUuid, movementTargetUuid, 'resource', 'target')
    ]
  }

  const stationary = projectMaterialSourceEditor(catalog(), graph, nodeUuid)
  expect(stationary.sharedSourceBlockedReason).toBeNull()
  expect(updateMaterialSourceSelector(catalog(), graph, nodeUuid, {
    mode: stationary.mode,
    resourceTemplateUuid: stationary.resourceTemplateUuid,
    mountUuid: stationary.mountUuid,
    fixedMaterialUuid: stationary.fixedMaterialUuid,
    siteScope: stationary.siteScope,
    fixedSiteUuid: stationary.fixedSiteUuid,
    candidateSiteUuids: stationary.candidateSiteUuids,
    flowRole: stationary.flowRole,
    custodyPolicy: 'shared_source'
  }).nodes[0]?.param).toMatchObject({ custody_policy: 'shared_source' })

  const movedGraph: WorkflowAuthoringGraph = {
    ...graph,
    edges: graph.edges.map((edge) => String(edge.uuid).startsWith('95')
      ? { ...edge, source_handle_uuid: solventOutputUuid }
      : edge)
  }
  expect(projectMaterialSourceEditor(
    catalog(),
    movedGraph,
    nodeUuid
  ).sharedSourceBlockedReason).toContain('place')
}

/** 验证复合工作流的 target_mappings 会把物料来源安全检查延伸到冻结子图。 */
function rejectsCompositeWorkflowMovement(): void {
  const created = createMaterialSourceNode(catalog(), emptyGraph(), {
    nodeUuid,
    name: 'reagent_bottle'
  })
  const compositeNodeUuid = '96000000-0000-4000-8000-000000000001'
  const compositeTemplateUuid = '97000000-0000-4000-8000-000000000001'
  const compositeTargetUuid = '98000000-0000-4000-8000-000000000001'
  const childPickNodeUuid = '99000000-0000-4000-8000-000000000001'
  const childPickTemplateUuid = '9a000000-0000-4000-8000-000000000001'
  const childPickTargetUuid = '9b000000-0000-4000-8000-000000000001'
  const graph: WorkflowAuthoringGraph = {
    ...created,
    nodes: [
      ...created.nodes,
      {
        uuid: compositeNodeUuid,
        workflow_node_template_uuid: compositeTemplateUuid,
        name: 'material_transfer',
        type: 'workflow',
        param: {},
        meta_data: {
          unilab: {
            composite: {
              target_mappings: {
                [compositeTargetUuid]: [{
                  workflow_node_uuid: childPickNodeUuid,
                  target_handle_uuid: childPickTargetUuid
                }]
              }
            }
          }
        }
      },
      {
        uuid: childPickNodeUuid,
        workflow_node_template_uuid: childPickTemplateUuid,
        name: 'pick',
        type: 'ILab',
        action_name: 'pick',
        param: {},
        parent_uuid: compositeNodeUuid
      }
    ],
    edges: [{
      uuid: '9c000000-0000-4000-8000-000000000001',
      source_node_uuid: nodeUuid,
      source_handle_uuid: handleUuid,
      target_node_uuid: compositeNodeUuid,
      target_handle_uuid: compositeTargetUuid
    }],
    handle_templates: [
      ...created.handle_templates,
      materialHandle(compositeTemplateUuid, compositeTargetUuid, 'resource', 'target'),
      materialHandle(childPickTemplateUuid, childPickTargetUuid, 'resource', 'target')
    ]
  }

  expect(projectMaterialSourceEditor(
    catalog(),
    graph,
    nodeUuid
  ).sharedSourceBlockedReason).toContain('pick')
}

/** 构造血缘校验使用的 ResourceSlot 句柄模板。 */
function materialHandle(
  workflowNodeTemplateUuid: string,
  uuid: string,
  handleKey: string,
  ioType: 'source' | 'target'
): WorkflowAuthoringGraph['handle_templates'][number] {
  return {
    uuid,
    workflow_node_template_uuid: workflowNodeTemplateUuid,
    handle_key: handleKey,
    io_type: ioType,
    display_name: handleKey,
    type: 'ResourceSlot'
  }
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
