import { describe, expect, it } from 'vitest'

import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph
} from '@unilab/services'

import { createTypedActionNode } from './workflowActionCatalog'
import {
  deleteWorkflowGraphElements,
  workflowGraphDeletionDecision
} from './workflowGraphDeletion'
import { projectPersistentAuthoringGraph } from './persistentAuthoringGraph'

describe('normalized workflow graph deletion', () => {
  /** 验证删除物料来源会同步清理物料流、目标连接点提供者及目录投影。 */
  it('deletes a MaterialSource and atomically cleans its downstream binding', () => {
    const result = deleteWorkflowGraphElements(graphFixture(), {
      nodeUuids: ['material-source']
    })

    expect(result.removedNodeUuids).toEqual(['material-source'])
    expect(result.removedEdgeUuids).toEqual(['material-edge'])
    expect(result.graph.nodes.map((node) => node.uuid)).toEqual([
      'action',
      'sink'
    ])
    expect(result.graph.edges.map((edge) => edge.uuid)).toEqual([
      'control-edge'
    ])
    expect(result.graph.node_templates.map((item) => item.uuid))
      .not.toContain('material-template')
    expect(result.graph.handle_templates.map((item) => item.uuid))
      .not.toContain('material-output')
    expect(result.graph.nodes[0]?.param).toEqual({ volume: 5 })
    expect(nodeInputBindings(result.graph, 'action')).toEqual({})
  })

  /** 验证单独删除连线只解除该目标连接点，不误删两端节点。 */
  it('deletes an edge and clears the target provider without deleting nodes', () => {
    const graph = graphFixture()
    expect(projectPersistentAuthoringGraph(graph).links.map((link) => link.id))
      .toEqual(['material-edge', 'control-edge'])
    const result = deleteWorkflowGraphElements(graph, {
      edgeUuids: ['material-edge']
    })

    expect(result.removedNodeUuids).toEqual([])
    expect(result.removedEdgeUuids).toEqual(['material-edge'])
    expect(result.graph.nodes).toHaveLength(3)
    expect(result.graph.edges.map((edge) => edge.uuid)).toEqual([
      'control-edge'
    ])
    expect(result.graph.nodes.find((node) => node.uuid === 'action')?.param)
      .toEqual({ volume: 5 })
    expect(nodeInputBindings(result.graph, 'action')).toEqual({})
  })

  /** 验证删除节点会级联关联边、失效工作流出参及未再引用的模板。 */
  it('deletes an action and every normalized topology reference to it', () => {
    const result = deleteWorkflowGraphElements(graphFixture(), {
      nodeUuids: ['action']
    })

    expect(result.removedEdgeUuids).toEqual([
      'control-edge',
      'material-edge'
    ])
    expect(result.graph.nodes.map((node) => node.uuid)).toEqual([
      'material-source',
      'sink'
    ])
    expect(workflowOutputs(result.graph)).toEqual([])
    expect(workflowOutputBindings(result.graph)).toEqual({})
    expect(result.graph.nodes.find((node) => node.uuid === 'sink')?.param)
      .toEqual({})
    expect(nodeInputBindings(result.graph, 'sink')).toEqual({})
    expect(result.graph.node_templates.map((item) => item.uuid))
      .not.toContain('action-template')
  })

  /** 验证复合工作流内部节点与系统展示分组保持只读，并返回可展示原因。 */
  it('denies private and system-generated node deletion with a reason', () => {
    const graph = graphFixture()
    graph.nodes.push(
      {
        uuid: 'private-child',
        workflow_node_template_uuid: 'action-template',
        parent_uuid: 'action',
        name: 'private_child',
        type: 'action',
        param: {}
      },
      {
        uuid: 'presentation-group',
        workflow_node_template_uuid: 'group-template',
        name: 'group',
        type: 'group',
        param: {},
        meta_data: { unilab: { presentation_group: true } }
      }
    )

    expect(workflowGraphDeletionDecision(graph, {
      nodeUuids: ['private-child']
    })).toEqual({
      kind: 'denied',
      reason: '复合工作流内部私有节点只读；请删除或编辑调用边界'
    })
    expect(workflowGraphDeletionDecision(graph, {
      nodeUuids: ['presentation-group']
    })).toEqual({
      kind: 'denied',
      reason: '系统生成或结构节点只读，不能直接删除'
    })
  })

  /** 验证带连接节点的删除决策包含确认所需的影响数量。 */
  it('reports connected edge and output impact before deleting a node', () => {
    expect(workflowGraphDeletionDecision(graphFixture(), {
      nodeUuids: ['action']
    })).toMatchObject({
      kind: 'allowed',
      nodeUuids: ['action'],
      edgeUuids: ['control-edge', 'material-edge'],
      connectedEdgeCount: 2,
      removedOutputCount: 1
    })
  })

  /** 验证刚从真实模板形状新增的普通动作删除后不会被规范化候选重新投影。 */
  it('does not re-project a newly added typed action after deletion', () => {
    const emptyGraph: WorkflowAuthoringGraph = {
      workflow: { uuid: 'workflow-new-node' },
      nodes: [],
      edges: [],
      node_templates: [],
      handle_templates: []
    }
    const created = createTypedActionNode(newNodeCatalog(), emptyGraph, {
      nodeUuid: 'new-action',
      templateUuid: 'new-action-template',
      name: 'new_action'
    })
    expect(projectPersistentAuthoringGraph(created).nodes.map((node) => node.id))
      .toEqual(['new-action'])

    const deleted = deleteWorkflowGraphElements(created, {
      nodeUuids: ['new-action']
    }).graph

    expect(deleted.nodes).toEqual([])
    expect(deleted.node_templates).toEqual([])
    expect(projectPersistentAuthoringGraph(deleted).nodes).toEqual([])
  })
})

/**
 * 构造可由真实新增函数消费的最小类型化动作目录。
 *
 * @returns 含一个无参数动作模板的工作流动作目录快照。
 */
function newNodeCatalog(): WorkflowActionCatalogSnapshot {
  return {
    actionTemplates: [{
      uuid: 'new-action-template',
      resourceTemplateUuid: 'device-template',
      name: 'new_action',
      displayName: '新增动作',
      actionClass: null,
      actionType: 'device',
      schema: {
        'x-unilabos-action-contract': {
          version: 1,
          input_order: [],
          output_order: []
        }
      },
      goal: {},
      goalDefault: {},
      handles: [],
      wireValue: {
        uuid: 'new-action-template',
        name: 'new_action',
        node_type: 'device'
      }
    }],
    workflowTemplates: []
  }
}

/**
 * 构造同时含物料流、控制依赖、连接点绑定和工作流出参的最小规范化候选。
 *
 * @returns 每次调用均返回独立的工作流创作图，测试之间不会共享修改。
 */
function graphFixture(): WorkflowAuthoringGraph {
  return {
    workflow: {
      uuid: 'workflow-1',
      meta_data: {
        unilab: {
          input_contract: { version: 1, parameters: [] },
          output_contract: {
            version: 1,
            outputs: [{
              name: 'result',
              schema: { type: 'number' },
              implicit: false
            }]
          },
          output_bindings: {
            result: {
              kind: 'node_output',
              workflow_node_uuid: 'action',
              source_handle_uuid: 'action-output'
            }
          }
        }
      }
    },
    nodes: [
      {
        uuid: 'material-source',
        workflow_node_template_uuid: 'material-template',
        name: 'material_source',
        type: 'material_source',
        param: {},
        meta_data: {}
      },
      {
        uuid: 'action',
        workflow_node_template_uuid: 'action-template',
        name: 'dispense',
        type: 'action',
        param: { material: { uuid: 'stale' }, volume: 5 },
        meta_data: {
          unilab: {
            input_bindings: {
              'action-input': { parameter: 'sample' }
            }
          }
        }
      },
      {
        uuid: 'sink',
        workflow_node_template_uuid: 'sink-template',
        name: 'sink',
        type: 'action',
        param: { ready: true },
        meta_data: {
          unilab: {
            input_bindings: {
              'sink-input': { parameter: 'ready' }
            }
          }
        }
      }
    ],
    edges: [
      {
        uuid: 'material-edge',
        source_node_uuid: 'material-source',
        source_handle_uuid: 'material-output',
        target_node_uuid: 'action',
        target_handle_uuid: 'action-input',
        meta_data: {}
      },
      {
        uuid: 'control-edge',
        source_node_uuid: 'action',
        source_handle_uuid: 'action-output',
        target_node_uuid: 'sink',
        target_handle_uuid: 'sink-input',
        meta_data: {}
      }
    ],
    node_templates: [
      { uuid: 'material-template', type: 'material_source' },
      { uuid: 'action-template', type: 'action' },
      { uuid: 'sink-template', type: 'action' }
    ],
    handle_templates: [
      {
        uuid: 'material-output',
        workflow_node_template_uuid: 'material-template',
        io_type: 'source',
        data_key: 'material'
      },
      {
        uuid: 'action-input',
        workflow_node_template_uuid: 'action-template',
        io_type: 'target',
        data_key: 'material'
      },
      {
        uuid: 'action-output',
        workflow_node_template_uuid: 'action-template',
        io_type: 'source',
        data_key: 'ready'
      },
      {
        uuid: 'sink-input',
        workflow_node_template_uuid: 'sink-template',
        io_type: 'target',
        data_key: 'ready'
      }
    ]
  }
}

/**
 * 读取指定节点的工作流入参绑定投影。
 *
 * @param graph 规范化工作流候选。
 * @param nodeUuid 目标工作流节点稳定 UUID。
 * @returns 节点元数据内的连接点绑定对象；缺失时返回空对象。
 */
function nodeInputBindings(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): Record<string, unknown> {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  const metaData = record(node?.meta_data)
  const unilab = record(metaData.unilab)
  return record(unilab.input_bindings)
}

/** 读取工作流出参描述数组，供删除后的合同一致性断言使用。 */
function workflowOutputs(graph: WorkflowAuthoringGraph): unknown[] {
  const unilab = workflowUnilab(graph)
  return Array.isArray(record(unilab.output_contract).outputs)
    ? record(unilab.output_contract).outputs as unknown[]
    : []
}

/** 读取工作流出参绑定，供删除后的拓扑引用断言使用。 */
function workflowOutputBindings(
  graph: WorkflowAuthoringGraph
): Record<string, unknown> {
  return record(workflowUnilab(graph).output_bindings)
}

/** 读取工作流级 Uni-Lab 元数据。 */
function workflowUnilab(graph: WorkflowAuthoringGraph): Record<string, unknown> {
  return record(record(graph.workflow.meta_data).unilab)
}

/** 把未知值安全投影为只读测试对象。 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
