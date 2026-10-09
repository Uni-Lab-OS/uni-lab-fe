import { describe, expect, it } from 'vitest'
import type { MaterialGraph, MaterialGraphNode, SiteSummary } from './model'
import { projectMaterialInspection } from './inspection'

function site(siteUuid: string, ownerMaterialUuid: string, occupiedMaterialUuid: string | null) {
  return {
    kind: 'site',
    source: 'fixture',
    siteUuid,
    ownerMaterialUuid,
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids: null,
    occupancy: { known: true, occupiedMaterialUuid },
    geometry: null,
    metadata: {},
    raw: {},
  } satisfies SiteSummary
}

function node(
  materialUuid: string,
  parentMaterialUuid: string | null,
  sites: readonly SiteSummary[],
  currentSiteUuid: string | null = null,
) {
  return {
    material: {
      kind: 'material_summary',
      source: 'fixture',
      materialUuid,
      resourceTemplateUuid: 'template-1',
      materialType: 'container',
      className: null,
      parentMaterialUuid,
      barcode: null,
      name: materialUuid,
      description: null,
      revision: 1,
      config: {},
      metadata: {},
      createdAt: null,
      updatedAt: null,
      raw: {},
    },
    resourceTemplate: null,
    relativePosition: null,
    sites,
    currentSiteUuid,
    raw: {},
  } satisfies MaterialGraphNode
}

describe('material inspection projection', () => {
  const graph = {
    kind: 'material_graph',
    source: 'fixture',
    nodes: [
      node('parent', null, [site('parent-site', 'parent', 'child')]),
      node('child', 'parent', [site('child-site', 'child', null)], 'child-site'),
      node('unrelated', null, [site('other-site', 'unrelated', null)]),
    ],
    raw: {},
  } satisfies MaterialGraph

  it('collects descendant sites and resolves the material occupancy relation once', () => {
    const projection = projectMaterialInspection(graph, {
      kind: 'node',
      materialUuid: 'parent',
    })

    expect(projection?.sites.map((item) => item.siteUuid)).toEqual(['parent-site', 'child-site'])
    expect(projection?.occupiedSites.map((item) => item.siteUuid)).toEqual(['parent-site'])
    expect(projection?.occupiedSite).toBeNull()

    const childProjection = projectMaterialInspection(graph, {
      kind: 'material',
      materialUuid: 'child',
    })
    expect(childProjection?.occupiedSite?.siteUuid).toBe('parent-site')
  })

  it('resolves site selection to its owner without requiring callers to walk the graph', () => {
    const projection = projectMaterialInspection(graph, {
      kind: 'site',
      siteUuid: 'child-site',
    })

    expect(projection?.node.material.materialUuid).toBe('child')
    expect(projection?.selectedSite?.siteUuid).toBe('child-site')
    expect(projection?.currentSite?.siteUuid).toBe('child-site')
    expect(projection?.activeSite?.siteUuid).toBe('child-site')
  })

  it('returns null for a selection that is not present in the graph', () => {
    expect(
      projectMaterialInspection(graph, { kind: 'material', materialUuid: 'missing' }),
    ).toBeNull()
  })
})
