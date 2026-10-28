import { describe, expect, it } from 'vitest'
import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { placementCandidates, resolveMaterialSiteAction } from './materialSiteActions'

describe('resolveMaterialSiteAction', () => {
  it('为已占用库位提供下料方向', () => {
    expect(resolveMaterialSiteAction({ known: true, occupiedMaterialUuid: 'material-1' })).toBe(
      'unload',
    )
  })

  it('为已知空库位提供上料方向', () => {
    expect(resolveMaterialSiteAction({ known: true, occupiedMaterialUuid: null })).toBe('load')
  })

  it('占用未知时不提供上下料方向', () => {
    expect(resolveMaterialSiteAction({ known: false, occupiedMaterialUuid: null })).toBe(
      'unavailable',
    )
  })
})

describe('placementCandidates', () => {
  const site = materialSite('site-empty', 'rack', { allowed: ['tray-template'] })
  const nodes = [
    graphNode('store', { name: '耗材库' }),
    graphNode('rack', {
      name: '货架',
      parent: 'store',
      sites: [site, materialSite('site-a', 'rack')],
    }),
    graphNode('tray-placed', {
      name: 'collector-2',
      template: 'tray-template',
      currentSite: 'site-a',
    }),
    graphNode('tray-free', { name: 'collector-1', template: 'tray-template', revision: 4 }),
    graphNode('plate', { name: '板', template: 'plate-template' }),
    graphNode('robot', { name: '机械臂', template: 'tray-template', type: 'device' }),
  ]

  it('只列允许的模板，未放置的在前，已放置的标出当前位置', () => {
    expect(placementCandidates(site, nodes)).toEqual([
      { materialUuid: 'tray-free', name: 'collector-1', revision: 4, currentSiteLabel: null },
      {
        materialUuid: 'tray-placed',
        name: 'collector-2',
        revision: 1,
        currentSiteLabel: '货架 / site-a',
      },
    ])
  })

  it('库位未声明允许模板时不过滤，但排除库位所属物料及其上级与设备', () => {
    const open = materialSite('site-open', 'rack')
    expect(placementCandidates(open, nodes).map((item) => item.materialUuid)).toEqual([
      'plate',
      'tray-free',
      'tray-placed',
    ])
  })
})

function materialSite(
  siteUuid: string,
  owner: string,
  options: { allowed?: string[]; occupied?: string } = {},
): SiteSummary {
  return {
    kind: 'site',
    source: 'os',
    siteUuid,
    ownerMaterialUuid: owner,
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids: options.allowed ?? null,
    occupancy: { known: true, occupiedMaterialUuid: options.occupied ?? null },
    geometry: null,
    metadata: {},
    raw: {},
  }
}

function graphNode(
  materialUuid: string,
  options: {
    name: string
    template?: string
    parent?: string
    currentSite?: string
    sites?: SiteSummary[]
    revision?: number
    type?: string
  },
): MaterialGraphNode {
  return {
    material: {
      kind: 'material_summary',
      source: 'os',
      materialUuid,
      resourceTemplateUuid: options.template ?? 'container-template',
      materialType: options.type ?? 'container',
      className: null,
      parentMaterialUuid: options.parent ?? null,
      barcode: null,
      name: options.name,
      description: null,
      revision: options.revision ?? 1,
      config: {},
      metadata: {},
      createdAt: null,
      updatedAt: null,
      raw: {},
    },
    resourceTemplate: null,
    relativePosition: null,
    sites: options.sites ?? [],
    currentSiteUuid: options.currentSite ?? null,
    raw: {},
  }
}
