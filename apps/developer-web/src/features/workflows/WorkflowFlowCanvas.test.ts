import { describe, expect, it } from 'vitest'
import { projectWorkflowGraphModel } from './workflowFlowProjection'

describe('workflow flow projection', () => {
  it('lays nodes out by edge rank and preserves graph connections', () => {
    const projected = projectWorkflowGraphModel(
      {
        workflow: {},
        nodes: [
          { uuid: 'source', name: '来源', type: 'material_source' },
          { uuid: 'step', name: '处理', type: 'ILab' },
          { uuid: 'sink', name: '结束', type: 'ILab' },
        ],
        edges: [
          { uuid: 'edge-1', source_node_uuid: 'source', target_node_uuid: 'step' },
          { uuid: 'edge-2', source_node_uuid: 'step', target_node_uuid: 'sink' },
        ],
        nodeTemplates: [],
        handleTemplates: [],
        inventoryRequirements: [],
      },
      'step',
    )

    expect(projected.nodes.map((node) => node.position.x)).toEqual([0, 280, 560])
    expect(projected.nodes[1]?.selected).toBe(true)
    expect(projected.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['source', 'step'],
      ['step', 'sink'],
    ])
    expect(projected.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })

  it('collapses composite child nodes into their top-level workflow node', () => {
    const projected = projectWorkflowGraphModel(
      {
        workflow: {},
        nodes: [
          { uuid: 'root', name: '复合步骤', type: 'workflow' },
          { uuid: 'child', name: '内部动作', type: 'ILab', parent_uuid: 'root' },
          { uuid: 'next', name: '下一步', type: 'workflow' },
        ],
        edges: [{ uuid: 'edge', source_node_uuid: 'root', target_node_uuid: 'next' }],
        nodeTemplates: [],
        handleTemplates: [],
        inventoryRequirements: [],
      },
      null,
    )

    expect(projected.nodes.map((node) => node.id)).toEqual(['root', 'next'])
    expect(projected.nodes[0]?.childCount).toBe(1)
    expect(projected.edges).toHaveLength(1)
  })

  it('collapses child edges, removes duplicate/self edges and promotes child selection', () => {
    const projected = projectWorkflowGraphModel(
      {
        workflow: {},
        nodes: [
          { uuid: 'root-a', name: '复合 A', type: 'workflow' },
          { uuid: 'child-a', name: '内部 A', type: 'ILab', parent_uuid: 'root-a' },
          { uuid: 'root-b', name: '复合 B', type: 'workflow' },
          { uuid: 'orphan', name: '孤立节点', type: 'ILab' },
        ],
        edges: [
          { uuid: 'child-edge', source_node_uuid: 'child-a', target_node_uuid: 'root-b' },
          { uuid: 'duplicate-edge', source_node_uuid: 'root-a', target_node_uuid: 'root-b' },
          { uuid: 'self-edge', source_node_uuid: 'root-a', target_node_uuid: 'root-a' },
          { uuid: 'missing-edge', source_node_uuid: 'missing', target_node_uuid: 'root-b' },
        ],
        nodeTemplates: [],
        handleTemplates: [],
        inventoryRequirements: [],
      },
      'child-a',
    )

    expect(projected.nodes.find((node) => node.id === 'root-a')).toMatchObject({
      selected: true,
      childCount: 1,
    })
    expect(projected.edges).toEqual([
      expect.objectContaining({ source: 'root-a', target: 'root-b' }),
    ])
  })
})
