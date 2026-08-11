import { describe, expect, it } from 'vitest'

import {
  filterMaterialWorkspaceRows
} from './MaterialWorkspaceViews'
import {
  projectMaterialWorkspace
} from './materialWorkspaceProjection'
import { materialWorkspaceReadStatus } from './materialWorkspaceStatus'
import type { MaterialTemplateSummary } from './templateMaterial'
import { materialAggregate } from './testFixtures'
import type { MaterialSite } from './types'

const templates: readonly MaterialTemplateSummary[] = [
  {
    uuid: 'template-device',
    key: 'device',
    sourceNamespace: 'test',
    kind: 'device',
    displayName: '移液工作站',
    tags: [],
    categoryPath: ['设备'],
    status: 'ready',
    contentHash: 'device-hash',
    creation: { mode: 'dynamic-device', available: true }
  },
  {
    uuid: 'template-plate',
    key: 'plate',
    sourceNamespace: 'test',
    kind: 'resource',
    displayName: '96 孔板',
    tags: [],
    categoryPath: ['耗材'],
    status: 'ready',
    contentHash: 'plate-hash',
    creation: { mode: 'resource-tree', available: true }
  }
]

describe('material workspace projection', () => {
  it('只从物料聚合投影实例、物理库位和兼容批次', verifiesProjection)
  it('按身份、批次和位置筛选实例', verifiesFiltering)
  it('模板目录未就绪时不宣称实例分类完成', verifiesCatalogBoundary)
})

/** 验证设备、未知结构资源与父管理孔位不会被误计为物料实例。 */
function verifiesProjection(): void {
  const deckSite = site({
    id: 'device-T1',
    ownerMaterialId: 'device-1',
    name: 'T1',
    kind: 'deck-slot',
    occupiedMaterialIds: ['plate-1']
  })
  const wellSite = site({
    id: 'plate-A1',
    ownerMaterialId: 'plate-1',
    name: 'A1',
    kind: 'well'
  })
  const aggregatesById = {
    'device-1': materialAggregate('device-1', {
      templateId: 'template-device',
      sites: [deckSite]
    }),
    'plate-1': materialAggregate('plate-1', {
      templateId: 'template-plate',
      placement: {
        kind: 'site',
        parentId: 'device-1',
        siteId: 'device-T1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      config: { batch: 'LOT-20260809' },
      sites: [wellSite],
      revision: 7
    }),
    'deck-1': materialAggregate('deck-1', {
      templateId: 'template-structure-without-classification'
    }),
    'plate-A1': materialAggregate('plate-A1', {
      templateId: 'template-plate',
      component: { kind: 'well', key: 'A1', managedByParent: true }
    })
  }

  const projection = projectMaterialWorkspace(aggregatesById, templates)

  expect(projection.summary).toMatchObject({
    graphNodeCount: 4,
    resourceTemplateCount: 1,
    batchGroupCount: 1,
    trackedInstanceCount: 1,
    placedInstanceCount: 1,
    physicalSiteCount: 1,
    occupiedPhysicalSiteCount: 1,
    batchCoveredCount: 1
  })
  expect(projection.rows).toEqual([
    expect.objectContaining({
      id: 'plate-1',
      templateName: '96 孔板',
      batch: 'LOT-20260809',
      placementLabel: 'device-1 / T1',
      physicalSiteCount: 0,
      revision: 7
    })
  ])
  expect(projection.lotGroups).toHaveLength(1)
  expect(projection.lotGroups[0]?.rows).toHaveLength(1)
  expect(projection.templates).toEqual([
    expect.objectContaining({
      template: expect.objectContaining({ uuid: 'template-plate' }),
      rows: [expect.objectContaining({ id: 'plate-1' })]
    })
  ])
}

/** 验证实例台账搜索不依赖额外前端库存状态。 */
function verifiesFiltering(): void {
  const projection = projectMaterialWorkspace(
    {
      plate: materialAggregate('plate', {
        templateId: 'template-plate',
        config: { batch: 'LOT-42' }
      })
    },
    templates
  )

  expect(filterMaterialWorkspaceRows(projection.rows, 'lot-42'))
    .toHaveLength(1)
  expect(filterMaterialWorkspaceRows(projection.rows, '实验室坐标'))
    .toHaveLength(1)
  expect(filterMaterialWorkspaceRows(projection.rows, '不存在'))
    .toHaveLength(0)
}

/** 验证资源模板目录未完成时页面保持待定状态。 */
function verifiesCatalogBoundary(): void {
  expect(materialWorkspaceReadStatus(
    'ready',
    { available: true },
    { available: true },
    'pending'
  )).toEqual({
    state: 'pending',
    label: '物料图已载入 · 正在分类实例'
  })
  expect(materialWorkspaceReadStatus(
    'ready',
    { available: true },
    { available: true },
    'ready'
  )).toEqual({
    state: 'ready',
    label: '物料数据已加载'
  })
}

/** 构造只用于投影断言的稳定物理库位或展示孔位。 */
function site(input: {
  id: string
  ownerMaterialId: string
  name: string
  kind: NonNullable<MaterialSite['kind']>
  occupiedMaterialIds?: readonly string[]
}): MaterialSite {
  return {
    id: input.id,
    ownerMaterialId: input.ownerMaterialId,
    key: input.name,
    name: input.name,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [1, 1, 1],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: input.occupiedMaterialIds ?? [],
    kind: input.kind
  }
}
