import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkflowX6Canvas,
  workflowX6HandleConnectionCandidates,
  workflowX6ProjectionDiff,
  type WorkflowX6Node
} from './WorkflowX6Canvas'
import {
  WORKFLOW_X6_INPUT_PORT_ID,
  WORKFLOW_X6_OUTPUT_PORT_ID,
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata,
  workflowX6NodeTooltipText
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
    expect(source).toMatch(
      /if \(nodes\.length === 0\) \{[\s\S]*initialFitPending\.current = false/
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

  /** 视觉端口固定为左右两个，Canonical Handle UUID 只保留在边数据中。 */
  it('separates two aggregate visual ports from canonical handle identities', () => {
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
    expect(portItems).toHaveLength(2)
    expect(portItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: WORKFLOW_X6_INPUT_PORT_ID,
        group: 'input'
      }),
      expect.objectContaining({
        id: WORKFLOW_X6_OUTPUT_PORT_ID,
        group: 'output'
      })
    ]))
    expect(portItems?.map(item => item.id)).not.toContain('handle-in')
    expect(portItems?.map(item => item.id)).not.toContain('handle-out')
    expect(edge.source).toEqual({
      cell: 'node-a',
      port: WORKFLOW_X6_OUTPUT_PORT_ID
    })
    expect(edge.target).toEqual({
      cell: 'node-b',
      port: WORKFLOW_X6_INPUT_PORT_ID
    })
    expect(edge.data).toEqual(expect.objectContaining({
      sourceHandleUuid: 'handle-out',
      targetHandleUuid: 'handle-in'
    }))
  })

  /** 聚合端口连接优先解析未占用、语义和类型匹配的真实 Handle。 */
  it('resolves an aggregate connection to the best canonical handle pair', () => {
    const source = {
      ...workflowNode('source'),
      data: {
        ...workflowNode('source').data,
        handles: [
          handle('source-material', 'sample', 'source', 'ResourceSlot'),
          handle('source-ready', 'ready', 'source', 'Boolean')
        ]
      }
    }
    const target = {
      ...workflowNode('target'),
      data: {
        ...workflowNode('target').data,
        handles: [
          handle('target-ready-used', 'ready', 'target', 'Boolean'),
          handle('target-material', 'sample', 'target', 'ResourceSlot'),
          handle('target-ready-free', 'ready', 'target', 'Boolean')
        ]
      }
    }

    expect(workflowX6HandleConnectionCandidates(
      [source, target],
      [{
        id: 'existing',
        source: 'other',
        target: 'target',
        targetHandle: 'target-ready-used'
      }],
      'source',
      'target'
    )).toEqual(expect.arrayContaining([
      {
        sourceNodeUuid: 'source',
        sourceHandleUuid: 'source-ready',
        targetNodeUuid: 'target',
        targetHandleUuid: 'target-ready-free'
      }
    ]))
    expect(workflowX6HandleConnectionCandidates(
      [source, target],
      [{
        id: 'existing',
        source: 'other',
        target: 'target',
        targetHandle: 'target-ready-used'
      }],
      'source',
      'target'
    )[0]).toEqual({
      sourceNodeUuid: 'source',
      sourceHandleUuid: 'source-ready',
      targetNodeUuid: 'target',
      targetHandleUuid: 'target-ready-free'
    })
  })

  /** 原型卡片的可见端口固定为左右各一个，不随代码 handle 数量增加。 */
  it('keeps prototype action cards to one visible handle per side', () => {
    const node = workflowX6NodeMetadata({
      ...workflowNode('node-a'),
      data: {
        ...workflowNode('node-a').data,
        handles: [
          { uuid: 'target-ready', handleKey: 'ready', displayName: '就绪',
            ioType: 'target', dataKey: 'ready', valueType: 'Boolean' },
          { uuid: 'target-extra', handleKey: 'sample', displayName: '样品',
            ioType: 'target' },
          { uuid: 'source-ready', handleKey: 'ready', displayName: '就绪',
            ioType: 'source', dataKey: 'ready', valueType: 'Boolean' },
          { uuid: 'source-extra', handleKey: 'result', displayName: '结果',
            ioType: 'source' }
        ]
      }
    })
    const items = (Array.isArray(node.ports) ? node.ports : node.ports?.items) ?? []
    const visible = items.filter((item) => {
      const body = item.attrs?.portBody as Record<string, unknown> | undefined
      return Boolean(item.id) && body?.opacity !== 0
    })
    expect(visible.map((item) => item.id)).toEqual([
      WORKFLOW_X6_INPUT_PORT_ID,
      WORKFLOW_X6_OUTPUT_PORT_ID
    ])
    expect(portItem(node, 'target-extra')).toBeUndefined()
    expect(portItem(node, 'source-extra')).toBeUndefined()
  })

  /** 默认工作流卡片必须严格使用 HTML 原型的 132×66 三行信息结构。 */
  it('projects action nodes with the HTML workflow-card contract', () => {
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

    expect(node.width).toBe(132)
    expect(node.height).toBe(66)
    expect(markupClassNames(node)).toEqual(expect.arrayContaining([
      'workflow-x6-node__body',
      'workflow-x6-node__kind-dot',
      'workflow-x6-node__kind',
      'workflow-x6-node__label',
      'workflow-x6-node__detail',
      'workflow-x6-node__flag--start'
    ]))
    expect(markupTexts(node)).toEqual(expect.arrayContaining([
      '实验操作',
      '混合主样品',
      '⚑ 起始点'
    ]))
    expect(markupClassNames(node)).not.toEqual(expect.arrayContaining([
      'workflow-x6-node__divider',
      'workflow-x6-node__status-pill'
    ]))
    const portItems = Array.isArray(node.ports)
      ? node.ports
      : node.ports?.items
    expect(portItems).toHaveLength(2)
    expect(portItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: WORKFLOW_X6_INPUT_PORT_ID }),
      expect.objectContaining({ id: WORKFLOW_X6_OUTPUT_PORT_ID })
    ]))
    expect(node.portMarkup).toMatchObject({
      tagName: 'circle',
      attrs: { r: 0, opacity: 0, visibility: 'hidden' }
    })
  })

  /** 节点文字被原型卡片截断时，完整文案通过悬浮提示暴露。 */
  it('exposes full copy only for overflowing node text', () => {
    const overflowing = workflowNode('node-overflow')
    overflowing.data = {
      ...overflowing.data,
      name: '这是一个明显超出原型卡片宽度的超长动作名称',
      description: '这是一个需要在悬浮提示中完整阅读的动作说明。'
    }
    const metadata = workflowX6NodeMetadata(overflowing)
    expect(workflowX6NodeTooltipText(overflowing)).toContain(
      overflowing.data.name
    )
    expect(metadata.attrs?.root).toEqual(expect.objectContaining({
      'data-workflow-node-overflow': 'true',
      title: expect.stringContaining(overflowing.data.name)
    }))

    const compact = workflowNode('node-short')
    const compactMetadata = workflowX6NodeMetadata(compact)
    expect(workflowX6NodeTooltipText(compact)).toBeNull()
    expect(compactMetadata.attrs?.root).toEqual(expect.objectContaining({
      'data-workflow-node-overflow': 'false'
    }))
    expect(compactMetadata.attrs?.root).not.toHaveProperty('title')
  })

  /** X6 画布使用视口顶层提示层，避免 SVG/画布裁剪完整文案。 */
  it('renders an accessible viewport tooltip for overflow nodes', () => {
    const source = readFileSync(
      new URL('./WorkflowX6Canvas.tsx', import.meta.url),
      'utf8'
    )
    expect(source).toContain("root.addEventListener('pointerover'")
    expect(source).toContain("root.addEventListener('pointerout'")
    expect(source).toContain('workflowX6NodeTooltipPosition')
    expect(source).toContain('className="workflowX6NodeTooltip"')
    expect(source).toContain('role="tooltip"')
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

  /** 特殊节点也只保留左右两个节点级端口，不暴露物料 Handle 数量。 */
  it('keeps specialized nodes on the same two-port visual contract', () => {
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

    expect(portGroups(material)).toEqual({
      input: { position: 'left' },
      output: { position: 'right' }
    })
    expect(portGroups(transfer)).toEqual({
      input: { position: 'left' },
      output: { position: 'right' }
    })
    expect(portItems(material)).toHaveLength(2)
    expect(portItems(transfer)).toHaveLength(2)
    expect(portItem(transfer, 'transfer-in')).toBeUndefined()
    expect(portItem(transfer, 'transfer-out')).toBeUndefined()
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

function portItems(
  node: ReturnType<typeof workflowX6NodeMetadata>
) {
  return Array.isArray(node.ports) ? [] : node.ports?.items ?? []
}

function handle(
  uuid: string,
  handleKey: string,
  ioType: 'source' | 'target',
  valueType: string
): NonNullable<WorkflowX6Node['data']['handles']>[number] {
  return {
    uuid,
    handleKey,
    displayName: handleKey,
    dataKey: handleKey,
    ioType,
    valueType
  }
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
