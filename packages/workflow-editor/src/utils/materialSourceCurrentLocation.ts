import type { WorkflowMaterialSourceCatalogSnapshot } from '@unilab/services'

type Position = { ownerUuid: string; ownerName: string; siteUuid: string; siteName: string }
type Location = { kind: 'located'; positions: Position[] } | { kind: 'unavailable'; reason: string }

/** Follow authoritative occupancy outward; never infer container identity from names. */
export function materialSourceCurrentLocation(
  catalog: Pick<WorkflowMaterialSourceCatalogSnapshot, 'materials' | 'sites'>,
  materialUuid: string | null
): Location {
  if (!materialUuid) return { kind: 'unavailable', reason: '尚未选择固定物料。' }
  const positions: Position[] = []
  const visited = new Set<string>()
  let current = materialUuid
  while (true) {
    if (visited.has(current)) return { kind: 'unavailable', reason: '库存位置存在循环关系，请刷新目录后核查。' }
    visited.add(current)
    const sites = catalog.sites.filter(site => site.occupiedMaterialUuid === current)
    if (sites.length > 1) return { kind: 'unavailable', reason: '同一物料出现在多个库位，无法确定当前位置，请刷新目录后核查。' }
    if (sites.length === 0) return positions.length
      ? { kind: 'located', positions }
      : { kind: 'unavailable', reason: '目录未记录该物料的当前库位。' }
    const site = sites[0]!
    const owner = catalog.materials.find(material => material.uuid === site.mountMaterialUuid)
    if (!owner) return { kind: 'unavailable', reason: '当前库位的承载物料不在目录中，请刷新目录后核查。' }
    positions.push({ ownerUuid: owner.uuid, ownerName: owner.name, siteUuid: site.uuid, siteName: site.name })
    current = owner.uuid
  }
}
