import { describe, expect, it } from 'vitest'

import {
  CONTROL_DAG_JSON,
  CONTROL_DAG_REVISION,
  createWorkflowExecutionScope,
  parseCanonicalWorkflow,
  projectNestedWorkflow,
  remapWorkflowBreakpoints,
  remapWorkflowNodeId,
  visibleNestedWorkflowNodeId
} from './canonicalWorkflow'

describe('Canonical workflow projection', () => {
  it('keeps control nodes and both branch-labelled edges losslessly', () => {
    const parsed = parseCanonicalWorkflow(CONTROL_DAG_JSON)

    expect(parsed.error).toBeNull()
    expect(parsed.nodes.map((node) => node.type)).toContain('branch')
    expect(parsed.nodes.map((node) => node.type)).toContain('join')
    expect(
      parsed.links
        .filter((edge) => edge.source === 'branch')
        .map((edge) => edge.branch)
    ).toEqual(['true', 'false'])
    expect(parsed.revision?.control_edges).toHaveLength(6)
  })

  it('rejects the legacy lossy visual graph as a run source', () => {
    const parsed = parseCanonicalWorkflow(JSON.stringify({
      nodes: [{ id: 'n1' }],
      edges: []
    }))

    expect(parsed.revision).toBeNull()
    expect(parsed.error).toContain('标准工作流格式（v2）')
  })

  it('remaps breakpoints when Python compilation regenerates node ids', () => {
    const compiled = {
      ...CONTROL_DAG_REVISION,
      invocations: CONTROL_DAG_REVISION.invocations.map((invocation, index) => ({
        ...invocation,
        node_id: `control-demo-${index + 1}`
      }))
    }

    const mapped = remapWorkflowBreakpoints(
      CONTROL_DAG_REVISION,
      compiled,
      new Set(['branch'])
    )

    expect([...mapped]).toEqual(['control-demo-2'])
  })

  it('remaps a marked execution start with the same invocation identity', () => {
    const compiled = {
      ...CONTROL_DAG_REVISION,
      invocations: CONTROL_DAG_REVISION.invocations.map((invocation, index) => ({
        ...invocation,
        node_id: `control-demo-${index + 1}`
      }))
    }

    expect(
      remapWorkflowNodeId(CONTROL_DAG_REVISION, compiled, 'dose')
    ).toBe('control-demo-3')
  })

  it('preserves independent parallel roots when starting at the first executable boundary', () => {
    const parsed = parseCanonicalWorkflow(CONTROL_DAG_JSON)
    const independent = { ...parsed.nodes[0]!, id: 'parallel-root', name: 'Parallel root' }
    const nodes = [...parsed.nodes, independent]
    const scope = createWorkflowExecutionScope(nodes, parsed.links, 'measure')
    expect(scope.executableNodeIds.has('parallel-root')).toBe(true)
    expect(scope.beforeStartNodeIds.size).toBe(0)
    const source = { ...independent, id: 'material-input', type: 'material_source' }
    const supplied = createWorkflowExecutionScope([...nodes, source], [...parsed.links,
      { ...parsed.links[0]!, source: 'material-input', target: 'measure' }], 'measure')
    expect(supplied.executableNodeIds.has('parallel-root')).toBe(true)
  })

  it('marks nodes outside the selected start subgraph as before-start', () => {
    const parsed = parseCanonicalWorkflow(CONTROL_DAG_JSON)
    const scope = createWorkflowExecutionScope(
      parsed.nodes,
      parsed.links,
      'dose'
    )

    expect([...scope.executableNodeIds]).toEqual(['dose', 'join', 'heat'])
    expect([...scope.beforeStartNodeIds]).toEqual([
      'measure',
      'branch',
      'inspect'
    ])
  })

  it('derives nested subworkflow parents from Canonical group source ranges', () => {
    const parsed = parseCanonicalWorkflow(JSON.stringify(NESTED_REVISION))
    const byId = new Map(parsed.nodes.map((node) => [node.id, node]))

    expect(byId.get('outer')?.name).toBe('sampling_cycle')
    expect(byId.get('outer')?.groupKind).toBe('subworkflow')
    expect(byId.get('outer')?.collapsedByDefault).toBe(true)
    expect(byId.get('outer')?.childNodeIds).toEqual(['prepare', 'inner'])
    expect(byId.get('inner')?.parentGroupId).toBe('outer')
    expect(byId.get('dose')?.parentGroupId).toBe('inner')
  })

  it('collapses nested groups and rewires only boundary-crossing edges', () => {
    const parsed = parseCanonicalWorkflow(JSON.stringify(NESTED_REVISION))

    const collapsed = projectNestedWorkflow(
      parsed.nodes,
      parsed.links,
      new Set()
    )
    expect(collapsed.nodes.map((node) => node.id)).toEqual(['outer', 'finish'])
    expect(collapsed.links).toMatchObject([
      { source: 'outer', target: 'finish' }
    ])
    expect([...collapsed.hiddenNodeIds]).toEqual(['prepare', 'inner', 'dose'])
    expect(visibleNestedWorkflowNodeId(
      parsed.nodes,
      collapsed.collapsedGroupIds,
      'dose'
    )).toBe('outer')

    const outerExpanded = projectNestedWorkflow(
      parsed.nodes,
      parsed.links,
      new Set(['outer'])
    )
    expect(outerExpanded.nodes.map((node) => node.id)).toEqual([
      'outer',
      'prepare',
      'inner',
      'finish'
    ])
    expect(outerExpanded.links.map(({ source, target }) => [source, target]))
      .toEqual([
        ['outer', 'prepare'],
        ['prepare', 'inner'],
        ['inner', 'finish']
      ])
    expect(visibleNestedWorkflowNodeId(
      parsed.nodes,
      outerExpanded.collapsedGroupIds,
      'dose'
    )).toBe('inner')

    const allExpanded = projectNestedWorkflow(
      parsed.nodes,
      parsed.links,
      new Set(['outer', 'inner'])
    )
    expect(allExpanded.nodes).toHaveLength(5)
    expect(allExpanded.links).toHaveLength(4)
    expect(visibleNestedWorkflowNodeId(
      parsed.nodes,
      allExpanded.collapsedGroupIds,
      'dose'
    )).toBe('dose')
  })

  /** 折叠组合节点时，不得把同一对可见节点之间的不同物料 Handle 边合并。 */
  it('preserves parallel Handle edges across a collapsed Composite boundary', () => {
    const nodes = [
      {
        id: 'composite',
        name: '组合步骤',
        type: 'group',
        className: 'Group',
        labNodeType: 'Group',
        groupKind: 'subworkflow' as const,
        collapsedByDefault: true
      },
      {
        id: 'child',
        name: '组合内部动作',
        type: 'action',
        className: 'Action',
        labNodeType: 'Action',
        parentGroupId: 'composite'
      },
      {
        id: 'sink',
        name: '下游动作',
        type: 'action',
        className: 'Action',
        labNodeType: 'Action'
      }
    ]
    const links = [
      {
        id: 'sample-edge',
        source: 'child',
        sourceHandleUuid: 'sample-output',
        target: 'sink',
        targetHandleUuid: 'sample-input',
        type: 'control'
      },
      {
        id: 'ether-edge',
        source: 'child',
        sourceHandleUuid: 'ether-output',
        target: 'sink',
        targetHandleUuid: 'ether-input',
        type: 'control'
      }
    ]

    const projected = projectNestedWorkflow(nodes, links, new Set())

    expect(projected.links.map((link) => [
      link.id,
      link.source,
      link.sourceHandleUuid,
      link.target,
      link.targetHandleUuid
    ])).toEqual([
      [
        'sample-edge',
        'composite',
        'sample-output',
        'sink',
        'sample-input'
      ],
      [
        'ether-edge',
        'composite',
        'ether-output',
        'sink',
        'ether-input'
      ]
    ])
  })

  /**
   * 验证原生编写分组只保留成员节点，不作为工作流（Workflow）画布节点重复展示。
   */
  it('hides native authoring groups without hiding their members', () => {
    const parsed = parseCanonicalWorkflow(JSON.stringify(NATIVE_GROUP_REVISION))

    const projected = projectNestedWorkflow(
      parsed.nodes,
      parsed.links,
      new Set()
    )

    expect(projected.nodes.map((node) => node.id)).toEqual([
      'prepare',
      'finish'
    ])
    expect(projected.links.map(({ source, target }) => [source, target]))
      .toEqual([['prepare', 'finish']])
  })
})

const NATIVE_GROUP_REVISION = {
  schema_version: '2',
  revision_id: 'native-group-rev-1',
  workflow_id: 'native-group-demo',
  invocations: [
    {
      node_id: 'phase-group',
      action_ref: 'os_control.group',
      node_type: 'group',
      control: { name: '准备阶段' }
    },
    { node_id: 'prepare', action_ref: 'sampling.prepare' },
    { node_id: 'finish', action_ref: 'sampling.finish' }
  ],
  control_edges: [
    { edge_id: 'e1', source: 'prepare', target: 'finish' }
  ],
  source_map: {
    entries: [
      {
        node_id: 'phase-group',
        compiled_node_ids: ['phase-group', 'prepare']
      }
    ]
  }
}

const NESTED_REVISION = {
  schema_version: '2',
  revision_id: 'nested-rev-1',
  workflow_id: 'nested-demo',
  invocations: [
    {
      node_id: 'outer',
      action_ref: 'os_control.group',
      node_type: 'group',
      control: { name: 'subworkflow::sampling_cycle' }
    },
    { node_id: 'prepare', action_ref: 'sampling.prepare' },
    {
      node_id: 'inner',
      action_ref: 'os_control.group',
      node_type: 'group',
      control: { name: 'subworkflow::sampling_execute' }
    },
    { node_id: 'dose', action_ref: 'sampling.dose' },
    { node_id: 'finish', action_ref: 'sampling.finish' }
  ],
  control_edges: [
    { edge_id: 'e1', source: 'outer', target: 'prepare' },
    { edge_id: 'e2', source: 'prepare', target: 'inner' },
    { edge_id: 'e3', source: 'inner', target: 'dose' },
    { edge_id: 'e4', source: 'dose', target: 'finish' }
  ],
  source_map: {
    entries: [
      {
        node_id: 'outer',
        compiled_node_ids: ['outer', 'prepare', 'inner', 'dose']
      },
      {
        node_id: 'inner',
        compiled_node_ids: ['inner', 'dose']
      }
    ]
  }
}
