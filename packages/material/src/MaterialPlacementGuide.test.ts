import { describe, expect, it } from 'vitest'

import { compatibleEmptySites } from './MaterialPlacementGuide'
import type { MaterialTemplateDetail } from './templateMaterial'
import { materialAggregate } from './testFixtures'
import type { MaterialSite } from './types'

describe('compatibleEmptySites', () => {
  /**
   * 证明位置表单只展示模板兼容、身份兼容且未被占用的稳定库位。
   * @returns 无返回值；不满足任一权威投影条件的库位必须被排除。
   */
  it('filters occupied and incompatible Sites before user confirmation', () => {
    const plate = materialAggregate('plate', {
      templateId: 'template-plate',
      placement: { kind: 'unplaced' }
    })
    const deck = materialAggregate('deck', {
      sites: [
        site('slot-1', 'deck-slot'),
        site('slot-2', 'deck-slot', ['existing-material']),
        site('well-a1', 'well')
      ]
    })
    const restrictedRack = materialAggregate('restricted-rack', {
      sites: [site('rack-1', 'deck-slot', [], ['template-other'])]
    })

    expect(compatibleEmptySites(
      plate,
      {
        plate,
        deck,
        'restricted-rack': restrictedRack
      },
      plateTemplate()
    )).toEqual([
      expect.objectContaining({
        parentId: 'deck',
        siteId: 'slot-1',
        siteKind: 'deck-slot'
      })
    ])
  })

  /**
   * 证明模板规则未知时保持关闭失败，且零容量库位不会成为可选位置。
   * @returns 无返回值；模板缺失或容量不足时必须返回空候选。
   */
  it('fails closed without a template and excludes zero-capacity Sites', () => {
    const plate = materialAggregate('plate', {
      templateId: 'template-plate',
      placement: { kind: 'unplaced' }
    })
    const deck = materialAggregate('deck', {
      sites: [{ ...site('slot-1', 'deck-slot'), capacity: 0 }]
    })

    expect(compatibleEmptySites(plate, { plate, deck })).toEqual([])
    expect(compatibleEmptySites(
      plate,
      { plate, deck },
      plateTemplate()
    )).toEqual([])
  })
})

/**
 * 构造候选筛选测试所需的稳定库位。
 * @param id 库位身份。
 * @param kind 库位业务类型。
 * @param occupiedMaterialIds 当前权威占用物料身份。
 * @param allowedTemplateIds 允许放置的资源模板身份。
 * @returns 具有确定兼容性和占用事实的库位。
 */
function site(
  id: string,
  kind: NonNullable<MaterialSite['kind']>,
  occupiedMaterialIds: readonly string[] = [],
  allowedTemplateIds: readonly string[] = []
): MaterialSite {
  return {
    id,
    ownerMaterialId: 'deck',
    key: id,
    name: id,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [100, 80, 20],
    capacity: 1,
    allowedTemplateIds,
    occupiedMaterialIds,
    kind
  }
}

/**
 * 构造仅允许台面库位的孔板资源模板。
 * @returns 用于候选库位筛选的完整模板详情。
 */
function plateTemplate(): MaterialTemplateDetail {
  return {
    uuid: 'template-plate',
    key: 'plate',
    sourceNamespace: 'test',
    kind: 'resource',
    displayName: '孔板',
    tags: [],
    categoryPath: ['耗材'],
    status: 'ready',
    contentHash: 'plate-hash',
    creation: { mode: 'resource-tree', available: true },
    compatibility: { allowedSiteTypes: ['deck-slot'] },
    configuration: { schema: {}, uiSchema: {} },
    assets: {}
  }
}
