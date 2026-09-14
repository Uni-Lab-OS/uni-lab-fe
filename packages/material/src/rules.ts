import type {
  MaterialAggregate,
  MaterialGraphIndex,
  MaterialId,
  MaterialPlacement,
  MaterialSite,
  SiteId
} from './types'

export class MaterialRuleError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MaterialRuleError'
    this.code = code
  }
}

export function buildMaterialGraphIndex(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): MaterialGraphIndex {
  const childrenByParentId: Record<MaterialId, MaterialId[]> = {}
  const siteOwnerById: Record<SiteId, MaterialId> = {}

  for (const aggregate of Object.values(aggregatesById)) {
    const parentId = placementParentId(aggregate.placement)
    if (parentId) {
      const children = childrenByParentId[parentId] ?? []
      children.push(aggregate.material.id)
      childrenByParentId[parentId] = children
    }
    for (const site of aggregate.sites) {
      siteOwnerById[site.id] = aggregate.material.id
    }
  }

  for (const children of Object.values(childrenByParentId)) {
    children.sort()
  }

  return { childrenByParentId, siteOwnerById }
}

export function assertValidMaterialGraph(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): void {
  const siteIds = new Set<SiteId>()
  const componentKeysByParent = new Map<MaterialId, Set<string>>()

  for (const aggregate of Object.values(aggregatesById)) {
    const id = aggregate.material.id
    const parentId = placementParentId(aggregate.placement)
    if (parentId && !aggregatesById[parentId]) {
      throw new MaterialRuleError(
        'MATERIAL_PARENT_MISSING',
        `Material ${id} references missing parent ${parentId}`
      )
    }
    assertValidManagedComponent(
      aggregate,
      componentKeysByParent
    )

    for (const site of aggregate.sites) {
      assertValidSite(site, aggregate)
      if (siteIds.has(site.id)) {
        throw new MaterialRuleError(
          'MATERIAL_SITE_DUPLICATE',
          `Duplicate Site ID: ${site.id}`
        )
      }
      siteIds.add(site.id)
    }
  }

  for (const id of Object.keys(aggregatesById)) {
    assertNoParentCycle(id, aggregatesById)
  }
}

/** Match inventory slot_id / SSE toSite against Site id, key, name, or canonical label prefix. */
export function siteMatchesSlotReference(
  site: MaterialSite,
  reference: string
): boolean {
  const ref = reference.trim()
  if (!ref) return false
  if (site.id === ref || site.key === ref || site.name === ref) return true
  const base = (value: string): string =>
    value.split(' · ', 1)[0]?.trim() || value
  return base(site.key) === ref || base(site.name) === ref
}

export function assertCanAttach(
  parent: MaterialAggregate,
  child: MaterialAggregate,
  siteId?: SiteId
): void {
  if (parent.material.id === child.material.id) {
    throw new MaterialRuleError(
      'MATERIAL_PARENT_CYCLE',
      'Material cannot attach to itself'
    )
  }

  if (!siteId) return
  const site = parent.sites.find((candidate) => candidate.id === siteId)
  if (!site) {
    throw new MaterialRuleError(
      'MATERIAL_SITE_MISSING',
      `Site ${siteId} does not belong to ${parent.material.id}`
    )
  }
  if (site.occupiedMaterialIds.length >= site.capacity) {
    throw new MaterialRuleError(
      'MATERIAL_SITE_FULL',
      `Site ${siteId} has reached capacity`
    )
  }
  if (
    site.allowedTemplateIds.length > 0 &&
    !site.allowedTemplateIds.includes(child.material.sourceTemplateId)
  ) {
    throw new MaterialRuleError(
      'MATERIAL_TEMPLATE_NOT_ALLOWED',
      `Site ${siteId} does not accept template ${child.material.sourceTemplateId}`
    )
  }
}

function assertValidManagedComponent(
  aggregate: MaterialAggregate,
  componentKeysByParent: Map<MaterialId, Set<string>>
): void {
  const component = aggregate.material.component
  if (!component) return

  if (aggregate.placement.kind !== 'parent') {
    throw new MaterialRuleError(
      'MATERIAL_COMPONENT_PARENT_REQUIRED',
      `Managed component ${aggregate.material.id} must use parent placement`
    )
  }

  const key = component.key.trim()
  if (!key || key !== component.key) {
    throw new MaterialRuleError(
      'MATERIAL_COMPONENT_KEY_INVALID',
      `Managed component ${aggregate.material.id} has an invalid key`
    )
  }

  const parentId = aggregate.placement.parentId
  const keys = componentKeysByParent.get(parentId) ?? new Set<string>()
  const comparableKey = key.toLocaleUpperCase('en-US')
  if (keys.has(comparableKey)) {
    throw new MaterialRuleError(
      'MATERIAL_COMPONENT_KEY_DUPLICATE',
      `Parent ${parentId} has duplicate component key ${key}`
    )
  }
  keys.add(comparableKey)
  componentKeysByParent.set(parentId, keys)
}

export function placementParentId(
  placement: MaterialPlacement
): MaterialId | null {
  return placement.kind === 'parent' || placement.kind === 'site'
    ? placement.parentId
    : null
}

function assertValidSite(
  site: MaterialSite,
  owner: MaterialAggregate
): void {
  if (site.ownerMaterialId !== owner.material.id) {
    throw new MaterialRuleError(
      'MATERIAL_SITE_OWNER_MISMATCH',
      `Site ${site.id} owner does not match its aggregate`
    )
  }
  if (!Number.isInteger(site.capacity) || site.capacity < 1) {
    throw new MaterialRuleError(
      'MATERIAL_SITE_CAPACITY_INVALID',
      `Site ${site.id} capacity must be a positive integer`
    )
  }
  if (site.occupiedMaterialIds.length > site.capacity) {
    throw new MaterialRuleError(
      'MATERIAL_SITE_CAPACITY_EXCEEDED',
      `Site ${site.id} occupancy exceeds capacity`
    )
  }
}

function assertNoParentCycle(
  startId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): void {
  const visited = new Set<MaterialId>([startId])
  let current = aggregatesById[startId]

  while (current) {
    const parentId = placementParentId(current.placement)
    if (!parentId) return
    if (visited.has(parentId)) {
      throw new MaterialRuleError(
        'MATERIAL_PARENT_CYCLE',
        `Parent cycle contains ${parentId}`
      )
    }
    visited.add(parentId)
    current = aggregatesById[parentId]
  }
}
