import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkflowX6Canvas,
  workflowX6ProjectionDiff,
  type WorkflowX6Node
} from './WorkflowX6Canvas'
import {
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata
} from './workflowX6Projection'

describe('WorkflowX6Canvas scale policy', () => {
  it('updates only the changed stable-UUID cell for a node parameter edit', () => {
    const first = workflowNode('node-a')
    const second = workflowNode('node-b')
    const edge = {
      id: 'edge-a-b',
      source: 'node-a',
      target: 'node-b'
    }
    const changed = {
      ...first,
      data: { ...first.data, name: '只更新这个节点' }
    }

    expect(workflowX6ProjectionDiff(
      { nodes: [first, second], edges: [edge] },
      { nodes: [changed, second], edges: [edge] }
    )).toEqual({
      addNodeIds: [],
      updateNodeIds: ['node-a'],
      removeNodeIds: [],
      addEdgeIds: [],
      updateEdgeIds: [],
      removeEdgeIds: []
    })
  })

  it('does not reset the graph and always removes an interactive temporary edge', () => {
    const source = readFileSync(
      new URL('./WorkflowX6Canvas.tsx', import.meta.url),
      'utf8'
    )

    expect(source).not.toContain('resetCells(')
    expect(source).toMatch(
      /edge:connected[\s\S]*graph\.removeCell\(edge, \{ ui: false \}\)/
    )
  })

  it('keeps the DAG projection independent from React Flow state', () => {
    const source = readFileSync(
      new URL('../hooks/useWorkflowDag.ts', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from ['"]reactflow['"]/)
    expect(source).not.toContain('useNodesState')
    expect(source).not.toContain('useEdgesState')
  })

  /**
   * 验证五千节点以上仍使用 X6 虚拟画布，并关闭会复制视图的缩略图。
   *
   * @returns 无返回值；通过静态标记断言大图交互降级边界。
   * @safety 只构造内存投影，不初始化浏览器图实例或工作流任务。
   */
  it('keeps 5000+ nodes on the virtual canvas without a minimap copy', () => {
    const nodes = Array.from({ length: 5_001 }, (_, index) =>
      workflowNode(`node-${index}`)
    )
    const markup = renderToStaticMarkup(
      <WorkflowX6Canvas
        nodes={nodes}
        edges={[]}
        canvasMutationEnabled={false}
        nodePositionMutationEnabled={false}
        onNodeSelect={vi.fn()}
        onSelectionChange={vi.fn()}
      />
    )

    expect(markup).toContain('data-canvas-engine="x6"')
    expect(markup).toContain('data-x6-node-count="5001"')
    expect(markup).toContain('data-x6-virtual="true"')
    expect(markup).toContain('X6 虚拟画布')
    expect(markup).not.toContain('aria-label="工作流缩略图"')
    const source = readFileSync(
      new URL('./WorkflowX6Canvas.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain("graph.disposePlugins('minimap')")
  })

  /** Canonical Handle UUID 必须原样成为 X6 端口身份，连接不能按索引猜测。 */
  it('preserves canonical handle identities in X6 nodes and edges', () => {
    const node = workflowX6NodeMetadata({
      ...workflowNode('node-a'),
      data: {
        ...workflowNode('node-a').data,
        handles: [
          {
            uuid: 'handle-in',
            handleKey: 'input',
            displayName: '输入',
            ioType: 'target'
          },
          {
            uuid: 'handle-out',
            handleKey: 'output',
            displayName: '输出',
            ioType: 'source'
          }
        ]
      }
    })
    const edge = workflowX6EdgeMetadata({
      id: 'edge-a-b',
      source: 'node-a',
      sourceHandle: 'handle-out',
      target: 'node-b',
      targetHandle: 'handle-in'
    })

    const portItems = Array.isArray(node.ports)
      ? node.ports
      : node.ports?.items
    expect(portItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'handle-in', group: 'target' }),
      expect.objectContaining({ id: 'handle-out', group: 'source' })
    ]))
    expect(edge.source).toEqual({ cell: 'node-a', port: 'handle-out' })
    expect(edge.target).toEqual({ cell: 'node-b', port: 'handle-in' })
  })

  /** X6 必须恢复旧 React Flow 操作条、中文状态与 ready/物料端口语义。 */
  it('regresses action nodes to the React Flow visual contract', () => {
    const node = workflowX6NodeMetadata({
      ...workflowNode('mix-sample'),
      data: {
        ...workflowNode('mix-sample').data,
        name: '混合主样品',
        status: 'running',
        startNode: true,
        materialHandleAccents: { 'material-in': '#38a169' },
        handles: [
          {
            uuid: 'material-in',
            handleKey: 'sample',
            dataKey: 'sample',
            displayName: '样品',
            title: '主样品',
            valueType: 'ResourceSlot',
            ioType: 'target'
          },
          {
            uuid: 'ready-out',
            handleKey: 'ready',
            dataKey: 'ready',
            displayName: '就绪',
            valueType: 'Boolean',
            ioType: 'source'
          }
        ]
      }
    })

    expect(node.width).toBe(248)
    expect(node.height).toBe(64)
    expect(markupClassNames(node)).toEqual(expect.arrayContaining([
      'workflow-x6-node__body',
      'workflow-x6-node__material-card',
      'workflow-x6-node__status-pill',
      'workflow-x6-node__flag--start'
    ]))
    expect(markupTexts(node)).toEqual(expect.arrayContaining([
      '混合主样品',
      '正在运行',
      '⚑ 起始点'
    ]))
    const portItems = Array.isArray(node.ports)
      ? node.ports
      : node.ports?.items
    expect(portItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'material-in',
        markup: expect.arrayContaining([
          expect.objectContaining({
            className: expect.arrayContaining([
              'workflow-x6-port--material'
            ])
          })
        ])
      }),
      expect.objectContaining({
        id: 'ready-out',
        markup: expect.arrayContaining([
          expect.objectContaining({
            tagName: 'rect',
            className: expect.arrayContaining([
              'workflow-x6-port--ready'
            ])
          })
        ])
      })
    ]))
  })

  /** 物料来源、机械臂和反应物标注不能退化成同一种白色矩形卡片。 */
  it('keeps the three specialized React Flow node silhouettes', () => {
    const material = workflowX6NodeMetadata({
      ...workflowNode('source'),
      data: {
        ...workflowNode('source').data,
        kind: 'material_source',
        traceAccent: '#2f855a',
        materialSource: {
          mode: 'create_new',
          flowRole: 'primary_sample',
          mountUuid: 'mount',
          resourceTemplateUuid: 'template'
        }
      }
    })
    const transfer = workflowX6NodeMetadata({
      ...workflowNode('transfer'),
      data: {
        ...workflowNode('transfer').data,
        visualKind: 'robot-transfer',
        materialLaneDirection: 'horizontal'
      }
    })
    const reactionData = {
      ...workflowNode('reaction').data,
      reactionTargetNodeName: '反应',
      reactionMaterials: [{
        lineageKey: 'reagent-a',
        sourceNodeUuid: 'source-a',
        sourceNodeName: '催化剂 A',
        materialRole: 'reagent',
        materialRoleLabel: '试剂',
        accent: '#d97706'
      }]
    }
    const reaction = workflowX6NodeMetadata({
      ...workflowNode('reaction'),
      type: 'wfReactionMaterial',
      data: reactionData
    })

    expect({ width: material.width, height: material.height }).toEqual({
      width: 184,
      height: 72
    })
    expect(markupClassNames(material)).toContain(
      'workflow-x6-node__material-shape'
    )
    expect({ width: transfer.width, height: transfer.height }).toEqual({
      width: 120,
      height: 126
    })
    expect(markupClassNames(transfer)).toContain(
      'workflow-x6-node__transfer-shape'
    )
    expect({ width: reaction.width, height: reaction.height }).toEqual({
      width: 152,
      height: 22
    })
    expect(markupTexts(reaction)).toEqual(expect.arrayContaining([
      '催化剂 A',
      '试剂'
    ]))
  })

  /** 横向物料泳道的端口必须对齐旧版图形本体，不能对齐 X6 选区外框。 */
  it('aligns specialized material ports with the legacy visual axes', () => {
    const accent = '#2f855a'
    const material = workflowX6NodeMetadata({
      ...workflowNode('source'),
      data: {
        ...workflowNode('source').data,
        kind: 'material_source',
        materialLaneDirection: 'horizontal',
        traceAccent: accent,
        materialSource: {
          mode: 'create_new',
          flowRole: 'primary_sample',
          mountUuid: 'mount',
          resourceTemplateUuid: 'template'
        },
        handles: [{
          uuid: 'source-out',
          handleKey: 'material',
          dataKey: 'material',
          displayName: '主样品',
          valueType: 'ResourceSlot',
          ioType: 'source'
        }]
      }
    })
    const transfer = workflowX6NodeMetadata({
      ...workflowNode('transfer'),
      data: {
        ...workflowNode('transfer').data,
        visualKind: 'robot-transfer',
        materialLaneDirection: 'horizontal',
        materialHandleAccents: {
          'transfer-in': accent,
          'transfer-out': accent
        },
        handles: [
          {
            uuid: 'transfer-in',
            handleKey: 'sample',
            dataKey: 'sample',
            displayName: '主样品',
            valueType: 'ResourceSlot',
            ioType: 'target'
          },
          {
            uuid: 'transfer-out',
            handleKey: 'sample',
            dataKey: 'sample',
            displayName: '主样品',
            valueType: 'ResourceSlot',
            ioType: 'source'
          }
        ]
      }
    })

    expect(portGroups(material)).toMatchObject({
      materialSource: {
        position: { name: 'absolute', args: { x: 92, y: 92 } }
      }
    })
    expect(portGroups(transfer)).toMatchObject({
      materialTarget: {
        position: { name: 'absolute', args: { x: 33, y: 90 } }
      },
      materialSource: {
        position: { name: 'absolute', args: { x: 87, y: 90 } }
      }
    })
    expect(portItem(transfer, 'transfer-in')).toMatchObject({
      group: 'materialTarget',
      attrs: { portBody: { fill: 'var(--unilab-color-surface)' } }
    })
    expect(portItem(transfer, 'transfer-out')).toMatchObject({
      group: 'materialSource',
      attrs: { portBody: { fill: accent } }
    })
    expect(JSON.stringify(transfer.markup)).toContain(
      '60,63 87,90 60,117 33,90'
    )
  })

  /** 选中、运行、边动画和控制器都必须使用统一视觉 token。 */
  it('keeps semantic canvas styling tokenized and scale-aware', () => {
    const css = readFileSync(
      new URL('./_workflow-x6.scss', import.meta.url),
      'utf8'
    )
    const edge = workflowX6EdgeMetadata({
      id: 'material-edge',
      source: 'source',
      target: 'target',
      className: 'wf-flow-edge--material-trace',
      animated: true,
      style: { stroke: '#2f855a', strokeWidth: 3.6 },
      data: { materialEmphasis: 'primary' }
    })

    expect(edge.attrs?.root).toEqual(expect.objectContaining({
      'data-workflow-edge-kind': 'material',
      'data-workflow-edge-animated': 'true'
    }))
    expect(edge.attrs?.line).toEqual(expect.objectContaining({
      strokeDasharray: '3 8',
      targetMarker: expect.objectContaining({ name: 'block' })
    }))
    expect(css).toContain('var(--unilab-color-warning)')
    expect(css).toContain('var(--unilab-color-success)')
    expect(css).toContain('var(--unilab-color-paused)')
    expect(css).toContain('var(--unilab-color-focus)')
    expect(css).toContain('width: 164px')
    expect(css).toContain('@media (max-width: 960px)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})

/** 返回节点 SVG markup 中的全部 class，供类型视觉回归断言。 */
function markupClassNames(
  node: ReturnType<typeof workflowX6NodeMetadata>
): string[] {
  if (!Array.isArray(node.markup)) return []
  const classes: string[] = []
  const visit = (items: typeof node.markup): void => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') continue
      if (typeof item.className === 'string') {
        classes.push(...item.className.split(/\s+/).filter(Boolean))
      }
      else if (Array.isArray(item.className)) classes.push(...item.className)
      if (item.children) visit(item.children)
    }
  }
  visit(node.markup)
  return classes
}

/** 返回节点 SVG markup 的可见文本，确保状态不只依赖颜色。 */
function markupTexts(
  node: ReturnType<typeof workflowX6NodeMetadata>
): string[] {
  if (!Array.isArray(node.markup)) return []
  const texts: string[] = []
  const visit = (items: typeof node.markup): void => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (typeof item === 'string') continue
      if (item.textContent) texts.push(item.textContent)
      if (item.children) visit(item.children)
    }
  }
  visit(node.markup)
  return texts
}

/** 返回 X6 端口分组，用于比对 React Flow 的绝对句柄轴。 */
function portGroups(
  node: ReturnType<typeof workflowX6NodeMetadata>
): Record<string, unknown> {
  if (!node.ports || Array.isArray(node.ports)) return {}
  return node.ports.groups ?? {}
}

/** 按 Canonical Handle UUID 取得单个 X6 端口投影。 */
function portItem(
  node: ReturnType<typeof workflowX6NodeMetadata>,
  id: string
): Record<string, unknown> | undefined {
  const items = Array.isArray(node.ports)
    ? node.ports
    : node.ports?.items
  return items?.find(item => item.id === id)
}

/** 构造不携带运行副作用的最小 X6 工作流节点投影。 */
function workflowNode(id: string): WorkflowX6Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      id,
      name: id,
      kind: 'action',
      color: '#3568ed'
    }
  }
}
