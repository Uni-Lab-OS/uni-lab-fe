import { describe, expect, it } from 'vitest'
import type { WorkflowLink, WorkflowNode } from './parseWorkflow'

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

  it('loads a 5000+ node canonical layer while materializing only its boundary', () => {
    const childCount = 5_000
    const root: WorkflowNode = {
      id: 'published-child',
      name: '已发布子工作流',
      type: 'workflow',
      className: 'workflow',
      labNodeType: 'workflow',
      groupKind: 'subworkflow',
      collapsedByDefault: true,
      childNodeIds: Array.from(
        { length: childCount },
        (_, index) => `internal-${index}`
      )
    }
    const children: WorkflowNode[] = Array.from(
      { length: childCount },
      (_, index) => ({
        id: `internal-${index}`,
        name: `内部节点 ${index}`,
        type: 'action',
        className: 'action',
        labNodeType: 'action',
        parentGroupId: root.id
      })
    )
    const finish: WorkflowNode = {
      id: 'finish',
      name: '完成',
      type: 'action',
      className: 'action',
      labNodeType: 'action'
    }
    const links: WorkflowLink[] = [{
      id: 'boundary-edge',
      source: children.at(-1)!.id,
      target: finish.id,
      type: 'control'
    }]
    const canonicalNodes = [root, ...children, finish]

    const projected = projectNestedWorkflow(canonicalNodes, links, new Set())

    expect(canonicalNodes).toHaveLength(5_002)
    expect(projected.nodes.map((node) => node.id)).toEqual([
      'published-child',
      'finish'
    ])
    expect(projected.hiddenNodeIds.size).toBe(childCount)
    expect(projected.links).toEqual([
      expect.objectContaining({ source: 'published-child', target: 'finish' })
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
