import { describe, expect, it } from 'vitest'

import type { WorkflowLink, WorkflowNode } from './parseWorkflow'
import { layoutVisibleWorkflowDag } from './workflowDagLayout'

describe('layoutVisibleWorkflowDag', () => {
  it('places linked nodes left to right when horizontal layout is requested', async () => {
    const nodes = [workflowNode('a', 'action'), workflowNode('b', 'action'), workflowNode('c', 'action')]
    const links: WorkflowLink[] = [{ source: 'a', target: 'b', type: 'ready' }, { source: 'b', target: 'c', type: 'ready' }]
    const result = await layoutVisibleWorkflowDag(nodes, links, 'crossing-minimized', 'horizontal')
    expect(result.direction).toBe('horizontal')
    const [a, b, c] = result.nodes
    expect(b!.x - a!.x).toBeGreaterThanOrEqual(248)
    expect(c!.x - b!.x).toBeGreaterThanOrEqual(248)
    expect(a!.y).toBe(b!.y)
    expect(b!.y).toBe(c!.y)
    expect(result.links).toEqual(links)
  })

  /** 验证物料来源与动作节点共同参与纵向分层，并且同层不重叠。 */
  it('lays out every visible node in non-overlapping horizontal layers', async () => {
    const nodes = [
      workflowNode('fine-powder', 'material_source'),
      workflowNode('sample-vial', 'material_source'),
      workflowNode('prepare', 'action'),
      workflowNode('open', 'action'),
      workflowNode('finish', 'action')
    ]
    const links: WorkflowLink[] = [
      { source: 'fine-powder', target: 'prepare', type: 'material' },
      { source: 'sample-vial', target: 'open', type: 'material' },
      { source: 'prepare', target: 'finish', type: 'ready' },
      { source: 'open', target: 'finish', type: 'ready' }
    ]

    const result = await layoutVisibleWorkflowDag(nodes, links)
    const byId = new Map(result.nodes.map((node) => [node.id, node]))

    expect(result.nodes).toHaveLength(nodes.length)
    expect(byId.get('fine-powder')?.y).toBe(byId.get('sample-vial')?.y)
    expect(byId.get('prepare')?.y).toBe(byId.get('open')?.y)
    expect(byId.get('prepare')?.y).toBeGreaterThan(
      byId.get('fine-powder')?.y ?? 0
    )
    expect(byId.get('finish')?.y).toBeGreaterThan(byId.get('prepare')?.y ?? 0)
    expect(Math.abs(
      (byId.get('fine-powder')?.x ?? 0) -
      (byId.get('sample-vial')?.x ?? 0)
    )).toBeGreaterThanOrEqual(216)
    expect(new Set(
      result.nodes.map((node) => `${node.x}:${node.y}`)
    ).size).toBe(nodes.length)
  })

  /** 验证异步 ELK 布局不会覆盖物料来源与首个消费端口的同列约束。 */
  it('aligns material sources with their first consumer ports', async () => {
    const nodes: WorkflowNode[] = [
      {
        ...workflowNode('beaker-source', 'material_source'),
        handles: [materialHandle('beaker-output', 'source')]
      },
      {
        ...workflowNode('powder-source', 'material_source'),
        handles: [materialHandle('powder-output', 'source')]
      },
      {
        ...workflowNode('prepare-beaker', 'action'),
        handles: [materialHandle('beaker-input', 'target')]
      },
      {
        ...workflowNode('prepare-powder', 'action'),
        handles: [materialHandle('powder-input', 'target')]
      }
    ]
    const links: WorkflowLink[] = [
      materialLink(
        'beaker-source',
        'beaker-output',
        'prepare-beaker',
        'beaker-input'
      ),
      materialLink(
        'powder-source',
        'powder-output',
        'prepare-powder',
        'powder-input'
      )
    ]

    const result = await layoutVisibleWorkflowDag(nodes, links)
    const byId = new Map(result.nodes.map((node) => [node.id, node]))

    expect((byId.get('beaker-source')?.x ?? 0) + 148).toBe(
      (byId.get('prepare-beaker')?.x ?? 0) + 149
    )
    expect((byId.get('powder-source')?.x ?? 0) + 148).toBe(
      (byId.get('prepare-powder')?.x ?? 0) + 149
    )
  })

  /** 小型线性流程应保持可读卡片尺寸，而不是被过大的层间距迫使 fitView 缩小。 */
  it('keeps a linear action track compact enough for a split IDE pane', async () => {
    const nodes = [
      workflowNode('place', 'action'),
      workflowNode('process', 'action'),
      workflowNode('pick', 'action')
    ]
    const links: WorkflowLink[] = [
      { source: 'place', target: 'process', type: 'ready' },
      { source: 'process', target: 'pick', type: 'ready' }
    ]

    const result = await layoutVisibleWorkflowDag(nodes, links)
    const ordered = [...result.nodes].sort((left, right) => left.y - right.y)
    const layerSteps = ordered.slice(1).map((node, index) => (
      node.y - (ordered[index]?.y ?? 0)
    ))

    expect(layerSteps.every((step) => step >= 128 && step <= 140)).toBe(true)
  })
})

/**
 * 创建布局测试所需的最小工作流节点。
 *
 * @param id 节点 UUID。
 * @param type 节点类型。
 * @returns 不含历史坐标的工作流节点。
 */
function workflowNode(id: string, type: string): WorkflowNode {
  return {
    id,
    name: id,
    type,
    className: '',
    labNodeType: ''
  }
}

/** 创建可参与物料流（MaterialFlow）布局的物料占位符（ResourceSlot）句柄。 */
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

/** 创建带稳定句柄 UUID 的物料流（MaterialFlow）边。 */
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
