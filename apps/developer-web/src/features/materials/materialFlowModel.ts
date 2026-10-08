import type { MaterialGraphNode } from '@unilab-fe/core'
import type { Node } from 'reactflow'

export type GroupNodeData = {
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

export type SiteEntry = MaterialGraphNode['sites'][number]

export type MaterialSelection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'site'; siteId: string }
  | { kind: 'material'; materialId: string; siteId?: string }

export type BlockNodeData = {
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

export type ResourceNode =
  | Node<GroupNodeData, 'resourceGroup'>
  | Node<BlockNodeData, 'resourceBlock'>

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

export function comparePosition(left: MaterialGraphNode, right: MaterialGraphNode): number {
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

export function gridShape(sites: readonly SiteEntry[]): { columns: number } {
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

export function compactName(value: string): string {
  return value.length > 9 ? `${value.slice(0, 8)}…` : value
}
