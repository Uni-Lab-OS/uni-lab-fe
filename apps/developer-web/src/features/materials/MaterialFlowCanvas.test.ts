import { describe, expect, it } from 'vitest'
import type { MaterialGraphNode } from '@unilab-fe/core'
import { isMaterialSiteSelected, projectResourceNodes } from './MaterialFlowCanvas'
import type { BlockNodeData, GroupNodeData } from './materialFlowModel'

describe('isMaterialSiteSelected', () => {
  it('does not select every empty site when no material is selected', () => {
    expect(isMaterialSiteSelected('site-a', undefined, undefined, undefined)).toBe(false)
  })

  it('selects an occupied site by its material or site identity', () => {
    expect(isMaterialSiteSelected('site-a', 'material-a', 'material-a', undefined)).toBe(true)
    expect(isMaterialSiteSelected('site-a', 'material-a', undefined, 'site-a')).toBe(true)
    expect(isMaterialSiteSelected('site-a', 'material-a', 'material-b', 'site-b')).toBe(false)
  })
})

describe('resource card layout', () => {
  it.each([
    [14, 6, 6],
    [3, 18, 2],
    [2, 6, 6],
    [30, 1, 9],
  ])('keeps every site and separates unequal cards (%i, %i, %i)', (rackSites, firstSites, secondSites) => {
    const rack = graphNode('a-rack', rackSites)
    rack.sites[0]!.occupancy.occupiedMaterialUuid = 'b-tray'
    rack.sites[1]!.occupancy.occupiedMaterialUuid = 'c-tray'
    const nodes = [
      rack,
      graphNode('b-tray', firstSites, 'a-rack', 'a-rack-0'),
      graphNode('c-tray', secondSites, 'a-rack', 'a-rack-1'),
    ]
    const projected = projectResourceNodes(nodes, false, undefined, undefined, undefined, () => {})
    const group = projected.find((node) => node.type === 'resourceGroup')!
    const cards = projected.filter((node) => node.type === 'resourceBlock')
    expect(cards).toHaveLength(3)
    expect((group.data as GroupNodeData).siteCount).toBe(rackSites + firstSites + secondSites)
    for (const card of cards) {
      const data = card.data as BlockNodeData
      expect(data.sites.map((site) => site.siteUuid)).toEqual(data.node.sites.map((site) => site.siteUuid))
      // 本例的库位在同一列；卡片须容纳标题、内边距及实际渲染的每一行。
      expect(Number(card.style!.height)).toBeGreaterThanOrEqual(35 + 16 + data.sites.length * 37 + (data.sites.length - 1) * 4)
      expect(card.position.y + Number(card.style!.height)).toBeLessThan(Number(group.style!.height))
      expect(card.position.x + Number(card.style!.width)).toBeLessThan(Number(group.style!.width))
    }
    for (let left = 0; left < cards.length; left += 1) {
      for (let right = left + 1; right < cards.length; right += 1) {
        const a = cards[left]!
        const b = cards[right]!
        const separated = a.position.x + Number(a.style!.width) <= b.position.x
          || b.position.x + Number(b.style!.width) <= a.position.x
          || a.position.y + Number(a.style!.height) <= b.position.y
          || b.position.y + Number(b.style!.height) <= a.position.y
        expect(separated).toBe(true)
      }
    }
  })
})

function graphNode(uuid: string, siteCount: number, parent: string | null = null, currentSite: string | null = null) {
  return {
    material: {
      kind: 'material_summary', source: 'fixture', materialUuid: uuid,
      resourceTemplateUuid: 'template', name: uuid, materialType: 'resource',
      parentMaterialUuid: parent, className: null, barcode: null, description: null,
      revision: null, config: {}, metadata: {}, createdAt: null, updatedAt: null, raw: {},
    },
    resourceTemplate: null, relativePosition: null, currentSiteUuid: currentSite, raw: {},
    sites: Array.from({ length: siteCount }, (_, index) => ({
      kind: 'site' as const, source: 'fixture' as const,
      siteUuid: `${uuid}-${index}`, ownerMaterialUuid: uuid,
      key: String(index + 1), name: String(index + 1), sortOrder: index,
      allowedResourceTemplateUuids: null,
      occupancy: { known: true, occupiedMaterialUuid: null as string | null },
      geometry: { positionMm: [0, 0, 0] as const, sizeMm: null, rotationDegXYZ: null },
      metadata: {}, raw: {},
    })),
  } satisfies MaterialGraphNode
}
