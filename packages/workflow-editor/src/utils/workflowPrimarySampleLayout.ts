import type {
  LayoutResult,
  WorkflowNodePortLayout
} from './dagLayout'
import type { WorkflowLink, WorkflowNode } from './parseWorkflow'
import {
  isResourceSlotHandle,
  projectMaterialTraces
} from './workflowMaterialTrace'
import {
  packWorkflowSupportingBranches,
  routeWorkflowTransferPorts,
  type WorkflowSupportingBranch,
  workflowEdgeDirectionForPorts,
  workflowBackboneColumnForIndex,
  WORKFLOW_SUPPORTING_BRANCH_NODE_GAP
} from './workflowPrimarySampleBranchLayout'
import type {
  WorkflowSupportingMaterialPresentation
} from './workflowReactionMaterialProjection'

export const WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW = 4
export const WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP = 328
export const WORKFLOW_PRIMARY_SAMPLE_MIN_ROW_GAP = 300

const ORIGIN_X = 72
const ORIGIN_Y = 72
const SUPPORTING_BRANCH_VERTICAL_GAP = 44
const ROW_CLEARANCE = 112
const COMPACT_NODE_BASE_HEIGHT = 48
const COMPACT_MATERIAL_CARD_HEIGHT = 33
const SPECIAL_NODE_HEIGHT = 126
const COMPACT_ACTION_NODE_WIDTH = 184
const HORIZONTAL_MATERIAL_SOURCE_WIDTH = 112
const HORIZONTAL_TRANSFER_NODE_WIDTH = 120
const PRIMARY_SAMPLE_ACTION_FIRST_HANDLE_AXIS = 63
const PRIMARY_SAMPLE_ACTION_HANDLE_PITCH = 31
const PRIMARY_SAMPLE_MATERIAL_SOURCE_HANDLE_AXIS = 92
const PRIMARY_SAMPLE_TRANSFER_HANDLE_AXIS = 90

export interface WorkflowPrimarySampleLayoutOptions {
  supportingMaterialPresentation?: WorkflowSupportingMaterialPresentation
}

/**
 * 以主样品物料流角色（MaterialFlowRole）的第一条物料链为主干生成蛇形布局。
 *
 * 主干每行最多放置四个节点，奇数行反向排列；其它物料（Material）支线按
 * 最近主干节点归入同一行的辅助区。返回结果只改变前端画布投影坐标与端口方向，
 * 不修改权威工作流图（Workflow Graph）或其执行顺序。
 *
 * @param nodes 已完成组合工作流折叠与物料可见性投影的节点。
 * @param links 端点均可能出现在当前投影中的控制边与物料边。
 * @param options 辅助物料使用反应式标注或完整支线的布局选项。
 * @returns 包含蛇形坐标、逐节点端口方向和主样品主干目录的布局结果。
 */
export function layoutWorkflowPrimarySampleFlow(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[],
  options: WorkflowPrimarySampleLayoutOptions = {}
): LayoutResult {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const visibleLinks = links.filter((link) =>
    nodeIds.has(link.source) && nodeIds.has(link.target)
  )
  if (nodes.length === 0) {
    return {
      nodes: [],
      links: visibleLinks,
      direction: 'horizontal',
      primarySample: {
        hasPrimarySample: false,
        backboneNodeIds: [],
        rowByNode: new Map()
      }
    }
  }

  const traces = projectMaterialTraces(nodes, visibleLinks)
  const primaryLineage = traces.lineages.find(
    (lineage) => lineage.materialRole === 'primary_sample'
  )
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]))
  const layerByNode = workflowLayers(nodes, visibleLinks)
  const backboneNodeIds = primaryLineage
    ? primaryLineageNodeIds(
        nodes,
        visibleLinks,
        traces,
        primaryLineage.key,
        layerByNode,
        nodeOrder
      )
    : [...nodes]
        .sort((left, right) =>
          (layerByNode.get(left.id) ?? 0) -
            (layerByNode.get(right.id) ?? 0) ||
          (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
        )
        .map((node) => node.id)
  const backboneIndexes = new Map(
    backboneNodeIds.map((nodeId, index) => [nodeId, index])
  )
  const supportingSourceAnchors = primarySupportingSourceAnchors(
    nodes,
    visibleLinks,
    backboneIndexes
  )
  const rowByNode = new Map<string, number>()
  const expandedDescendantBranchesByRow =
    groupExpandedBackboneDescendantsByRow(
      nodes,
      backboneIndexes,
      layerByNode,
      nodeOrder
    )
  const expandedDescendantIds = new Set(
    [...expandedDescendantBranchesByRow.values()]
      .flat()
      .flatMap((branch) => branch.nodes.map((node) => node.id))
  )
  const secondaryBranchesByRow = groupSecondaryBranchesByBackboneRow(
    nodes,
    visibleLinks,
    traces,
    backboneIndexes,
    layerByNode,
    nodeOrder,
    expandedDescendantIds
  )
  const showSupportingBranches =
    options.supportingMaterialPresentation !== 'reaction-formula'
  const rowCount = Math.max(
    1,
    Math.ceil(backboneNodeIds.length / WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW)
  )
  const positionByNode = new Map<string, { x: number; y: number }>()
  const nodePorts = new Map<string, WorkflowNodePortLayout>()
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  let mainRowY = ORIGIN_Y
  let previousRowEndX = ORIGIN_X

  for (let row = 0; row < rowCount; row += 1) {
    const rowStart = row * WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    const rowNodeIds = backboneNodeIds.slice(
      rowStart,
      rowStart + WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    )
    const primaryHandleAxes = new Map(rowNodeIds.map((nodeId) => [
      nodeId,
      primarySampleHandleAxis(
        nodeById.get(nodeId),
        traces
      )
    ]))
    const rowHandleAxis = Math.max(...primaryHandleAxes.values())
    const mainRowHeight = Math.max(
      SPECIAL_NODE_HEIGHT,
      ...rowNodeIds.map((nodeId) =>
        rowHandleAxis - (primaryHandleAxes.get(nodeId) ?? rowHandleAxis) +
          estimatedHorizontalNodeHeight(nodeById.get(nodeId))
      )
    )
    const flowSign = row % 2 === 0 ? 1 : -1
    let rowX = row === 0 ? ORIGIN_X : previousRowEndX
    for (const [rowIndex, nodeId] of rowNodeIds.entries()) {
      positionByNode.set(nodeId, {
        x: rowX,
        y: 0
      })
      rowByNode.set(nodeId, row)
      const absoluteIndex = rowStart + rowIndex
      nodePorts.set(nodeId, backboneHorizontalPortLayout(absoluteIndex))
      const nextNodeId = rowNodeIds[rowIndex + 1]
      if (nextNodeId) {
        rowX += flowSign * primarySampleNodeGap(
          nodeById.get(nodeId),
          nodeById.get(nextNodeId)
        )
      }
    }
    previousRowEndX = rowX

    const secondaryBands = showSupportingBranches
      ? packWorkflowSupportingBranches(
          (secondaryBranchesByRow.get(row) ?? []).map((branch) => ({
            ...branch,
            anchorX: positionByNode.get(
              backboneNodeIds[branch.anchorIndex] ?? ''
            )?.x
          })),
          ORIGIN_X,
          WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP,
          WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
        )
      : []
    const expandedDescendantBands = packWorkflowSupportingBranches(
      (expandedDescendantBranchesByRow.get(row) ?? []).map((branch) => ({
        ...branch,
        anchorX: positionByNode.get(
          backboneNodeIds[branch.anchorIndex] ?? ''
        )?.x
      })),
      ORIGIN_X,
      WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP,
      WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    )
    const auxiliaryBands = [
      ...secondaryBands,
      ...expandedDescendantBands
    ]
    let occupiedBottom = mainRowY
    for (const branchNodes of auxiliaryBands) {
      const branchY = occupiedBottom
      const branchHeight = Math.max(
        SPECIAL_NODE_HEIGHT,
        ...branchNodes.map(({ node }) => estimatedHorizontalNodeHeight(node))
      )
      for (const { node, x, ports } of branchNodes) {
        positionByNode.set(node.id, {
          x,
          y: branchY
        })
        rowByNode.set(node.id, row)
        nodePorts.set(node.id, ports)
      }
      occupiedBottom = branchY + branchHeight + SUPPORTING_BRANCH_VERTICAL_GAP
    }
    const resolvedMainRowY = auxiliaryBands.length > 0
      ? occupiedBottom
      : mainRowY
    for (const nodeId of rowNodeIds) {
      const current = positionByNode.get(nodeId)
      if (current) {
        positionByNode.set(nodeId, {
          ...current,
          y: resolvedMainRowY + rowHandleAxis -
            (primaryHandleAxes.get(nodeId) ?? rowHandleAxis)
        })
      }
    }
    mainRowY = resolvedMainRowY + Math.max(
      WORKFLOW_PRIMARY_SAMPLE_MIN_ROW_GAP,
      mainRowHeight + ROW_CLEARANCE
    )
  }

  placePrimarySupportingSources(
    positionByNode,
    nodePorts,
    nodeById,
    backboneIndexes,
    supportingSourceAnchors
  )
  routeWorkflowTransferPorts(
    nodes,
    visibleLinks,
    positionByNode,
    nodePorts
  )

  const edgeDirections = new Map<number, 'TB' | 'LR'>()
  visibleLinks.forEach((link, index) => {
    edgeDirections.set(
      index,
      workflowEdgeDirectionForPorts(link, nodePorts)
    )
  })

  return {
    nodes: nodes.map((node) => ({
      ...node,
      ...(positionByNode.get(node.id) ?? { x: ORIGIN_X, y: ORIGIN_Y })
    })),
    links: visibleLinks,
    direction: 'horizontal',
    nodePorts,
    edgeDirections,
    primarySample: {
      hasPrimarySample: Boolean(primaryLineage),
      backboneNodeIds,
      rowByNode
    }
  }
}

/**
 * 将当前已展开、且锚定在主样品主干组合节点内的后代组织为局部布局带。
 *
 * 折叠投影不会包含这些后代，因此这里无需读取交互状态；只根据当前可见节点
 * 与组合边界的后代目录布局。后代仍按真实依赖层与作者顺序排列，并复用辅助
 * 支线的端口路由，使内部边获得非退化的正交主轴。
 */
function groupExpandedBackboneDescendantsByRow(
  nodes: readonly WorkflowNode[],
  backboneIndexes: ReadonlyMap<string, number>,
  layerByNode: ReadonlyMap<string, number>,
  nodeOrder: ReadonlyMap<string, number>
): Map<number, WorkflowSupportingBranch[]> {
  const visibleNodeIds = new Set(nodes.map((node) => node.id))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const assignedDescendants = new Set<string>()
  const groups = nodes
    .filter((node) =>
      node.groupKind === 'subworkflow' && backboneIndexes.has(node.id)
    )
    .sort((left, right) =>
      (left.descendantNodeIds?.length ?? 0) -
        (right.descendantNodeIds?.length ?? 0) ||
      (backboneIndexes.get(left.id) ?? 0) -
        (backboneIndexes.get(right.id) ?? 0)
    )
  const assigned = new Map<number, WorkflowSupportingBranch[]>()

  for (const group of groups) {
    const anchorIndex = backboneIndexes.get(group.id)
    if (anchorIndex === undefined) continue
    const descendants = (group.descendantNodeIds ?? [])
      .filter((nodeId) =>
        visibleNodeIds.has(nodeId) &&
        !backboneIndexes.has(nodeId) &&
        !assignedDescendants.has(nodeId)
      )
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is WorkflowNode => Boolean(node))
      .sort((left, right) =>
        (layerByNode.get(left.id) ?? 0) -
          (layerByNode.get(right.id) ?? 0) ||
        (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
      )
    if (descendants.length === 0) continue
    descendants.forEach((node) => assignedDescendants.add(node.id))
    const row = Math.floor(
      anchorIndex / WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    )
    assigned.set(row, [
      ...(assigned.get(row) ?? []),
      {
        nodes: descendants,
        anchorIndex,
        anchorColumn: workflowBackboneColumnForIndex(
          anchorIndex,
          WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
        ),
        order: Math.min(...descendants.map(
          (node) => nodeOrder.get(node.id) ?? Number.MAX_SAFE_INTEGER
        )),
        flowDirection: 'into-primary',
        anchorVisualKind: group.visualKind
      }
    ])
  }

  return assigned
}

/**
 * 提取第一条主样品物料链覆盖的节点并按拓扑层稳定排序。
 *
 * @param nodes 当前可见工作流节点。
 * @param links 当前可见工作流边。
 * @param traces 物料流追踪投影。
 * @param lineageKey 主样品物料链的稳定键。
 * @param layerByNode 节点到最长路径层号的映射。
 * @param nodeOrder 节点在权威图投影中的声明顺序。
 * @returns 主样品物料链上的有序节点 UUID。
 */
function primaryLineageNodeIds(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[],
  traces: ReturnType<typeof projectMaterialTraces>,
  lineageKey: string,
  layerByNode: ReadonlyMap<string, number>,
  nodeOrder: ReadonlyMap<string, number>
): string[] {
  const primaryNodeIds = new Set<string>()
  const lineage = traces.lineages.find((item) => item.key === lineageKey)
  if (lineage) primaryNodeIds.add(lineage.sourceNodeUuid)
  for (const [nodeId, handles] of traces.handleLineagesByNode) {
    if ([...handles.values()].includes(lineageKey)) primaryNodeIds.add(nodeId)
  }
  links.forEach((link, index) => {
    if (traces.edgeLineages.get(index) !== lineageKey) return
    primaryNodeIds.add(link.source)
    primaryNodeIds.add(link.target)
  })
  return nodes
    .filter((node) => primaryNodeIds.has(node.id))
    .sort((left, right) =>
      (layerByNode.get(left.id) ?? 0) - (layerByNode.get(right.id) ?? 0) ||
      (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
    )
    .map((node) => node.id)
}

/**
 * 将移除主样品主干后仍相连的节点收束为局部辅助物料支线。
 *
 * @param nodes 当前可见工作流节点。
 * @param links 当前可见工作流边。
 * @param traces 当前物料流追踪投影。
 * @param backboneIndexes 主干节点到序号的映射。
 * @param layerByNode 节点到拓扑层号的映射。
 * @param nodeOrder 节点声明顺序。
 * @returns 按蛇形行号分组且稳定排序的辅助物料支线。
 */
function groupSecondaryBranchesByBackboneRow(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[],
  traces: ReturnType<typeof projectMaterialTraces>,
  backboneIndexes: ReadonlyMap<string, number>,
  layerByNode: ReadonlyMap<string, number>,
  nodeOrder: ReadonlyMap<string, number>,
  excludedNodeIds: ReadonlySet<string> = new Set()
): Map<number, WorkflowSupportingBranch[]> {
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]))
  links.forEach((link, index) => {
    // 只用物料边构造支线，避免纯执行依赖把互不相关的试剂链粘成一条长支线。
    if (!traces.edgeLineages.has(index)) return
    adjacency.get(link.source)?.push(link.target)
    adjacency.get(link.target)?.push(link.source)
  })
  const secondaryNodeIds = new Set(
    nodes
      .filter((node) =>
        !backboneIndexes.has(node.id) && !excludedNodeIds.has(node.id)
      )
      .map((node) => node.id)
  )
  const visited = new Set<string>()
  const assigned = new Map<number, WorkflowSupportingBranch[]>()
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const backboneNodeByIndex = new Map(
    [...backboneIndexes].map(([nodeId, index]) => [index, nodeById.get(nodeId)])
  )

  for (const startNodeId of secondaryNodeIds) {
    if (visited.has(startNodeId)) continue
    const componentIds = connectedSecondaryNodeIds(
      startNodeId,
      adjacency,
      secondaryNodeIds,
      visited
    )
    const componentNodes = nodes
      .filter((node) => componentIds.has(node.id))
      .sort((left, right) =>
        (layerByNode.get(left.id) ?? 0) -
          (layerByNode.get(right.id) ?? 0) ||
        (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
      )
    const attachment = branchBackboneAttachment(
      componentIds,
      links,
      adjacency,
      backboneIndexes
    )
    const row = Math.floor(
      attachment.anchorIndex / WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    )
    assigned.set(row, [
      ...(assigned.get(row) ?? []),
      {
        nodes: componentNodes,
        anchorIndex: attachment.anchorIndex,
        anchorColumn: workflowBackboneColumnForIndex(
          attachment.anchorIndex,
          WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
        ),
        order: Math.min(...componentNodes.map(
          (node) => nodeOrder.get(node.id) ?? Number.MAX_SAFE_INTEGER
        )),
        flowDirection: attachment.flowDirection,
        anchorVisualKind:
          backboneNodeByIndex.get(attachment.anchorIndex)?.visualKind
      }
    ])
  }
  return new Map([...assigned].map(([row, entries]) => [
    row,
    entries
      .sort((left, right) =>
        left.anchorColumn - right.anchorColumn ||
        left.anchorIndex - right.anchorIndex ||
        left.order - right.order
      )
  ]))
}

/**
 * 找出不穿过主样品主干的辅助节点连通分量。
 *
 * @param startNodeId 当前分量的起始节点 UUID。
 * @param adjacency 当前可见图的无向邻接表。
 * @param secondaryNodeIds 全部非主干节点 UUID。
 * @param visited 已归入其它辅助物料支线的节点 UUID。
 * @returns 当前局部支线覆盖的节点 UUID。
 */
function connectedSecondaryNodeIds(
  startNodeId: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  secondaryNodeIds: ReadonlySet<string>,
  visited: Set<string>
): Set<string> {
  const component = new Set<string>()
  const pending = [startNodeId]
  visited.add(startNodeId)
  while (pending.length > 0) {
    const nodeId = pending.shift()
    if (!nodeId) continue
    component.add(nodeId)
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!secondaryNodeIds.has(neighbor) || visited.has(neighbor)) continue
      visited.add(neighbor)
      pending.push(neighbor)
    }
  }
  return component
}

/**
 * 确定一条辅助物料支线应贴近的主样品节点。
 *
 * 优先采用从辅助支线汇入主干的有向边；若图中没有直接汇入边，则回退到
 * 无向图距离最近的主干节点，保持异常或不完整投影仍可布局。
 *
 * @param componentIds 当前辅助物料支线节点 UUID。
 * @param links 当前可见工作流边。
 * @param adjacency 当前可见图的无向邻接表。
 * @param backboneIndexes 主干节点到序号的映射。
 * @returns 支线接入的主干序号及物料相对主干的流向。
 */
function branchBackboneAttachment(
  componentIds: ReadonlySet<string>,
  links: readonly WorkflowLink[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  backboneIndexes: ReadonlyMap<string, number>
): {
  anchorIndex: number
  flowDirection: WorkflowSupportingBranch['flowDirection']
} {
  const directJoinIndexes = links
    .filter((link) =>
      componentIds.has(link.source) && backboneIndexes.has(link.target)
    )
    .map((link) => backboneIndexes.get(link.target))
    .filter((index): index is number => index !== undefined)
  if (directJoinIndexes.length > 0) return {
    anchorIndex: Math.min(...directJoinIndexes),
    flowDirection: 'into-primary'
  }

  const directDepartureIndexes = links
    .filter((link) =>
      backboneIndexes.has(link.source) && componentIds.has(link.target)
    )
    .map((link) => backboneIndexes.get(link.source))
    .filter((index): index is number => index !== undefined)
  if (directDepartureIndexes.length > 0) return {
    anchorIndex: Math.min(...directDepartureIndexes),
    flowDirection: 'out-of-primary'
  }

  let fallback = Number.POSITIVE_INFINITY
  for (const nodeId of componentIds) {
    fallback = Math.min(
      fallback,
      nearestBackboneIndex(nodeId, adjacency, backboneIndexes)
    )
  }
  return {
    anchorIndex: Number.isFinite(fallback) ? fallback : 0,
    flowDirection: 'into-primary'
  }
}

/**
 * 在无向工作流邻接表中查找距离给定节点最近的主样品主干序号。
 *
 * @param startNodeId 待安置辅助节点 UUID。
 * @param adjacency 当前可见图的无向邻接表。
 * @param backboneIndexes 主干节点到序号的映射。
 * @returns 最近主干序号；断开的辅助节点回退到第一行。
 */
function nearestBackboneIndex(
  startNodeId: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
  backboneIndexes: ReadonlyMap<string, number>
): number {
  const visited = new Set([startNodeId])
  let frontier = [startNodeId]
  while (frontier.length > 0) {
    const matches = frontier
      .map((nodeId) => backboneIndexes.get(nodeId))
      .filter((index): index is number => index !== undefined)
    if (matches.length > 0) return Math.min(...matches)
    const next: string[] = []
    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return 0
}

/**
 * 按全部有向依赖找出每个辅助 MaterialSource 最早抵达的主样品节点。
 *
 * 完整支线可能先用 ready/control 依赖接入当前主线动作，随后才把物料送入
 * 下一条蛇形主线。若这里只沿物料边查找，会把 MaterialSource 单独拉到后一个
 * 主线节点，造成支路在画布上往返交叉。
 */
function primarySupportingSourceAnchors(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[],
  backboneIndexes: ReadonlyMap<string, number>
): Map<string, number> {
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  links.forEach((link) => {
    outgoing.get(link.source)?.push(link.target)
  })
  const anchors = new Map<string, number>()
  for (const source of nodes) {
    if (source.type !== 'material_source' || backboneIndexes.has(source.id)) {
      continue
    }
    const anchor = earliestPrimaryDescendantIndex(
      source.id,
      outgoing,
      backboneIndexes
    )
    if (anchor !== undefined) anchors.set(source.id, anchor)
  }
  return anchors
}

/** 遍历有向依赖图，返回辅助来源可达的最早主样品序号。 */
function earliestPrimaryDescendantIndex(
  sourceNodeId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  backboneIndexes: ReadonlyMap<string, number>
): number | undefined {
  const visited = new Set([sourceNodeId])
  const pending = [...(outgoing.get(sourceNodeId) ?? [])]
  let earliest: number | undefined
  while (pending.length > 0) {
    const nodeId = pending.shift()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)
    const backboneIndex = backboneIndexes.get(nodeId)
    if (backboneIndex !== undefined) {
      earliest = Math.min(earliest ?? backboneIndex, backboneIndex)
    }
    pending.push(...(outgoing.get(nodeId) ?? []))
  }
  return earliest
}

/**
 * 对完整支线做最终校正：每个辅助来源都位于自己最终接入主线节点的上方前侧。
 */
function placePrimarySupportingSources(
  positionByNode: Map<string, { x: number; y: number }>,
  nodePorts: Map<string, WorkflowNodePortLayout>,
  nodeById: ReadonlyMap<string, WorkflowNode>,
  backboneIndexes: ReadonlyMap<string, number>,
  anchors: ReadonlyMap<string, number>
): void {
  const backboneIdByIndex = new Map(
    [...backboneIndexes].map(([nodeId, index]) => [index, nodeId])
  )

  for (const [sourceId, anchorIndex] of anchors) {
    const sourcePosition = positionByNode.get(sourceId)
    const anchorId = backboneIdByIndex.get(anchorIndex)
    const anchorPosition = anchorId ? positionByNode.get(anchorId) : undefined
    if (!sourcePosition || !anchorPosition) continue
    const flowRunsEast = Math.floor(
      anchorIndex / WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
    ) % 2 === 0
    const anchorNode = anchorId ? nodeById.get(anchorId) : undefined
    const frontGap = anchorNode?.visualKind === 'robot-transfer'
      ? (WORKFLOW_SUPPORTING_BRANCH_NODE_GAP +
          HORIZONTAL_MATERIAL_SOURCE_WIDTH) / 2
      : WORKFLOW_SUPPORTING_BRANCH_NODE_GAP
    positionByNode.set(sourceId, {
      x: flowRunsEast
        ? Math.min(sourcePosition.x, anchorPosition.x - frontGap)
        : Math.max(sourcePosition.x, anchorPosition.x + frontGap),
      y: Math.min(
        sourcePosition.y,
        anchorPosition.y - SPECIAL_NODE_HEIGHT -
          SUPPORTING_BRANCH_VERTICAL_GAP
      )
    })
    nodePorts.set(sourceId, flowRunsEast
      ? { target: 'left', source: 'right' }
      : { target: 'right', source: 'left' })
  }
}

/**
 * 估算横向紧凑节点内主样品 Handle 距节点顶边的轴线。
 *
 * 动作节点的物料卡片保持作者字段顺序；每增加一个位于主样品之前的物料卡片，
 * 主样品轴线向下移动一个卡片节距。MaterialSource 与机械臂使用各自特殊视觉
 * 的固定轴线。布局只使用相对差值，因此能让同一蛇形行保持严格水平。
 */
function primarySampleHandleAxis(
  node: WorkflowNode | undefined,
  traces: ReturnType<typeof projectMaterialTraces>
): number {
  if (node?.type === 'material_source') {
    return PRIMARY_SAMPLE_MATERIAL_SOURCE_HANDLE_AXIS
  }
  if (node?.visualKind === 'robot-transfer') {
    return PRIMARY_SAMPLE_TRANSFER_HANDLE_AXIS
  }
  if (!node) {
    return PRIMARY_SAMPLE_ACTION_FIRST_HANDLE_AXIS
  }

  const accentByHandle = traces.handleAccentsByNode.get(node.id)
  const roleByHandle = traces.handleRolesByNode.get(node.id)
  const accentByVariable = new Map<string, string>()
  const roleByVariable = new Map<string, string>()
  const resourceHandles = node.handles?.filter(isResourceSlotHandle) ?? []
  for (const handle of resourceHandles) {
    const variableName = handle.dataKey?.trim() || handle.handleKey
    const accent = accentByHandle?.get(handle.uuid)
    if (accent && (
      !accentByVariable.has(variableName) || handle.ioType === 'target'
    )) accentByVariable.set(variableName, accent)
    const role = roleByHandle?.get(handle.uuid)
    if (role && (
      !roleByVariable.has(variableName) || handle.ioType === 'target'
    )) roleByVariable.set(variableName, role)
  }
  const cards: Array<{
    variableName: string
    target: boolean
    source: boolean
    primary: boolean
  }> = []
  for (const handle of resourceHandles) {
    const variableName = handle.dataKey?.trim() || handle.handleKey
    const accent = accentByHandle?.get(handle.uuid) ??
      accentByVariable.get(variableName)
    if (!accent) continue
    const slot = handle.ioType === 'target' ? 'target' : 'source'
    const existing = cards.find((card) =>
      card.variableName === variableName && !card[slot]
    )
    const primary = (
      roleByHandle?.get(handle.uuid) ?? roleByVariable.get(variableName)
    ) === 'primary_sample'
    if (existing) {
      existing[slot] = true
      existing.primary ||= primary
    } else {
      cards.push({
        variableName,
        target: slot === 'target',
        source: slot === 'source',
        primary
      })
    }
  }
  const primaryCardIndex = Math.max(
    0,
    cards.findIndex((card) => card.primary)
  )
  return PRIMARY_SAMPLE_ACTION_FIRST_HANDLE_AXIS +
    primaryCardIndex * PRIMARY_SAMPLE_ACTION_HANDLE_PITCH
}

/**
 * 返回横向主样品蛇形路径中一个节点的输入、输出端口方向。
 *
 * @param nodeIndex 节点在主样品主干中的零基序号。
 * @returns 偶数行由西向东、奇数行由东向西的端口布局。
 */
function backboneHorizontalPortLayout(
  nodeIndex: number
): WorkflowNodePortLayout {
  const row = Math.floor(
    nodeIndex / WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
  )
  const leftToRight = row % 2 === 0
  return {
    target: leftToRight ? 'left' : 'right',
    source: leftToRight ? 'right' : 'left'
  }
}

/** 只要相邻一端为机械臂转运节点，就把该段主干间距压缩为普通列距的一半。 */
function primarySampleNodeGap(
  left: WorkflowNode | undefined,
  right: WorkflowNode | undefined
): number {
  return left?.visualKind === 'robot-transfer' ||
    right?.visualKind === 'robot-transfer'
    ? (WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP +
        estimatedHorizontalNodeWidth(left)) / 2
    : WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP
}

/** 返回主样品蛇形节点用于计算相邻可见空白的紧凑宽度。 */
function estimatedHorizontalNodeWidth(node: WorkflowNode | undefined): number {
  if (node?.visualKind === 'robot-transfer') {
    return HORIZONTAL_TRANSFER_NODE_WIDTH
  }
  if (node?.type === 'material_source') {
    return HORIZONTAL_MATERIAL_SOURCE_WIDTH
  }
  return COMPACT_ACTION_NODE_WIDTH
}

/**
 * 估算横向节点在物料名称卡片纵向堆叠后的占用高度。
 *
 * 该估算只用于为下一辅助行预留空间；ReactFlow 仍以真实 DOM 测量作为
 * 连线锚点权威。物料来源（MaterialSource）和标准转运节点保持专用视觉高度。
 *
 * @param node 当前工作流（Workflow）节点；缺失时按专用节点最低高度处理。
 * @returns 画布布局应为该节点预留的像素高度。
 */
function estimatedHorizontalNodeHeight(
  node: WorkflowNode | undefined
): number {
  if (!node || node.type === 'material_source' ||
    node.visualKind === 'robot-transfer') return SPECIAL_NODE_HEIGHT
  // `materialVariableKeys` 是节点内需要独立展示的物料占位符逻辑字段集合。
  const materialVariableKeys = new Set(
    (node.handles ?? [])
      .filter(isResourceSlotHandle)
      .map((handle) => handle.dataKey?.trim() || handle.handleKey)
  )
  return COMPACT_NODE_BASE_HEIGHT +
    Math.max(1, materialVariableKeys.size) * COMPACT_MATERIAL_CARD_HEIGHT
}

/**
 * 按全部可见边计算稳定的最长路径层号。
 *
 * @param nodes 当前可见工作流节点。
 * @param links 当前可见工作流边。
 * @returns 节点 UUID 到拓扑层号的映射；循环依赖回退到根层。
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
