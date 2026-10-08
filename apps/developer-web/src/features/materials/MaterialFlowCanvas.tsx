import { cx } from './materialClassNames'
import { useMemo } from 'react'
import ReactFlow, { Background, Controls, type Node } from 'reactflow'
import 'reactflow/dist/style.css'
import { ResourceBlockNode, ResourceGroupNode } from './MaterialFlowNodes'
import {
  comparePosition,
  gridShape,
  isMaterialGraphNodeHidden,
  type GroupNodeData,
  type MaterialSelection,
  type ResourceNode,
  type SiteEntry,
} from './materialFlowModel'
import type { MaterialGraphNode } from '@unilab-fe/core'

const EMPTY_EDGE_TYPES = {}
const EMPTY_SEARCH_IDS = new Set<string>()

export function MaterialFlowCanvas({
  nodes,
  hasSearch = false,
  highlightedIds,
  selectedId,
  selectedSiteId,
  onSelect,
}: {
  nodes: readonly MaterialGraphNode[]
  hasSearch?: boolean
  highlightedIds?: ReadonlySet<string>
  selectedId?: string
  selectedSiteId?: string
  onSelect: (selection: MaterialSelection) => void
}) {
  const nodeTypes = useMemo(
    () => ({
      resourceGroup: ResourceGroupNode,
      resourceBlock: ResourceBlockNode,
    }),
    [],
  )
  const projected = useMemo(
    () =>
      projectResourceNodes(nodes, hasSearch, highlightedIds, selectedId, selectedSiteId, onSelect),
    [hasSearch, highlightedIds, nodes, onSelect, selectedId, selectedSiteId],
  )

  return (
    <section className={cx('material-flow-canvas')} aria-label="设备与库位关系图">
      <div className={cx('material-flow-canvas__legend')}>
        <span>
          <i className={cx('material-flow-dot material-flow-dot--device')} />
          设备 / 台面分组
        </span>
        <span>
          <i className={cx('material-flow-dot material-flow-dot--occupied')} />
          已占用库位
        </span>
        <span>
          <i className={cx('material-flow-dot material-flow-dot--empty')} />
          空库位
        </span>
        {hasSearch && (
          <span>
            <i className={cx('material-flow-dot material-flow-dot--match')} />
            搜索匹配
          </span>
        )}
        <span className={cx('material-flow-canvas__hint')}>
          拖动画布、滚轮缩放，点击节点、库位或物料查看详情
        </span>
      </div>
      <div className={cx('material-flow-canvas__surface')}>
        <ReactFlow
          nodes={projected}
          edges={[]}
          nodeTypes={nodeTypes}
          edgeTypes={EMPTY_EDGE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
          minZoom={0.15}
          maxZoom={1.8}
          nodesConnectable={false}
          nodesFocusable={false}
          elementsSelectable={false}
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="#dce3ef" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  )
}

function projectResourceNodes(
  nodes: readonly MaterialGraphNode[],
  hasSearch: boolean,
  highlightedIds: ReadonlySet<string> | undefined,
  selectedId: string | undefined,
  selectedSiteId: string | undefined,
  onSelect: (selection: MaterialSelection) => void,
): ResourceNode[] {
  const searchIds = highlightedIds ?? EMPTY_SEARCH_IDS
  const byId = new Map(nodes.map((node) => [node.material.materialUuid, node]))
  const occupantBySite = new Map<string, MaterialGraphNode['material']>()
  for (const node of nodes) {
    if (node.currentSiteUuid) occupantBySite.set(node.currentSiteUuid, node.material)
    for (const site of node.sites) {
      const occupant = site.occupancy.occupiedMaterialUuid
        ? byId.get(site.occupancy.occupiedMaterialUuid)
        : undefined
      if (occupant) occupantBySite.set(site.siteUuid, occupant.material)
    }
  }

  const roots = new Map<string, MaterialGraphNode>()
  for (const node of nodes) {
    const root = displayRootOf(node, byId)
    roots.set(root.material.materialUuid, root)
  }
  const groups = [...roots.values()].sort((a, b) => comparePosition(a, b))
  const result: ResourceNode[] = []
  const groupModels = groups
    .map((root) => {
      const descendants = nodes.filter(
        (node) => displayRootOf(node, byId).material.materialUuid === root.material.materialUuid,
      )
      const mountedChildren = descendants
        .filter(
          (node) =>
            node.material.materialUuid !== root.material.materialUuid && node.sites.length > 0,
        )
        .map((node) => ({ node, site: mountedSiteOf(node, root) }))
        .filter((item): item is { node: MaterialGraphNode; site: SiteEntry } => Boolean(item.site))
      const mountedSiteIds = new Set(mountedChildren.map((item) => item.site.siteUuid))
      const rootSites = root.sites.filter((site) => !mountedSiteIds.has(site.siteUuid))
      const blocks = mountedChildren.length
        ? [
            ...(rootSites.length
              ? [
                  {
                    node: root,
                    sites: rootSites,
                    label: root.material.name,
                    typeLabel: root.material.materialType ?? '资源',
                  },
                ]
              : []),
            ...mountedChildren.map(({ node, site }) => ({
              node,
              sites: node.sites,
              label: site.key || site.name,
              typeLabel: node.material.materialType ?? '资源',
            })),
          ].sort((left, right) => comparePosition(left.node, right.node))
        : descendants
            .filter((node) => node.sites.length > 0)
            .sort(comparePosition)
            .map((node) => ({
              node,
              sites: node.sites,
              label: isMaterialGraphNodeHidden(node) ? '可用库位' : node.material.name,
              typeLabel: isMaterialGraphNodeHidden(node)
                ? '库位'
                : (node.material.materialType ?? '资源'),
            }))
      const highlighted =
        hasSearch && descendants.some((node) => searchIds.has(node.material.materialUuid))
      const siteCount = mountedChildren.length
        ? root.sites.length + mountedChildren.reduce((sum, item) => sum + item.node.sites.length, 0)
        : blocks.reduce((sum, block) => sum + block.sites.length, 0)
      return { root, descendants, blocks, highlighted, siteCount }
    })
    .filter((group) => group.blocks.length > 0)
  const groupColumns = Math.min(3, Math.max(1, groupModels.length))
  const groupWidth = 630
  const groupGap = 44
  let rowY = 0
  const rowHeights: number[] = []

  groupModels.forEach(({ root, descendants, blocks, highlighted, siteCount }, index) => {
    const groupId = `material-group-${root.material.materialUuid}`
    const columns = Math.min(2, Math.max(1, blocks.length))
    const blockPositions = blocks.map((block, blockIndex) => {
      const shape = gridShape(block.sites)
      const blockGap = 14
      const horizontalPadding = 18
      const width = (groupWidth - horizontalPadding * 2 - blockGap * (columns - 1)) / columns
      const height = 74 + Math.ceil(block.sites.length / shape.columns) * 42
      return {
        block,
        width,
        height,
        x: horizontalPadding + (blockIndex % columns) * (width + blockGap),
        y: 62 + Math.floor(blockIndex / columns) * (height + 18),
      }
    })
    const groupHeight = Math.max(122, ...blockPositions.map((item) => item.y + item.height + 18))
    const column = index % groupColumns
    const row = Math.floor(index / groupColumns)
    if (column === 0) rowY = row === 0 ? 0 : rowY + (rowHeights[row - 1] ?? 0) + groupGap
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, groupHeight)
    const groupNode: Node<GroupNodeData, 'resourceGroup'> = {
      id: groupId,
      type: 'resourceGroup',
      position: { x: column * (groupWidth + groupGap), y: rowY },
      data: {
        name: root.material.name,
        kind: root.material.materialType ?? 'resource',
        selectionId: displaySelectionId(root, byId),
        selected: selectedId === displaySelectionId(root, byId),
        hasSearch,
        highlighted,
        materialCount: descendants.filter((node) => !isMaterialGraphNodeHidden(node)).length,
        siteCount,
        onSelect,
      },
      style: { width: groupWidth, height: groupHeight },
      selectable: true,
      draggable: false,
      zIndex: 0,
    }
    result.push(groupNode)
    blockPositions.forEach(({ block, width, height, x, y }) => {
      const { node } = block
      const highlightedBlock =
        hasSearch &&
        (searchIds.has(node.material.materialUuid) ||
          node.sites.some((site) => {
            const occupant = occupantBySite.get(site.siteUuid)
            return Boolean(occupant && searchIds.has(occupant.materialUuid))
          }))
      result.push({
        id: `material-block-${node.material.materialUuid}`,
        type: 'resourceBlock',
        parentNode: groupId,
        extent: 'parent',
        position: { x, y },
        data: {
          node,
          sites: node.sites,
          occupantBySite,
          selectedId,
          selectedSiteId,
          selectionId: displaySelectionId(node, byId),
          label: block.label,
          typeLabel: block.typeLabel,
          hasSearch,
          highlighted: highlightedBlock,
          highlightedIds: searchIds,
          onSelect,
        },
        style: { width, height },
        selectable: true,
        draggable: false,
        zIndex: 2,
      })
    })
  })
  return result
}

function mountedSiteOf(node: MaterialGraphNode, root: MaterialGraphNode): SiteEntry | undefined {
  return root.sites.find(
    (site) =>
      site.siteUuid === node.currentSiteUuid ||
      site.occupancy.occupiedMaterialUuid === node.material.materialUuid,
  )
}

function displayRootOf(
  node: MaterialGraphNode,
  byId: ReadonlyMap<string, MaterialGraphNode>,
): MaterialGraphNode {
  let current = node
  const visited = new Set<string>()
  while (
    current.material.parentMaterialUuid &&
    byId.has(current.material.parentMaterialUuid) &&
    !visited.has(current.material.materialUuid)
  ) {
    visited.add(current.material.materialUuid)
    const parent = byId.get(current.material.parentMaterialUuid)!
    if (isMaterialGraphNodeHidden(parent) && !isMaterialGraphNodeHidden(current)) break
    current = parent
  }
  return current
}

function displaySelectionId(
  node: MaterialGraphNode,
  byId: ReadonlyMap<string, MaterialGraphNode>,
): string {
  if (!isMaterialGraphNodeHidden(node)) return node.material.materialUuid
  const parent = node.material.parentMaterialUuid
    ? byId.get(node.material.parentMaterialUuid)
    : undefined
  return parent && !isMaterialGraphNodeHidden(parent)
    ? parent.material.materialUuid
    : node.material.materialUuid
}

export {
  isMaterialGraphNodeHidden,
  isMaterialSiteSelected,
  type MaterialSelection,
} from './materialFlowModel'
