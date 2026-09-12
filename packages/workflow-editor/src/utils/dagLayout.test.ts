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
  it('lays out a deep reverse-ordered DAG without exhausting the call stack', () => {
    const count = 10_000
    const chain = Array.from({ length: count }, (_, index) =>
      workflowNode(`node-${index}`, 'action', 0, 0)
    )
    const edges = chain.slice(1).map((node, index) => ({
      source: chain[index]!.id,
      target: node.id,
      type: 'control'
    }))
    const result = layoutDag([...chain].reverse(), edges, {
      preserveExistingPositions: false
    })
    expect(result.nodes).toHaveLength(count)
    expect(result.links).toEqual(edges)
    const byId = new Map(result.nodes.map(node => [node.id, node]))
    for (const edge of edges) {
      expect(byId.get(edge.target)!.y).toBeGreaterThan(byId.get(edge.source)!.y)
    }
  })

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
    expect(positions.get('left')?.y).toBe(320)
    expect(positions.get('right')?.y).toBe(320)
    expect(positions.get('join')?.x).toBe(360)
    expect(positions.get('join')?.y).toBe(460)
    expect(result.direction).toBe('vertical')
  })

  it('keeps material sources centered above grouped first consumers', () => {
    const result = layoutDag(
      [
        {
          ...workflowNode('source-a', 'material_source', 0, 0),
          handles: [materialHandle('source-a-handle', 'source')]
        },
        {
          ...workflowNode('source-b', 'material_source', 0, 0),
          handles: [materialHandle('source-b-handle', 'source')]
        },
        workflowNode('group-a', 'group', 0, 0),
        {
          ...workflowNode('action-a', 'action', 0, 0),
          parentGroupId: 'group-a',
          handles: [
            materialHandle('action-a-handle', 'target'),
            materialHandle('action-a-unconnected', 'target')
          ]
        },
        workflowNode('group-b', 'group', 0, 0),
        {
          ...workflowNode('action-b', 'action', 0, 0),
          parentGroupId: 'group-b',
          handles: [
            materialHandle('action-b-handle', 'target'),
            materialHandle('action-b-unconnected', 'target')
          ]
        }
      ],
      [
        {
          source: 'source-a',
          target: 'action-a',
          type: 'material',
          sourceHandleUuid: 'source-a-handle',
          targetHandleUuid: 'action-a-handle'
        },
        {
          source: 'source-b',
          target: 'action-b',
          type: 'material',
          sourceHandleUuid: 'source-b-handle',
          targetHandleUuid: 'action-b-handle'
        }
      ],
      { preserveExistingPositions: false }
    )
    const positions = new Map(
      result.nodes.map((node) => [node.id, { x: node.x, y: node.y }])
    )
    expect((positions.get('source-a')?.x ?? 0) + 148).toBe(
      (positions.get('action-a')?.x ?? 0) + 149
    )
    expect((positions.get('source-b')?.x ?? 0) + 148).toBe(
      (positions.get('action-b')?.x ?? 0) + 149
    )
    expect(positions.get('action-a')?.y).toBeGreaterThan(
      positions.get('source-a')?.y ?? 0
    )
    expect(positions.get('group-a')?.x).toBeLessThan(
      positions.get('action-a')?.x ?? 0
    )
  })

  /** 验证不同物料来源（MaterialSource）对齐同列消费者后仍保持可见间距。 */
  it('keeps same-column material sources from occupying one position', () => {
    const result = layoutDag(
      [
        {
          ...workflowNode('fine-powder', 'material_source', 0, 0),
          handles: [materialHandle('fine-output', 'source')]
        },
        {
          ...workflowNode('sample-vial', 'material_source', 0, 0),
          handles: [materialHandle('vial-output', 'source')]
        },
        {
          ...workflowNode('prepare-fine', 'action', 0, 0),
          handles: [materialHandle('fine-input', 'target')]
        },
        workflowNode('middle', 'action', 0, 0),
        {
          ...workflowNode('open-vial', 'action', 0, 0),
          handles: [materialHandle('vial-input', 'target')]
        }
      ],
      [
        materialLink(
          'fine-powder',
          'fine-output',
          'prepare-fine',
          'fine-input'
        ),
        {
          source: 'prepare-fine',
          target: 'middle',
          type: 'control'
        },
        { source: 'middle', target: 'open-vial', type: 'control' },
        materialLink(
          'sample-vial',
          'vial-output',
          'open-vial',
          'vial-input'
        )
      ],
      { preserveExistingPositions: false }
    )
    const positions = new Map(
      result.nodes.map((node) => [node.id, `${node.x}:${node.y}`])
    )

    expect(positions.get('fine-powder')).not.toBe(
      positions.get('sample-vial')
    )
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

function materialHandle(
  uuid: string,
  ioType: 'source' | 'target'
): import('./parseWorkflow').WorkflowHandlePort {
  return {
    uuid,
    handleKey: 'resource',
    displayName: '物料',
    ioType,
    valueType: 'ResourceSlot'
  }
}

/**
 * 构造连接两个物料占位符（ResourceSlot）的测试边。
 *
 * @param source 来源节点身份。
 * @param sourceHandleUuid 来源物料句柄（Handle）身份。
 * @param target 消费节点身份。
 * @param targetHandleUuid 目标物料句柄（Handle）身份。
 * @returns 可供布局算法消费的物料流（MaterialFlow）边。
 */
function materialLink(
  source: string,
  sourceHandleUuid: string,
  target: string,
  targetHandleUuid: string
): WorkflowLink {
  return {
    source,
    target,
    type: 'material',
    sourceHandleUuid,
    targetHandleUuid
  }
}
