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
import { isResourceSlotHandle } from './workflowMaterialTrace'
import type {
  WorkflowDagLayoutStrategy,
  WorkflowMaterialSwimlaneDirection
} from './workflowDagLayoutStrategy'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
} from './workflowDagLayoutStrategy'
import {
  layoutWorkflowMaterialSwimlanes,
  type WorkflowMaterialSwimlaneProjection
} from './workflowMaterialSwimlaneLayout'
import { layoutWorkflowPrimarySampleFlow } from './workflowPrimarySampleLayout'

// 布局后的节点(带坐标)
export interface LayoutNode extends WorkflowNode {
  x: number
  y: number
}

export type DagLayoutDirection = 'horizontal' | 'vertical'

export type WorkflowNodePortSide = 'top' | 'right' | 'bottom' | 'left'

export interface WorkflowNodePortLayout {
  target: WorkflowNodePortSide
  source: WorkflowNodePortSide
}

export interface WorkflowPrimarySampleLayoutProjection {
  hasPrimarySample: boolean
  backboneNodeIds: readonly string[]
  rowByNode: Map<string, number>
}

export interface LayoutResult {
  nodes: LayoutNode[]
  links: WorkflowLink[]
  direction: DagLayoutDirection
  swimlanes?: WorkflowMaterialSwimlaneProjection
  nodePorts?: Map<string, WorkflowNodePortLayout>
  edgeDirections?: Map<number, 'TB' | 'LR'>
  primarySample?: WorkflowPrimarySampleLayoutProjection
}

export interface LayoutDagOptions {
  preserveExistingPositions?: boolean
}

// 层间垂直间距、层内水平间距(与 ReactFlow 节点尺寸匹配)
const LAYER_GAP_Y = 140
const NODE_GAP_X = 360
const ORIGIN_X = 180
const ORIGIN_Y = 40
const ACTION_NODE_WIDTH = 248
const MATERIAL_SOURCE_NODE_WIDTH = 184
const TRANSFER_NODE_WIDTH = 176
const GROUP_LABEL_GAP_X = 240
const SINGLE_MATERIAL_PORT_CENTER_X = 149
const MATERIAL_SOURCE_MATERIAL_PORT_CENTER_X = 148
const TRANSFER_MATERIAL_PORT_CENTER_X = 140
const NODE_COLLISION_GAP_X = 80

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
  // 原生 Group 只表达编写范围，不是执行拓扑节点。Cloud 的纵排布局同样先
  // 排除这类容器；否则无边 Group 会挤进根层，把物料来源与首个消费节点错列。
  const containerGroupIds = layoutContainerGroupIds(nodes, edges)
  const topologyNodes = nodes.filter((node) => !containerGroupIds.has(node.id))
  const layoutNodeIds = new Set(topologyNodes.map((node) => node.id))
  const layoutEdges = edges.filter((edge) =>
    layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target)
  )
  const layerOf = assignLayers(topologyNodes, layoutEdges)
  const incoming = incomingNodeIds(topologyNodes, layoutEdges)
  const sourceOrder = new Map(
    topologyNodes.map((node, index) => [node.id, index])
  )

  // 按层分组,层内保持节点原始顺序
  const byLayer = new Map<number, WorkflowNode[]>()
  topologyNodes.forEach((node) => {
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
  const laidOutNodes: LayoutNode[] = []
  for (const layer of layerIndexes) {
    const bucket = byLayer.get(layer) || []
    const centeredOffset = (widestLayer - bucket.length) * NODE_GAP_X / 2
    bucket.forEach((node, indexInLayer) => {
      laidOutNodes.push({
        ...node,
        x: ORIGIN_X + centeredOffset + indexInLayer * NODE_GAP_X +
          nodeCenteringOffset(node),
        y: ORIGIN_Y + layer * LAYER_GAP_Y
      })
    })
  }

  const alignedNodes = finalizeMaterialSourcePlacement(
    laidOutNodes,
    layoutEdges
  )
  const finalNodes = layoutContainerNodes(
    nodes,
    alignedNodes,
    containerGroupIds
  )

  return {
    nodes: finalNodes,
    links: edges,
    direction: 'vertical'
  }
}

/**
 * 对齐物料来源（MaterialSource）与首个消费端口，并消除对齐后的同层碰撞。
 *
 * 同步分层布局与异步 ELK 布局必须共享这一最终化步骤，否则异步结果安装后会
 * 覆盖来源端口的同列约束。
 *
 * @param nodes 已完成基础分层的工作流节点。
 * @param edges 当前可见工作流（Workflow）边。
 * @returns 保持节点身份与纵向层级、完成物料端口对齐的节点。
 */
export function finalizeMaterialSourcePlacement(
  nodes: readonly LayoutNode[],
  edges: readonly WorkflowLink[]
): LayoutNode[] {
  return separateLayerCollisions(
    alignMaterialSourcesToFirstPorts(nodes, edges)
  )
}

/**
 * 消除物料来源（MaterialSource）二次对齐后造成的同层节点重合。
 *
 * @param nodes 已完成物料端口对齐的工作流节点。
 * @returns 保持原有顺序且满足最小水平间距的节点。
 */
function separateLayerCollisions(nodes: readonly LayoutNode[]): LayoutNode[] {
  const byLayer = new Map<number, LayoutNode[]>()
  for (const node of nodes) {
    const bucket = byLayer.get(node.y) ?? []
    bucket.push(node)
    byLayer.set(node.y, bucket)
  }
  const nextX = new Map<string, number>()
  for (const layerNodes of byLayer.values()) {
    const ordered = [...layerNodes].sort((left, right) => left.x - right.x)
    let rightEdge = Number.NEGATIVE_INFINITY
    for (const node of ordered) {
      const width = node.type === 'material_source'
        ? MATERIAL_SOURCE_NODE_WIDTH
        : node.visualKind === 'robot-transfer'
          ? TRANSFER_NODE_WIDTH
          : ACTION_NODE_WIDTH
      const x = Math.max(node.x, rightEdge + NODE_COLLISION_GAP_X)
      nextX.set(node.id, x)
      rightEdge = x + width
    }
  }
  return nodes.map((node) => ({
    ...node,
    x: nextX.get(node.id) ?? node.x
  }))
}

function alignMaterialSourcesToFirstPorts(
  nodes: readonly LayoutNode[],
  edges: readonly WorkflowLink[]
): LayoutNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const nextX = new Map<string, number>()
  for (const source of nodes) {
    if (source.type !== 'material_source') continue
    const anchors = edges.flatMap((edge) => {
      if (edge.source !== source.id || !edge.targetHandleUuid) return []
      const target = byId.get(edge.target)
      const targetHandles = new Map(
        (target?.handles ?? []).map((handle) => [handle.uuid, handle])
      )
      const materialTargets = edges.flatMap((candidate) => {
        if (
          candidate.target !== target?.id ||
          !candidate.targetHandleUuid
        ) return []
        const handle = targetHandles.get(candidate.targetHandleUuid)
        return handle?.ioType === 'target' && isResourceSlotHandle(handle)
          ? [handle]
          : []
      }).filter((handle, index, handles) =>
        handles.findIndex((candidate) => candidate.uuid === handle.uuid) === index
      )
      if (
        !target ||
        materialTargets.length !== 1 ||
        materialTargets[0]?.uuid !== edge.targetHandleUuid
      ) return []
      return [
        target.x + (target.visualKind === 'robot-transfer'
          ? TRANSFER_MATERIAL_PORT_CENTER_X
          : SINGLE_MATERIAL_PORT_CENTER_X) -
          MATERIAL_SOURCE_MATERIAL_PORT_CENTER_X
      ]
    })
    if (anchors.length > 0) {
      nextX.set(
        source.id,
        anchors.reduce((total, value) => total + value, 0) / anchors.length
      )
    }
  }
  return nodes.map((node) => ({
    ...node,
    x: nextX.get(node.id) ?? node.x
  }))
}

function nodeCenteringOffset(node: WorkflowNode): number {
  return node.type === 'material_source'
    ? (ACTION_NODE_WIDTH - MATERIAL_SOURCE_NODE_WIDTH) / 2
    : node.visualKind === 'robot-transfer'
      ? (ACTION_NODE_WIDTH - TRANSFER_NODE_WIDTH) / 2
      : 0
}

function layoutContainerGroupIds(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowLink[]
): Set<string> {
  const parents = new Set(
    nodes
      .map((node) => node.parentGroupId)
      .filter((id): id is string => Boolean(id))
  )
  const connected = new Set(
    edges.flatMap((edge) => [edge.source, edge.target])
  )
  return new Set(
    nodes
      .filter((node) =>
        parents.has(node.id) &&
        !connected.has(node.id) &&
        node.type.toLowerCase() === 'group'
      )
      .map((node) => node.id)
  )
}

function layoutContainerNodes(
  nodes: readonly WorkflowNode[],
  laidOutNodes: readonly LayoutNode[],
  containerGroupIds: ReadonlySet<string>
): LayoutNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const positions = new Map(
    laidOutNodes.map((node) => [node.id, { x: node.x, y: node.y }])
  )
  const isDescendant = (node: WorkflowNode, groupId: string): boolean => {
    let parentId = node.parentGroupId
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      if (parentId === groupId) return true
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentGroupId
    }
    return false
  }

  Array.from(containerGroupIds).forEach((groupId, groupIndex) => {
    const descendants = laidOutNodes.filter((node) =>
      isDescendant(node, groupId)
    )
    positions.set(groupId, descendants.length > 0
      ? {
          x: Math.min(...descendants.map((node) => node.x)) -
            GROUP_LABEL_GAP_X,
          y: Math.min(...descendants.map((node) => node.y))
        }
      : {
          x: ORIGIN_X - GROUP_LABEL_GAP_X,
          y: ORIGIN_Y + groupIndex * LAYER_GAP_Y
        })
  })

  return nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: ORIGIN_X, y: ORIGIN_Y }
    return { ...node, ...position }
  })
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

/**
 * 按布局策略更新 Canonical 修订版本的节点坐标并保留其它布局元数据。
 *
 * @param revision 当前 Canonical 工作流（Workflow）修订版本。
 * @param nodes 修订版本投影出的可见节点。
 * @param links 修订版本投影出的有效边。
 * @param strategy 用户选择的画布布局策略。
 * @param swimlaneDirection 物料泳道策略当前选中的流向。
 * @returns 带新节点坐标且不修改原对象的修订版本。
 */
export function beautifyWorkflowRevision(
  revision: WorkflowRevision,
  nodes: WorkflowNode[],
  links: WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
): WorkflowRevision {
  const layout = recordValue(revision.layout)
  const previousNodes = recordValue(layout.nodes)
  const nextNodes = { ...previousNodes }
  const result = strategy === 'material-swimlanes'
    ? layoutWorkflowMaterialSwimlanes(nodes, links, swimlaneDirection)
    : strategy === 'primary-sample-serpentine'
      ? layoutWorkflowPrimarySampleFlow(nodes, links)
      : layoutDag(nodes, links, { preserveExistingPositions: false })
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
  nodes.forEach((node) => {
    incoming.set(node.id, [])
  })
  edges.forEach((edge) => {
    incoming.get(edge.target)?.push(edge.source)
  })

  const layer = new Map<string, number>()
  const visiting = new Set<string>()

  // 使用显式栈处理深链，避免节点按逆拓扑顺序到达时耗尽浏览器调用栈。
  // 保持原有 DFS 顺序及环回边取 0 的只读容错语义。
  const resolve = (id: string): number => {
    const cached = layer.get(id)
    if (cached != null) return cached
    const stack = [{ id, next: 0, max: -1 }]
    visiting.add(id)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const preds = incoming.get(frame.id) ?? []
      if (frame.next < preds.length) {
        const predecessor = preds[frame.next]!
        const value = layer.get(predecessor)
        if (value !== undefined || visiting.has(predecessor)) {
          frame.max = Math.max(frame.max, value ?? 0)
          frame.next += 1
        } else {
          visiting.add(predecessor)
          stack.push({ id: predecessor, next: 0, max: -1 })
        }
      } else {
        layer.set(frame.id, frame.max + 1)
        visiting.delete(frame.id)
        stack.pop()
      }
    }
    return layer.get(id) ?? 0
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
