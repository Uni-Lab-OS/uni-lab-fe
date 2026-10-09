import type { MaterialGraph, MaterialGraphNode, SiteSummary } from './model'

export type MaterialInspectionSelection =
  | { readonly kind: 'node'; readonly materialUuid: string }
  | { readonly kind: 'site'; readonly siteUuid: string }
  | {
      readonly kind: 'material'
      readonly materialUuid: string
      readonly siteUuid?: string
    }

/**
 * Inspector 所需的只读 Material/Site 事实投影。
 *
 * 关联库位、当前库位和占用库位都由 Graph 一次计算；UI 不应再遍历整张图
 * 或把收集后的 sites 写回 MaterialGraphNode。
 */
export interface MaterialInspectionProjection {
  readonly selection: MaterialInspectionSelection
  readonly node: MaterialGraphNode
  readonly sites: readonly SiteSummary[]
  readonly selectedSite: SiteSummary | null
  readonly currentSite: SiteSummary | null
  readonly occupiedSite: SiteSummary | null
  readonly activeSite: SiteSummary | null
  readonly occupiedSites: readonly SiteSummary[]
}

export function projectMaterialInspection(
  graph: MaterialGraph,
  selection: MaterialInspectionSelection,
): MaterialInspectionProjection | null {
  const nodesByMaterialUuid = new Map(
    graph.nodes.map((candidate) => [candidate.material.materialUuid, candidate]),
  )
  const sitesByUuid = new Map<string, SiteSummary>()
  const siteOwners = new Map<string, MaterialGraphNode>()
  for (const candidate of graph.nodes) {
    for (const site of candidate.sites) {
      sitesByUuid.set(site.siteUuid, site)
      siteOwners.set(site.siteUuid, candidate)
    }
  }

  const node = resolveNode(selection, nodesByMaterialUuid, siteOwners)
  if (!node) return null

  const sites = collectRelatedSites(node, graph.nodes)
  const selectedSite =
    selection.kind === 'site' || selection.kind === 'material'
      ? selection.siteUuid
        ? (sitesByUuid.get(selection.siteUuid) ?? null)
        : null
      : null
  const currentSite = node.currentSiteUuid ? (sitesByUuid.get(node.currentSiteUuid) ?? null) : null
  const occupiedSite =
    [...sitesByUuid.values()].find(
      (site) => site.occupancy.occupiedMaterialUuid === node.material.materialUuid,
    ) ?? null
  const activeSite = selectedSite ?? currentSite ?? occupiedSite

  return {
    selection,
    node,
    sites,
    selectedSite,
    currentSite,
    occupiedSite,
    activeSite,
    occupiedSites: sites.filter((site) => Boolean(site.occupancy.occupiedMaterialUuid)),
  }
}

function resolveNode(
  selection: MaterialInspectionSelection,
  nodesByMaterialUuid: ReadonlyMap<string, MaterialGraphNode>,
  siteOwners: ReadonlyMap<string, MaterialGraphNode>,
): MaterialGraphNode | undefined {
  if (selection.kind === 'site') return siteOwners.get(selection.siteUuid)
  return nodesByMaterialUuid.get(selection.materialUuid)
}

function collectRelatedSites(
  node: MaterialGraphNode,
  nodes: readonly MaterialGraphNode[],
): readonly SiteSummary[] {
  const relatedMaterialUuids = new Set<string>([node.material.materialUuid])
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of nodes) {
      const parentUuid = candidate.material.parentMaterialUuid
      if (
        parentUuid &&
        relatedMaterialUuids.has(parentUuid) &&
        !relatedMaterialUuids.has(candidate.material.materialUuid)
      ) {
        relatedMaterialUuids.add(candidate.material.materialUuid)
        changed = true
      }
    }
  }

  const sitesByUuid = new Map<string, SiteSummary>()
  for (const candidate of nodes) {
    if (!relatedMaterialUuids.has(candidate.material.materialUuid)) continue
    for (const site of candidate.sites) sitesByUuid.set(site.siteUuid, site)
  }
  return [...sitesByUuid.values()]
}
