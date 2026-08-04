/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: DAG 分层布局(longest-path layering + 层内排序),输出 ReactFlow 坐标
 * Context: 工作流拓扑图 nodes/links -> 有向图布局,从上到下分层
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import type { WorkflowLink, WorkflowNode } from './parseWorkflow'
import type { WorkflowRevision } from '@unilab/services'

// 布局后的节点(带坐标)
export interface LayoutNode extends WorkflowNode {
  x: number
  y: number
}

export type DagLayoutDirection = 'horizontal' | 'vertical'

export interface LayoutResult {
  nodes: LayoutNode[]
  links: WorkflowLink[]
  direction: DagLayoutDirection
}

export interface LayoutDagOptions {
  preserveExistingPositions?: boolean
}

// 层间垂直间距、层内水平间距(与 ReactFlow 节点尺寸匹配)
const LAYER_GAP_Y = 112
const NODE_GAP_X = 360
const ORIGIN_X = 180
const ORIGIN_Y = 40

// 对 nodes/links 做从上到下的分层布局
export function layoutDag(
  nodes: WorkflowNode[],
  links: WorkflowLink[],
  options: LayoutDagOptions = {}
): LayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], links, direction: 'vertical' }
  }

  const validIds = new Set(nodes.map((node) => node.id))
  const edges = links.filter(
    (link) => validIds.has(link.source) && validIds.has(link.target)
  )

  // 若所有节点已携带显式坐标(如 JSON 导出格式),直接沿用,不再自动分层
  if (
    options.preserveExistingPositions !== false &&
    nodes.every(
      (node) => typeof node.x === 'number' && typeof node.y === 'number'
    )
  ) {
    const laidOut = nodes.map((node) => ({
      ...node,
      x: node.x as number,
      y: node.y as number
    }))
    return {
      nodes: laidOut,
      links: edges,
      direction: layoutDirection(laidOut, edges)
    }
  }
  const layerOf = assignLayers(nodes, edges)
  const incoming = incomingNodeIds(nodes, edges)
  const sourceOrder = new Map(
    nodes.map((node, index) => [node.id, index])
  )

  // 按层分组,层内保持节点原始顺序
  const byLayer = new Map<number, WorkflowNode[]>()
  nodes.forEach((node) => {
    const layer = layerOf.get(node.id) ?? 0
    const bucket = byLayer.get(layer) ?? []
    bucket.push(node)
    byLayer.set(layer, bucket)
  })

  const layerIndexes = [...byLayer.keys()].sort((left, right) => left - right)
  const orderInLayer = new Map<string, number>()
  for (const layer of layerIndexes) {
    const bucket = byLayer.get(layer) || []
    bucket.sort((left, right) => {
      const leftScore = predecessorOrder(left.id, incoming, orderInLayer)
      const rightScore = predecessorOrder(right.id, incoming, orderInLayer)
      if (leftScore !== rightScore) return leftScore - rightScore
      return (sourceOrder.get(left.id) || 0) - (sourceOrder.get(right.id) || 0)
    })
    bucket.forEach((node, index) => orderInLayer.set(node.id, index))
  }

  const widestLayer = Math.max(
    1,
    ...layerIndexes.map((layer) => byLayer.get(layer)?.length || 0)
  )
  const layoutNodes: LayoutNode[] = []
  for (const layer of layerIndexes) {
    const bucket = byLayer.get(layer) || []
    const centeredOffset = (widestLayer - bucket.length) * NODE_GAP_X / 2
    bucket.forEach((node, indexInLayer) => {
      layoutNodes.push({
        ...node,
        x: ORIGIN_X + centeredOffset + indexInLayer * NODE_GAP_X,
        y: ORIGIN_Y + layer * LAYER_GAP_Y
      })
    })
  }

  return {
    nodes: layoutNodes,
    links: edges,
    direction: 'vertical'
  }
}

function layoutDirection(
  nodes: LayoutNode[],
  edges: WorkflowLink[]
): DagLayoutDirection {
  const positions = new Map(
    nodes.map((node) => [node.id, { x: node.x, y: node.y }])
  )
  let horizontalDistance = 0
  let verticalDistance = 0
  let connectedPairCount = 0

  for (const edge of edges) {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (!source || !target || edge.source === edge.target) continue
    horizontalDistance += Math.abs(target.x - source.x)
    verticalDistance += Math.abs(target.y - source.y)
    connectedPairCount += 1
  }

  if (
    connectedPairCount > 0 &&
    horizontalDistance !== verticalDistance
  ) {
    return horizontalDistance > verticalDistance
      ? 'horizontal'
      : 'vertical'
  }

  const xValues = nodes.map((node) => node.x)
  const yValues = nodes.map((node) => node.y)
  const horizontalSpan = Math.max(...xValues) - Math.min(...xValues)
  const verticalSpan = Math.max(...yValues) - Math.min(...yValues)
  return horizontalSpan > verticalSpan ? 'horizontal' : 'vertical'
}

export function beautifyWorkflowRevision(
  revision: WorkflowRevision,
  nodes: WorkflowNode[],
  links: WorkflowLink[]
): WorkflowRevision {
  const layout = recordValue(revision.layout)
  const previousNodes = recordValue(layout.nodes)
  const nextNodes = { ...previousNodes }
  const result = layoutDag(nodes, links, {
    preserveExistingPositions: false
  })
  for (const node of result.nodes) {
    nextNodes[node.id] = {
      ...recordValue(previousNodes[node.id]),
      x: node.x,
      y: node.y
    }
  }
  return {
    ...revision,
    layout: {
      ...layout,
      nodes: nextNodes
    }
  }
}

// 用最长路径法为每个节点分层:layer(n) = max(layer(前驱)) + 1
function assignLayers(nodes: WorkflowNode[], edges: WorkflowLink[]): Map<string, number> {
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  nodes.forEach((node) => {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
  })
  edges.forEach((edge) => {
    outgoing.get(edge.source)?.push(edge.target)
    incoming.get(edge.target)?.push(edge.source)
  })

  const layer = new Map<string, number>()
  const visiting = new Set<string>()

  // 递归求某节点所在层;visiting 集合防止环导致的无限递归
  const resolve = (id: string): number => {
    const cached = layer.get(id)
    if (cached != null) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const preds = incoming.get(id) ?? []
    const value = preds.length === 0 ? 0 : Math.max(...preds.map(resolve)) + 1
    visiting.delete(id)
    layer.set(id, value)
    return value
  }

  nodes.forEach((node) => resolve(node.id))
  return layer
}

function incomingNodeIds(
  nodes: WorkflowNode[],
  edges: WorkflowLink[]
): Map<string, string[]> {
  const incoming = new Map(
    nodes.map((node) => [node.id, [] as string[]])
  )
  for (const edge of edges) {
    incoming.get(edge.target)?.push(edge.source)
  }
  return incoming
}

function predecessorOrder(
  nodeId: string,
  incoming: ReadonlyMap<string, string[]>,
  orderInLayer: ReadonlyMap<string, number>
): number {
  const orders = (incoming.get(nodeId) || [])
    .map((sourceId) => orderInLayer.get(sourceId))
    .filter((order): order is number => order !== undefined)
  if (orders.length === 0) return Number.POSITIVE_INFINITY
  return orders.reduce((total, order) => total + order, 0) / orders.length
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
