import { cx } from '../../styles/styleMaps'
import { useMemo } from 'react'
import ReactFlow, { Background, Controls, type Node, type NodeProps } from 'reactflow'
import 'reactflow/dist/style.css'
import type { MaterialGraphNode } from '@unilab-fe/core'
import { AppIcon } from '../../components/ui/Icon'

type GroupNodeData = {
  name: string
  kind: string
  selectionId: string
  selected: boolean
  hasSearch: boolean
  highlighted: boolean
  materialCount: number
  siteCount: number
  onSelect: (selection: MaterialSelection) => void
}

type SiteEntry = MaterialGraphNode['sites'][number]

export type MaterialSelection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'site'; siteId: string }
  | { kind: 'material'; materialId: string; siteId?: string }

type BlockNodeData = {
  node: MaterialGraphNode
  sites: readonly SiteEntry[]
  occupantBySite: ReadonlyMap<string, MaterialGraphNode['material']>
  selectedId?: string
  selectedSiteId?: string
  selectionId: string
  label: string
  typeLabel: string
  hasSearch: boolean
  highlighted: boolean
  highlightedIds: ReadonlySet<string>
  onSelect: (selection: MaterialSelection) => void
}

type ResourceNode = Node<GroupNodeData, 'resourceGroup'> | Node<BlockNodeData, 'resourceBlock'>

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

function ResourceGroupNode({ data }: NodeProps<GroupNodeData>) {
  return (
    <div
      className={cx(
        `material-flow-group ${data.selected ? 'is-selected' : ''} ${data.highlighted ? 'is-search-match' : ''} ${data.hasSearch && !data.highlighted ? 'is-search-dimmed' : ''} nodrag nopan`,
      )}
    >
      <button
        type="button"
        className={cx('material-flow-group__header')}
        onClick={(event) => {
          event.stopPropagation()
          data.onSelect?.({ kind: 'node', nodeId: data.selectionId })
        }}
      >
        <span className={cx('material-flow-group__icon')}>
          <AppIcon
            name={data.kind === 'device' ? 'development/cpu-chip-01' : 'shapes/cube-03'}
            size={16}
          />
        </span>
        <div>
          <strong>{data.name}</strong>
          <small>
            {data.kind === 'device' ? '设备' : '资源台面'} · {data.materialCount} 个物料 ·{' '}
            {data.siteCount} 个库位
          </small>
        </div>
      </button>
    </div>
  )
}

function ResourceBlockNode({ data }: NodeProps<BlockNodeData>) {
  const {
    sites,
    occupantBySite,
    selectedId,
    selectedSiteId,
    selectionId,
    label,
    typeLabel,
    hasSearch,
    highlighted,
    highlightedIds,
    onSelect,
  } = data
  const grid = gridShape(sites)
  const occupied = sites.filter((site) => Boolean(occupantBySite.get(site.siteUuid))).length
  return (
    <div
      className={cx(
        `material-flow-block ${highlighted ? 'is-search-match' : ''} ${hasSearch && !highlighted ? 'is-search-dimmed' : ''}`,
      )}
    >
      <button
        type="button"
        className={cx('material-flow-block__header')}
        onClick={(event) => {
          event.stopPropagation()
          onSelect({ kind: 'node', nodeId: selectionId })
        }}
      >
        <div>
          <strong>{label}</strong>
          <small>
            {occupied}/{sites.length} 有料
          </small>
        </div>
        <span className={cx('material-flow-block__type')}>{typeLabel}</span>
      </button>
      <div
        className={cx('material-flow-block__grid')}
        style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
      >
        {sites.map((site) => {
          const occupant = occupantBySite.get(site.siteUuid)
          const active = isMaterialSiteSelected(
            site.siteUuid,
            occupant?.materialUuid,
            selectedId,
            selectedSiteId,
          )
          const siteHighlighted = Boolean(
            occupant && hasSearch && highlightedIds.has(occupant.materialUuid),
          )
          return (
            <button
              type="button"
              key={site.siteUuid}
              className={cx(
                `material-flow-site ${occupant ? 'is-occupied' : 'is-empty'} ${active ? 'is-selected' : ''} ${siteHighlighted ? 'is-search-match' : ''} ${hasSearch && !highlighted && !siteHighlighted ? 'is-search-dimmed' : ''} nodrag nopan`,
              )}
              title={occupant ? `${site.name} · ${occupant.name}` : `${site.name} · 空库位`}
              aria-label={occupant ? `${site.name} · ${occupant.name}` : `${site.name} · 空库位`}
              data-selected={active ? 'true' : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(
                  occupant
                    ? { kind: 'material', materialId: occupant.materialUuid, siteId: site.siteUuid }
                    : { kind: 'site', siteId: site.siteUuid },
                )
              }}
            >
              <strong>{site.key || site.name}</strong>
              <small>{occupant ? compactName(occupant.name) : '空'}</small>
            </button>
          )
        })}
      </div>
    </div>
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

export function isMaterialGraphNodeHidden(node: MaterialGraphNode): boolean {
  const config = node.material.config
  return (
    config.virtual === true ||
    config.logical_mount === true ||
    config.logicalMount === true ||
    node.material.materialType === 'deck' ||
    node.material.className === 'host_node'
  )
}

export function isMaterialSiteSelected(
  siteId: string,
  occupantMaterialId: string | undefined,
  selectedMaterialId: string | undefined,
  selectedSiteId: string | undefined,
): boolean {
  return (
    selectedSiteId === siteId ||
    (occupantMaterialId !== undefined && selectedMaterialId === occupantMaterialId)
  )
}

function comparePosition(left: MaterialGraphNode, right: MaterialGraphNode): number {
  const ly = left.relativePosition?.positionMm[1] ?? 0
  const ry = right.relativePosition?.positionMm[1] ?? 0
  const lx = left.relativePosition?.positionMm[0] ?? 0
  const rx = right.relativePosition?.positionMm[0] ?? 0
  return (
    ry - ly ||
    lx - rx ||
    left.material.name.localeCompare(right.material.name, 'zh-CN', { numeric: true })
  )
}

function gridShape(sites: readonly SiteEntry[]): { columns: number } {
  const xs = new Set(
    sites
      .map((site) => site.geometry?.positionMm[0])
      .filter((value): value is number => value != null),
  )
  const ys = new Set(
    sites
      .map((site) => site.geometry?.positionMm[1])
      .filter((value): value is number => value != null),
  )
  if (xs.size > 0 && ys.size > 0 && xs.size * ys.size <= sites.length * 1.5 && xs.size <= 8)
    return { columns: xs.size }
  return { columns: Math.min(8, Math.max(1, Math.ceil(Math.sqrt(sites.length)))) }
}

function compactName(value: string): string {
  return value.length > 9 ? `${value.slice(0, 8)}…` : value
}
