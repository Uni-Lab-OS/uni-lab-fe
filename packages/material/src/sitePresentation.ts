import type { MaterialAggregate, MaterialSite } from './types'

/**
 * Hamilton rails describe the deck's physical background grid. They are not
 * independent installable sites and must not receive the visual/interaction
 * treatment used by T1…T16 or other declared deck slots.
 *
 * Detection uses the source resource's explicit `num_rails` metadata and the
 * projected R1…Rn keys. It does not branch on a graph filename, material ID or
 * test fixture name.
 */
export function isDecorativeDeckRail(
  aggregate: MaterialAggregate,
  site: MaterialSite
): boolean {
  if (site.kind !== 'deck-slot') return false

  const config = recordValue(aggregate.material.config.resourceConfig)
  const railCount = Math.floor(
    finiteNumber(config.num_rails ?? config.numRails)
  )
  if (railCount <= 0) return false

  const match = /^R([1-9]\d*)$/i.exec(site.key.trim())
  if (!match) return false

  const railNumber = Number(match[1])
  return railNumber >= 1 && railNumber <= railCount
}

/**
 * Generic site-bound overlays describe installable carrier/workstation slots.
 * Tip spots remain authoritative Inventory sites for tip occupancy and model
 * instances, but their dense hole grid is owned by the tip-box presentation.
 */
export function shouldRenderSiteBounds(
  aggregate: MaterialAggregate,
  site: MaterialSite
): boolean {
  return (
    site.visible !== false &&
    site.kind !== 'tip-spot' &&
    !isDecorativeDeckRail(aggregate, site)
  )
}

function recordValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
