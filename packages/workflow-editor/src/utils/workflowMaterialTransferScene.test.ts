import type {
  WorkflowAuthoringGraph,
  WorkflowNodeJob
} from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  aggregateTransferStatus,
  projectWorkflowMaterialTransferProjection,
  projectWorkflowMaterialTransferRoutes
} from './workflowMaterialTransferScene'
import { materialTraceAccent } from './workflowMaterialTrace'

describe('工作流（Workflow）3D 物料转运投影', () => {
  it('只从已发布标准转运复合节点读取库位（Site）关系', () => {
    const graph = transferGraph()

    expect(projectWorkflowMaterialTransferRoutes(graph)).toEqual([{
      id: 'workflow-transfer-transfer-1',
      workflowNodeUuid: 'transfer-1',
      label: '烧杯搬到 S07',
      source: {
        ownerMaterialId: 's3_unused_beaker',
        siteKey: 'L1B1'
      },
      target: {
        ownerMaterialId: 's07_process_warehouse',
        siteKey: 'S0721'
      },
      executorId: 'szlab_mixer_robot',
      status: 'planned',
      materialRole: 'unclassified',
      materialLineageKey: 'unclassified:transfer-1',
      accent: materialTraceAccent('unclassified:transfer-1')
    }])
  })

  it('uses the incoming material lineage role and accent on a transfer route', () => {
    const graph = transferGraph()
    graph.nodes.unshift({
      uuid: 'sample-source',
      name: '主样品',
      type: 'material_source',
      workflow_node_template_uuid: 'source-template',
      param: { flow_role: 'primary_sample' }
    })
    graph.node_templates.push({
      uuid: 'source-template',
      name: 'material_source',
      type: 'material_source'
    })
    graph.handle_templates.push(
      resourceSlotHandle('source-handle', 'source-template', 'source'),
      resourceSlotHandle('target-handle', 'transfer-template', 'target')
    )
    graph.edges.push({
      uuid: 'material-edge',
      source_node_uuid: 'sample-source',
      source_handle_uuid: 'source-handle',
      target_node_uuid: 'transfer-1',
      target_handle_uuid: 'target-handle'
    })

    expect(projectWorkflowMaterialTransferRoutes(graph)[0]).toMatchObject({
      materialRole: 'primary_sample',
      materialLineageKey: 'sample-source',
      accent: materialTraceAccent('sample-source')
    })
  })

  it('忽略名称相似但没有已发布来源身份的节点', () => {
    const graph = transferGraph()
    graph.nodes.push({
      uuid: 'fake-transfer',
      name: 'material_transfer',
      workflow_node_template_uuid: 'plain-template',
      param: graph.nodes[0]?.param
    })
    graph.node_templates.push({
      uuid: 'plain-template',
      name: 'material_transfer'
    })

    expect(projectWorkflowMaterialTransferRoutes(graph)).toHaveLength(1)
  })

  it('从 Backend 发布节点读取标准转运来源身份', () => {
    const graph = transferGraph()
    const node = graph.nodes[0]
    const template = graph.node_templates[0]
    if (!node || !template) throw new Error('测试夹具缺少标准物料转运节点')
    node.meta_data = {
      unilab: {
        workflow_source: {
          symbol: 's_z_lab_标准物料转运',
          definition_fqid:
            'szlab_poly_studio.workflows.material_transfer.s_z_lab_标准物料转运'
        }
      }
    }
    template.meta_data = {
      unilab: {
        workflow_contract: {
          workflow_uuid: 'published-transfer-workflow',
          workflow_revision: 9
        }
      }
    }

    expect(projectWorkflowMaterialTransferRoutes(graph)).toHaveLength(1)
  })

  it('按复合节点的子作业聚合权威运行状态', () => {
    const graph = transferGraph()
    graph.nodes.push({
      uuid: 'pick-action',
      parent_uuid: 'transfer-1',
      workflow_node_template_uuid: 'plain-template'
    })
    const jobs = [
      workflowJob('pick-action', 'succeeded'),
      workflowJob('place-action', 'running')
    ]
    graph.nodes.push({
      uuid: 'place-action',
      parent_uuid: 'transfer-1',
      workflow_node_template_uuid: 'plain-template'
    })

    expect(projectWorkflowMaterialTransferRoutes(graph, jobs)[0]?.status)
      .toBe('running')
  })

  it('异常优先于运行和成功状态', () => {
    expect(aggregateTransferStatus([
      { status: 'succeeded' },
      { status: 'running' },
      { status: 'execution_unknown' }
    ])).toBe('attention')
    expect(aggregateTransferStatus([
      { status: 'succeeded' },
      { status: 'failed' }
    ])).toBe('failed')
  })

  /**
   * 验证跳过的工作流节点作业（WorkflowNodeJob）不伪装成已经完成的物料转运。
   * 输入是权威 `skipped` 作业状态；返回值必须保持非终态等待投影。
   */
  it('不把全部 skipped 作业聚合为成功转运', () => {
    expect(aggregateTransferStatus([
      { status: 'skipped' },
      { status: 'skipped' }
    ])).toBe('pending')
  })

  /**
   * 验证取消请求仍与已确认取消分离。
   * 输入是 `cancel_requested`；返回值应为取消中，不能播放运行中动画。
   */
  it('把 cancel_requested 投影为取消中而不是运行中', () => {
    expect(aggregateTransferStatus([
      { status: 'running' },
      { status: 'cancel_requested' }
    ])).toBe('canceling')
  })

  /**
   * 验证工作流任务（WorkflowTask）的冻结快照拥有运行态路线语义。
   * 当前已应用图已改目标库位时，历史作业只能装饰任务快照中的旧目标。
   */
  it('uses the WorkflowTask snapshot instead of decorating the current graph', () => {
    const appliedGraph = transferGraph()
    const taskGraph = transferGraph()
    const taskNode = taskGraph.nodes[0]
    if (!taskNode || typeof taskNode.param !== 'object' || taskNode.param === null) {
      throw new Error('测试夹具缺少标准物料转运参数')
    }
    taskNode.param = {
      ...taskNode.param,
      target_site: 'S0720'
    }

    const routes = projectWorkflowMaterialTransferProjection(
      appliedGraph,
      {
        workflow_uuid: 'workflow-1',
        workflow_snapshot: taskGraph as unknown as Record<string, unknown>
      },
      [workflowJob('transfer-1', 'succeeded')]
    )

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      target: { siteKey: 'S0720' },
      status: 'succeeded'
    })
  })

  /**
   * 验证无法证明属于当前工作流（Workflow）的任务快照不携带历史作业状态。
   * 输入为不同工作流 UUID；返回当前已应用路线且保持规划态。
   */
  it('fails closed when a WorkflowTask snapshot belongs to another Workflow', () => {
    const routes = projectWorkflowMaterialTransferProjection(
      transferGraph(),
      {
        workflow_uuid: 'workflow-other',
        workflow_snapshot: transferGraph() as unknown as Record<string, unknown>
      },
      [workflowJob('transfer-1', 'succeeded')]
    )

    expect(routes[0]).toMatchObject({
      target: { siteKey: 'S0721' },
      status: 'planned'
    })
  })

  it('follows the newly selected applied revision instead of an older task snapshot', () => {
    const appliedGraph = transferGraph()
    appliedGraph.workflow.revision = 5
    const previousTaskGraph = transferGraph()
    previousTaskGraph.workflow.revision = 4
    const previousNode = previousTaskGraph.nodes[0]
    if (
      !previousNode ||
      typeof previousNode.param !== 'object' ||
      previousNode.param === null
    ) throw new Error('测试夹具缺少历史物料转运参数')
    previousNode.param = {
      ...previousNode.param,
      target_site: 'S0720'
    }

    const routes = projectWorkflowMaterialTransferProjection(
      appliedGraph,
      {
        workflow_uuid: 'workflow-1',
        workflow_snapshot: previousTaskGraph as unknown as Record<string, unknown>
      },
      [workflowJob('transfer-1', 'succeeded')]
    )

    expect(routes[0]).toMatchObject({
      target: { siteKey: 'S0721' },
      status: 'planned'
    })
  })

  it('keeps a warehouse-level planned route when concrete Sites are unassigned', () => {
    const graph = transferGraph()
    const node = graph.nodes[0]
    if (!node || typeof node.param !== 'object' || node.param === null) {
      throw new Error('测试夹具缺少标准物料转运参数')
    }
    node.param = {
      ...node.param,
      source_site: null,
      target_site: null
    }

    expect(projectWorkflowMaterialTransferRoutes(graph)[0]).toMatchObject({
      source: {
        ownerMaterialId: 's3_unused_beaker',
        siteKey: null
      },
      target: {
        ownerMaterialId: 's07_process_warehouse',
        siteKey: null
      },
      status: 'planned'
    })
  })
})

function transferGraph(): WorkflowAuthoringGraph {
  return {
    workflow: { uuid: 'workflow-1', revision: 4 },
    nodes: [{
      uuid: 'transfer-1',
      name: '烧杯搬到 S07',
      workflow_node_template_uuid: 'transfer-template',
      param: {
        source_warehouse: { uuid: 's3_unused_beaker' },
        source_site: 'L1B1',
        target_warehouse: { uuid: 's07_process_warehouse' },
        target_site: 'S0721',
        target_device: 'szlab_mixer_robot'
      }
    }],
    edges: [],
    node_templates: [{
      uuid: 'transfer-template',
      meta_data: {
        unilab: {
          workflow_source: {
            symbol: 's_z_lab_标准物料转运',
            definition_fqid:
              'szlab_poly_studio.workflows.material_transfer.s_z_lab_标准物料转运'
          }
        }
      }
    }],
    handle_templates: []
  }
}
function workflowJob(
  workflowNodeUuid: string,
  status: WorkflowNodeJob['status']
): WorkflowNodeJob {
  return {
    uuid: `job-${workflowNodeUuid}`,
    create_time: '',
    update_time: '',
    meta_data: {},
    workflow_task_uuid: 'task-1',
    workflow_node_uuid: workflowNodeUuid,
    feedback_sequence: 0,
    topological_index: 0,
    executor_kind: 'device_action',
    execution_policy: {},
    execution_timeout_seconds: 30,
    status,
    attempt: 1,
    param: {},
    feedback_data: {},
    return_info: {},
    control_data: {},
    error_info: []
  }
}

function resourceSlotHandle(
  uuid: string,
  workflowNodeTemplateUuid: string,
  ioType: 'source' | 'target'
): Record<string, unknown> {
  return {
    uuid,
    workflow_node_template_uuid: workflowNodeTemplateUuid,
    handle_key: 'resource',
    display_name: '物料',
    io_type: ioType,
    type: 'ResourceSlot',
    data_key: 'resource',
    meta_data: {
      unilab: {
        value_schema: { $slot: 'ResourceSlot' },
        editor_control: 'material_port'
      }
    }
  }
}
