import ELK from 'elkjs/lib/elk.bundled.js'

import type { WorkflowLink, WorkflowNode } from './parseWorkflow'
import {
  finalizeMaterialSourcePlacement,
  type LayoutNode,
  type LayoutResult
} from './dagLayout'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from './workflowDagLayoutStrategy'
import { layoutWorkflowMaterialSwimlanes } from './workflowMaterialSwimlaneLayout'
import { layoutWorkflowPrimarySampleFlow } from './workflowPrimarySampleLayout'

const elk = new ELK()

const ACTION_NODE_MIN_WIDTH = 248
const ACTION_NODE_MAX_WIDTH = 520
const ACTION_NODE_HEIGHT = 64
const MATERIAL_SOURCE_WIDTH = 184
const MATERIAL_SOURCE_HEIGHT = 126
const TRANSFER_NODE_WIDTH = 176
const TRANSFER_NODE_HEIGHT = 126
const SUBWORKFLOW_NODE_HEIGHT = 88
const NODE_GAP = 80
// Keep the async ELK projection aligned with the synchronous 140px layer
// pitch. A 96px gap made three-node workflows shrink below 80% in split IDE
// panes even though the cards themselves fit comfortably.
const LAYER_GAP = 72

interface SizedNode {
  node: WorkflowNode
  width: number
  height: number
}

/**
 * 使用与 Cloud 工作流缩略图相同的 ELK 分层策略排列当前全部可见节点。
 *
 * @param nodes 已完成组合工作流折叠投影的可见节点。
 * @param links 已完成端点重接的控制边与物料流（MaterialFlow）边。
 * @param strategy 当前选中的工作流（Workflow）画布布局策略。
 * @param swimlaneDirection 物料泳道策略当前选中的流向。
 * @returns 按选定方向、层内无重叠且保留所有有效边的布局结果。
 */
export async function layoutVisibleWorkflowDag(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
): Promise<LayoutResult> {
  if (strategy === 'material-swimlanes') {
    return layoutWorkflowMaterialSwimlanes(nodes, links, swimlaneDirection)
  }
  if (strategy === 'primary-sample-serpentine') {
    return layoutWorkflowPrimarySampleFlow(nodes, links)
  }
  if (nodes.length === 0) {
    return { nodes: [], links: [], direction: swimlaneDirection }
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const visibleLinks = links.filter((link) =>
    nodeIds.has(link.source) && nodeIds.has(link.target)
  )
  const sizedNodes = nodes.map(sizeWorkflowNode)
  const result = await elk.layout({
    id: 'workflow-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': swimlaneDirection === 'horizontal' ? 'RIGHT' : 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(NODE_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
      'elk.layered.nodePlacement.strategy': 'LINEAR_SEGMENTS',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(NODE_GAP)
    },
    children: sizedNodes.map(({ node, width, height }) => ({
      id: node.id,
      width,
      height,
      ports: (node.handles ?? []).map((handle, index) => ({
        id: handle.uuid,
        layoutOptions: {
          'port.side': swimlaneDirection === 'horizontal'
            ? (handle.ioType === 'source' ? 'EAST' : 'WEST')
            : (handle.ioType === 'source' ? 'SOUTH' : 'NORTH'),
          'port.index': String(index)
        }
      }))
    })),
    edges: visibleLinks.map((link, index) => ({
      id: `workflow-edge-${index}`,
      sources: [link.source],
      targets: [link.target]
    }))
  })

  const elkPositionById = new Map(
    (result.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 }
    ])
  )
  return {
    nodes: swimlaneDirection === 'horizontal'
      ? nodes.map(node => ({ ...node, ...elkPositionById.get(node.id)! }))
      : alignVisibleWorkflowLayers(sizedNodes, visibleLinks, elkPositionById),
    links: visibleLinks,
    direction: swimlaneDirection
  }
}

/**
 * 将 ELK 的交叉最小化顺序对齐到严格的水平层，并按真实估算宽度消除碰撞。
 *
 * @param nodes 带估算尺寸的全部可见节点。
 * @param links 共同参与分层的控制边与物料流（MaterialFlow）边。
 * @param elkPositions ELK 给出的稳定层内顺序坐标。
 * @returns 横平竖直且任意同层节点互不重叠的工作流节点。
 */
function alignVisibleWorkflowLayers(
  nodes: readonly SizedNode[],
  links: readonly WorkflowLink[],
  elkPositions: ReadonlyMap<string, { x: number; y: number }>
): LayoutNode[] {
  const layerById = workflowLayers(nodes.map(({ node }) => node), links)
  const layers = new Map<number, SizedNode[]>()
  for (const sizedNode of nodes) {
    const layer = layerById.get(sizedNode.node.id) ?? 0
    layers.set(layer, [...(layers.get(layer) ?? []), sizedNode])
  }

  const positionById = new Map<string, { x: number; y: number }>()
  let y = 40
  for (const [, layerNodes] of [...layers.entries()].sort(
    ([left], [right]) => left - right
  )) {
    const ordered = [...layerNodes].sort((left, right) => {
      const delta = (elkPositions.get(left.node.id)?.x ?? 0) -
        (elkPositions.get(right.node.id)?.x ?? 0)
      return delta || left.node.id.localeCompare(right.node.id)
    })
    const rowWidth = ordered.reduce(
      (total, item, index) => total + item.width + (index > 0 ? NODE_GAP : 0),
      0
    )
    let x = 180 - rowWidth / 2
    for (const item of ordered) {
      positionById.set(item.node.id, { x, y })
      x += item.width + NODE_GAP
    }
    y += Math.max(...ordered.map((item) => item.height)) + LAYER_GAP
  }

  const layeredNodes = nodes.map(({ node }) => ({
    ...node,
    ...(positionById.get(node.id) ?? { x: 180, y: 40 })
  }))
  return finalizeMaterialSourcePlacement(layeredNodes, links)
}

/**
 * 按全部可见边计算最长路径层级；循环边由稳定的根层回退消解。
 *
 * @param nodes 当前全部可见节点。
 * @param links 当前全部可见边。
 * @returns 节点 UUID 到纵向层号的映射。
 */
function workflowLayers(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[]
): Map<string, number> {
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const link of links) incoming.get(link.target)?.push(link.source)
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (nodeId: string): number => {
    const cached = layers.get(nodeId)
    if (cached !== undefined) return cached
    if (visiting.has(nodeId)) return 0
    visiting.add(nodeId)
    const predecessors = incoming.get(nodeId) ?? []
    const layer = predecessors.length === 0
      ? 0
      : Math.max(...predecessors.map(resolve)) + 1
    visiting.delete(nodeId)
    layers.set(nodeId, layer)
    return layer
  }
  nodes.forEach((node) => resolve(node.id))
  return layers
}

/**
 * 按节点类型与物料变量数量估算 ReactFlow 占位尺寸。
 *
 * @param node 当前可见工作流节点。
 * @returns 供 ELK 和层内碰撞检测使用的稳定尺寸。
 */
function sizeWorkflowNode(node: WorkflowNode): SizedNode {
  if (node.type === 'material_source') {
    return { node, width: MATERIAL_SOURCE_WIDTH, height: MATERIAL_SOURCE_HEIGHT }
  }
  if (node.visualKind === 'robot-transfer') {
    return { node, width: TRANSFER_NODE_WIDTH, height: TRANSFER_NODE_HEIGHT }
  }
  const materialVariables = new Set(
    (node.handles ?? [])
      .filter((handle) => handle.valueType === 'ResourceSlot')
      .map((handle) => handle.dataKey?.trim() || handle.handleKey)
  ).size
  return {
    node,
    width: Math.min(
      ACTION_NODE_MAX_WIDTH,
      Math.max(ACTION_NODE_MIN_WIDTH, 170 + materialVariables * 78)
    ),
    height: node.groupKind === 'subworkflow'
      ? SUBWORKFLOW_NODE_HEIGHT
      : ACTION_NODE_HEIGHT
  }
}
