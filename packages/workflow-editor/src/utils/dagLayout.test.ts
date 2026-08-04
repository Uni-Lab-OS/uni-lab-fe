import { describe, expect, it } from 'vitest'
import type { WorkflowRevision } from '@unilab/services'

import {
  beautifyWorkflowRevision,
  layoutDag
} from './dagLayout'
import type { WorkflowLink, WorkflowNode } from './parseWorkflow'

const nodes: WorkflowNode[] = [
  workflowNode('start', 'action', 900, 600),
  workflowNode('branch', 'branch', 80, 500),
  workflowNode('left', 'action', 40, 20),
  workflowNode('right', 'action', 500, 20),
  workflowNode('join', 'join', 700, 100)
]

const links: WorkflowLink[] = [
  { source: 'start', target: 'branch', type: 'control' },
  { source: 'branch', target: 'left', type: 'control', branch: 'true' },
  { source: 'branch', target: 'right', type: 'control', branch: 'false' },
  { source: 'left', target: 'join', type: 'control' },
  { source: 'right', target: 'join', type: 'control' }
]

describe('layoutDag', () => {
  it('默认保留完整的显式布局', () => {
    const result = layoutDag(nodes, links)

    expect(result.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      nodes.map(({ id, x, y }) => ({ id, x, y }))
    )
    expect(result.direction).toBe('horizontal')
  })

  it('美化时强制生成居中的从上到下分层布局', () => {
    const result = layoutDag(nodes, links, {
      preserveExistingPositions: false
    })
    const positions = new Map(
      result.nodes.map((node) => [node.id, { x: node.x, y: node.y }])
    )

    expect(positions.get('start')?.x).toBe(360)
    expect(positions.get('branch')?.x).toBe(360)
    expect(positions.get('left')?.y).toBe(264)
    expect(positions.get('right')?.y).toBe(264)
    expect(positions.get('join')?.x).toBe(360)
    expect(positions.get('join')?.y).toBe(376)
    expect(result.direction).toBe('vertical')
  })

  it('无连线时根据节点坐标跨度判断布局方向', () => {
    const horizontal = layoutDag(
      [
        workflowNode('left', 'action', 20, 40),
        workflowNode('right', 'action', 420, 40)
      ],
      []
    )
    const vertical = layoutDag(
      [
        workflowNode('top', 'action', 40, 20),
        workflowNode('bottom', 'action', 40, 420)
      ],
      []
    )

    expect(horizontal.direction).toBe('horizontal')
    expect(vertical.direction).toBe('vertical')
  })
})

describe('beautifyWorkflowRevision', () => {
  it('只更新 Canonical layout 并保留其它布局元数据', () => {
    const revision: WorkflowRevision = {
      schema_version: '2',
      workflow_id: 'layout-test',
      revision_id: 'revision-1',
      invocations: nodes.map((node) => ({
        node_id: node.id,
        action_ref: `device.${node.id}`
      })),
      control_edges: links.map((link, index) => ({
        edge_id: `edge-${index}`,
        source: link.source,
        target: link.target,
        branch: link.branch
      })),
      layout: {
        viewport: { zoom: 0.8 },
        nodes: {
          start: { x: 900, y: 600, collapsed: true }
        }
      }
    }

    const result = beautifyWorkflowRevision(revision, nodes, links)
    const layout = result.layout as {
      viewport: { zoom: number }
      nodes: Record<string, Record<string, unknown>>
    }

    expect(layout.viewport).toEqual({ zoom: 0.8 })
    expect(layout.nodes.start.collapsed).toBe(true)
    expect(layout.nodes.start).toMatchObject({ x: 360, y: 40 })
    expect(revision.layout).not.toEqual(result.layout)
  })
})

function workflowNode(
  id: string,
  type: string,
  x: number,
  y: number
): WorkflowNode {
  return {
    id,
    name: id,
    type,
    className: `device.${id}`,
    labNodeType: type,
    x,
    y
  }
}
