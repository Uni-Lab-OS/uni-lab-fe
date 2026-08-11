import { describe, expect, it } from 'vitest'

import { buildMaterialGraphIndex } from './rules'
import { buildMaterialTree } from './MaterialTreeSidebar'
import { filterMaterialTree } from './materialTreeQuery'
import { materialAggregate } from './testFixtures'

describe('buildMaterialTree', () => {
  it('derives the Cloud-style directory tree from the aggregate graph', () => {
    const host = materialAggregate('host', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    host.material.name = 'host_node'
    const device = materialAggregate('device', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [200, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    device.material.name = 'PRCXI'
    const deck = materialAggregate('deck', {
      placement: {
        kind: 'parent',
        parentId: 'device',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    deck.material.name = 'PRCXI_Deck'
    const well = materialAggregate('well-a1', {
      placement: {
        kind: 'parent',
        parentId: 'deck',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      component: {
        kind: 'well',
        key: 'A1',
        managedByParent: true
      }
    })

    const aggregatesById = {
      host,
      device,
      deck,
      'well-a1': well
    }
    const tree = buildMaterialTree(
      aggregatesById,
      buildMaterialGraphIndex(aggregatesById).childrenByParentId
    )

    expect(tree.map((entry) => entry.aggregate.material.name)).toEqual([
      'host_node',
      'PRCXI'
    ])
    const deckEntry = tree[1].children[0]
    expect(deckEntry.kind).toBe('material')
    if (deckEntry.kind !== 'material') return
    expect(deckEntry.aggregate.material.name).toBe('PRCXI_Deck')
    const wellEntry = deckEntry.children[0]
    expect(wellEntry.kind).toBe('material')
    if (wellEntry.kind !== 'material') return
    expect(
      wellEntry.aggregate.material.component
    ).toEqual({
      kind: 'well',
      key: 'A1',
      managedByParent: true
    })
  })

  it('interleaves occupied Materials and empty Site rows in Site order', () => {
    const occupied = materialAggregate('occupied', {
      placement: {
        kind: 'site',
        parentId: 'warehouse',
        siteId: 'site-02',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    occupied.material.name = '样品瓶'
    const warehouse = materialAggregate('warehouse', {
      sites: [
        site('site-02', 'L1B1', ['occupied']),
        site('site-01', 'L1A1', [])
      ]
    })

    const aggregatesById = { warehouse, occupied }
    const tree = buildMaterialTree(
      aggregatesById,
      buildMaterialGraphIndex(aggregatesById).childrenByParentId
    )

    expect(tree[0].children.map((entry) => entry.kind)).toEqual([
      'material',
      'empty-site'
    ])
    const occupiedEntry = tree[0].children[0]
    const emptyEntry = tree[0].children[1]
    expect(occupiedEntry.kind).toBe('material')
    expect(emptyEntry.kind).toBe('empty-site')
    if (occupiedEntry.kind !== 'material' || emptyEntry.kind !== 'empty-site') {
      return
    }
    expect(occupiedEntry.aggregate.material.name).toBe('样品瓶')
    expect(occupiedEntry.occupyingSite?.name).toBe('L1B1')
    expect(emptyEntry.site.name).toBe('L1A1')
  })

  /** 证明本地查询保留命中子物料的父路径，并支持库位名称。 */
  it('filters by Material identity and Site while preserving ancestor context', () => {
    const sample = materialAggregate('sample-42', {
      placement: {
        kind: 'site',
        parentId: 'warehouse',
        siteId: 'site-02',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    sample.material.name = '待检样品'
    sample.material.code = 'SAMPLE-042'
    const warehouse = materialAggregate('warehouse', {
      sites: [
        site('site-02', 'L1B1', ['sample-42']),
        site('site-01', 'L1A1', [])
      ]
    })
    const aggregatesById = { warehouse, 'sample-42': sample }
    const tree = buildMaterialTree(
      aggregatesById,
      buildMaterialGraphIndex(aggregatesById).childrenByParentId
    )

    const materialResult = filterMaterialTree(tree, 'sample-042')
    expect(materialResult).toHaveLength(1)
    expect(materialResult[0].children).toHaveLength(1)
    expect(materialResult[0].children[0].kind).toBe('material')

    const siteResult = filterMaterialTree(tree, 'L1A1')
    expect(siteResult).toHaveLength(1)
    expect(siteResult[0].children).toHaveLength(1)
    expect(siteResult[0].children[0].kind).toBe('empty-site')

    const occupiedSiteResult = filterMaterialTree(tree, 'L1B1')
    expect(occupiedSiteResult[0].children).toHaveLength(1)
    expect(occupiedSiteResult[0].children[0].kind).toBe('material')
  })
})

function site(
  id: string,
  name: string,
  occupiedMaterialIds: readonly string[]
) {
  return {
    id,
    ownerMaterialId: 'warehouse',
    key: name,
    name,
    anchor: { kind: 'root' as const },
    poseInAnchor: {
      positionMm: [0, 0, 0] as const,
      rotationDegXYZ: [0, 0, 0] as const
    },
    sizeMm: [10, 10, 10] as const,
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds
  }
}
