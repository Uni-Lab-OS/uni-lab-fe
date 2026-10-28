import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { isMaterialGraphNodeHidden } from './materialFlowModel'

export type MaterialSiteAction = 'load' | 'unload' | 'unavailable'

/**
 * 库位的人工操作方向由库位占用事实决定：
 * - 空库位只能上料；
 * - 已占用库位只能下料；
 * - 占用未知时不提供任何方向，避免覆盖未知状态。
 */
export function resolveMaterialSiteAction(occupancy: SiteSummary['occupancy']): MaterialSiteAction {
  if (!occupancy.known) return 'unavailable'
  return occupancy.occupiedMaterialUuid ? 'unload' : 'load'
}

export interface PlacementCandidate {
  readonly materialUuid: string
  readonly name: string
  readonly revision: number | null
  /** 当前所在库位（“所属物料 / 库位”）；未放置时为 null。 */
  readonly currentSiteLabel: string | null
}

/**
 * 空库位的上料候选：库位声明了允许的资源模板时只列这些模板的物料（未声明时不过滤，由 OS 校验）；
 * 排除库位所属物料本身及其上级（放进去会成环）、设备与虚拟节点。未放置的排在前面；已在别处库位的
 * 标出当前位置，上料即从原库位换到这里。
 */
export function placementCandidates(
  site: SiteSummary,
  nodes: readonly MaterialGraphNode[],
): PlacementCandidate[] {
  const byId = new Map(nodes.map((node) => [node.material.materialUuid, node]))
  const siteLabels = new Map<string, string>()
  for (const node of nodes) {
    for (const item of node.sites) {
      siteLabels.set(item.siteUuid, `${node.material.name} / ${item.name || item.key}`)
    }
  }
  const excluded = new Set<string>()
  for (
    let current = byId.get(site.ownerMaterialUuid);
    current && !excluded.has(current.material.materialUuid);
    current = current.material.parentMaterialUuid
      ? byId.get(current.material.parentMaterialUuid)
      : undefined
  ) {
    excluded.add(current.material.materialUuid)
  }
  const allowed = site.allowedResourceTemplateUuids?.length
    ? new Set(site.allowedResourceTemplateUuids)
    : null
  return nodes
    .filter(
      (node) =>
        !excluded.has(node.material.materialUuid) &&
        node.material.materialType !== 'device' &&
        !isMaterialGraphNodeHidden(node) &&
        (!allowed || allowed.has(node.material.resourceTemplateUuid)),
    )
    .map((node) => ({
      materialUuid: node.material.materialUuid,
      name: node.material.name,
      revision: node.material.revision,
      currentSiteLabel: node.currentSiteUuid
        ? (siteLabels.get(node.currentSiteUuid) ?? node.currentSiteUuid)
        : null,
    }))
    .sort(
      (a, b) =>
        Number(a.currentSiteLabel !== null) - Number(b.currentSiteLabel !== null) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    )
}
