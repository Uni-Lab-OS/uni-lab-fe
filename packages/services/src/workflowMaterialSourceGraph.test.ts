import type { MaterialAggregate, MaterialSite } from '@unilab/material'
import { describe, expect, it } from 'vitest'

import { projectWorkflowMaterialSourceGraph } from './workflowMaterialSourceGraph'

// 挂载物料 UUID 标识直接拥有测试库位（Site）的 Deck 实例。
const mountUuid = '51000000-0000-4000-8000-000000000001'
// 被占用物料 UUID 标识放置在测试库位中的具体孔板。
const materialUuid = '52000000-0000-4000-8000-000000000001'
// 挂载资源模板 UUID 标识 Deck 物料实例的来源类型。
const mountTemplateUuid = '61000000-0000-4000-8000-000000000001'
// 样品资源模板 UUID 标识库位允许承载的孔板类型。
const sampleTemplateUuid = '62000000-0000-4000-8000-000000000001'
// 第一库位 UUID 故意使用较大的字典序，证明 sort_order 优先于 UUID。
const firstSiteUuid = '71000000-0000-4000-8000-000000000009'
// 第二库位 UUID 故意使用较小的字典序，证明输入遍历顺序不是业务顺序。
const secondSiteUuid = '71000000-0000-4000-8000-000000000001'

/**
 * 注册公共物料图（MaterialGraph）到工作流物料来源（MaterialSource）目录的行为测试。
 *
 * @returns 不返回值；任一公开投影或失败关闭不变量被破坏时由 Vitest 报告失败。
 * @throws 测试注册失败时由 Vitest 报告异常。
 */
function registerWorkflowMaterialSourceGraphTests(): void {
  it(
    '公共物料图（MaterialGraph）按 sort_order 与 UUID 投影物料（Material）、挂载物料、库位占用（SiteOccupancy）与兼容资源模板（ResourceTemplate）',
    projectsPublicGraphFactsInStableOrder
  )
  it('物料（Material）UUID 重复时必须失败关闭', rejectsDuplicateMaterialIdentity)
  it('库位（Site）UUID 重复时必须失败关闭', rejectsDuplicateSiteIdentity)
  it('库位（Site）所有者与聚合物料（Material）不一致时必须失败关闭', rejectsMismatchedSiteOwner)
  it('库位占用（SiteOccupancy）引用悬空物料（Material）时必须失败关闭', rejectsDanglingSiteOccupancy)
  it('库位（Site）容量不等于一时必须失败关闭', rejectsNonSingleSiteCapacity)
  it('库位（Site）允许的资源模板（ResourceTemplate）UUID 重复时必须失败关闭', rejectsDuplicateAllowedTemplates)
  it('单一库位占用（SiteOccupancy）遇到多个占用物料（Material）时必须失败关闭', rejectsMultipleSiteOccupants)
  it('实验耗材内部结构不得进入工作流（Workflow）候选库位（Site）', excludesManagedLabwareComponents)
}

describe(
  '工作流物料来源（MaterialSource）公共物料图（MaterialGraph）投影',
  registerWorkflowMaterialSourceGraphTests
)

/**
 * 验证工作流物料来源（MaterialSource）按库位排序事实而非输入遍历顺序投影。
 *
 * @returns 不返回值；物料、资源模板、库位（Site）或库位占用（SiteOccupancy）投影不符时断言失败。
 */
function projectsPublicGraphFactsInStableOrder(): void {
  // 输入先给高 sort_order 的小 UUID，再给低 sort_order 的大 UUID，证明排序闭集。
  const mountAggregate = materialAggregate(
    mountUuid,
    mountTemplateUuid,
    'Deck A',
    [
      materialSiteWithSortOrder(
        secondSiteUuid,
        mountUuid,
        '库位 B',
        [sampleTemplateUuid],
        [materialUuid],
        20
      ),
      materialSiteWithSortOrder(
        firstSiteUuid,
        mountUuid,
        '库位 A',
        [],
        [],
        10
      )
    ]
  )
  // 被占用物料聚合提供库位占用（SiteOccupancy）中引用的稳定物料 UUID。
  const occupiedAggregate = materialAggregate(
    materialUuid,
    sampleTemplateUuid,
    'Assay plate'
  )
  // 展示摘要由 Backend 物料图 adapter 校验后放入 config，不从实例名反推模板名。
  mountAggregate.material.config.resourceTemplate = {
    uuid: mountTemplateUuid,
    displayName: 'Deck'
  }
  occupiedAggregate.material.config.resourceTemplate = {
    uuid: sampleTemplateUuid,
    displayName: 'Plate96'
  }

  const projection = projectWorkflowMaterialSourceGraph([
    occupiedAggregate,
    mountAggregate
  ])

  expect(projection).toEqual({
    resourceTemplates: [
      { uuid: mountTemplateUuid, displayName: 'Deck' },
      { uuid: sampleTemplateUuid, displayName: 'Plate96' }
    ],
    materials: [
      {
        uuid: mountUuid,
        name: 'Deck A',
        resourceTemplateUuid: mountTemplateUuid
      },
      {
        uuid: materialUuid,
        name: 'Assay plate',
        resourceTemplateUuid: sampleTemplateUuid
      }
    ],
    sites: [
      {
        uuid: firstSiteUuid,
        name: '库位 A',
        mountMaterialUuid: mountUuid,
        allowedResourceTemplateUuids: [],
        occupiedMaterialUuid: null,
        sortOrder: 10
      },
      {
        uuid: secondSiteUuid,
        name: '库位 B',
        mountMaterialUuid: mountUuid,
        allowedResourceTemplateUuids: [sampleTemplateUuid],
        occupiedMaterialUuid: materialUuid,
        sortOrder: 20
      }
    ]
  })
  expect(siteIds(mountAggregate.sites)).toEqual([secondSiteUuid, firstSiteUuid])
}

/**
 * 验证两个公共物料聚合不能声明同一个物料 UUID。
 *
 * @returns 不返回值；重复身份未产生结构化失败时断言失败。
 */
function rejectsDuplicateMaterialIdentity(): void {
  // 重复物料 UUID 用于证明公共物料图（MaterialGraph）不会合并同一稳定身份。
  const duplicatedMaterialUuid = mountUuid
  expectInvalidProjection([
    materialAggregate(duplicatedMaterialUuid, mountTemplateUuid, 'Deck A'),
    materialAggregate(duplicatedMaterialUuid, sampleTemplateUuid, 'Deck B')
  ])
}

/**
 * 验证不同挂载物料不能发布相同的库位 UUID。
 *
 * @returns 不返回值；重复库位身份未失败关闭时断言失败。
 */
function rejectsDuplicateSiteIdentity(): void {
  // 第二挂载物料 UUID 标识发布冲突库位（Site）的另一个聚合所有者。
  const secondMountUuid = '51000000-0000-4000-8000-000000000002'
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(firstSiteUuid, mountUuid, '库位 A', [], [])
    ]),
    materialAggregate(secondMountUuid, mountTemplateUuid, 'Deck B', [
      materialSite(firstSiteUuid, secondMountUuid, '库位 B', [], [])
    ])
  ])
}

/**
 * 验证库位（Site）声明的所有者必须等于承载它的公共物料聚合身份。
 *
 * @returns 不返回值；不一致所有者被静默接受时断言失败。
 */
function rejectsMismatchedSiteOwner(): void {
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(firstSiteUuid, materialUuid, '库位 A', [], [])
    ])
  ])
}

/**
 * 验证库位占用（SiteOccupancy）不能引用公共物料图（MaterialGraph）中不存在的物料。
 *
 * @returns 不返回值；悬空物料 UUID 未触发结构化失败时断言失败。
 */
function rejectsDanglingSiteOccupancy(): void {
  // 悬空物料 UUID 故意不对应任何物料聚合，用于验证失败关闭。
  const danglingMaterialUuid = '52000000-0000-4000-8000-000000000099'
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(
        firstSiteUuid,
        mountUuid,
        '库位 A',
        [sampleTemplateUuid],
        [danglingMaterialUuid]
      )
    ])
  ])
}

/**
 * 验证工作流物料来源（MaterialSource）目录不能有损投影容量不等于一的库位（Site）。
 *
 * @returns 不返回值；非单容量库位未触发结构化失败时断言失败。
 */
function rejectsNonSingleSiteCapacity(): void {
  const invalidSite = materialSite(firstSiteUuid, mountUuid, '库位 A', [], [])
  // 容量二明确超出当前单一库位占用（SiteOccupancy）读模型的表达能力。
  invalidSite.capacity = 2
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [invalidSite])
  ])
}

/**
 * 验证库位（Site）的兼容资源模板集合不能包含重复稳定身份。
 *
 * @returns 不返回值；重复资源模板（ResourceTemplate）UUID 未触发结构化失败时断言失败。
 */
function rejectsDuplicateAllowedTemplates(): void {
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(
        firstSiteUuid,
        mountUuid,
        '库位 A',
        [sampleTemplateUuid, sampleTemplateUuid],
        []
      )
    ])
  ])
}

/**
 * 验证现有单一占用字段不能有损吞掉公共库位（Site）的第二个占用物料。
 *
 * @returns 不返回值；多个占用物料被折叠为一个 UUID 时断言失败。
 */
function rejectsMultipleSiteOccupants(): void {
  // 第二物料 UUID 标识同一库位（Site）中不应被静默吞掉的额外占用物料。
  const secondMaterialUuid = '52000000-0000-4000-8000-000000000002'
  expectInvalidProjection([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(
        firstSiteUuid,
        mountUuid,
        '库位 A',
        [sampleTemplateUuid],
        [materialUuid, secondMaterialUuid]
      )
    ]),
    materialAggregate(materialUuid, sampleTemplateUuid, 'Plate A'),
    materialAggregate(secondMaterialUuid, sampleTemplateUuid, 'Plate B')
  ])
}

/**
 * 验证孔（well）和吸头点位（tip-spot）只属于物料内部展示结构，不能升级为工作流业务库位（Site）。
 *
 * @returns 不返回值；内部结构出现在物料来源候选库位时断言失败。
 */
function excludesManagedLabwareComponents(): void {
  // 孔 UUID 标识只属于容器内部结构的测试位置。
  const wellUuid = '71000000-0000-4000-8000-000000000003'
  // 吸头点位 UUID 标识只属于耗材内部结构的测试位置。
  const tipSpotUuid = '71000000-0000-4000-8000-000000000004'
  const projection = projectWorkflowMaterialSourceGraph([
    materialAggregate(mountUuid, mountTemplateUuid, 'Deck A', [
      materialSite(firstSiteUuid, mountUuid, '库位 A', [], []),
      materialSite(wellUuid, mountUuid, 'A1', [], [], 'well'),
      materialSite(tipSpotUuid, mountUuid, 'T1', [], [], 'tip-spot')
    ])
  ])

  expect(siteIds(projection.sites)).toEqual([firstSiteUuid])
}

/**
 * 断言公共物料图（MaterialGraph）投影以固定错误码失败关闭。
 *
 * @param aggregates 应被拒绝的公共物料聚合集合。
 * @returns 不返回值；未抛错或错误码不符时断言失败。
 * @throws 仅当投影未按预期失败时抛出测试断言错误。
 */
function expectInvalidProjection(
  aggregates: readonly MaterialAggregate[]
): void {
  try {
    projectWorkflowMaterialSourceGraph(aggregates)
  } catch (error) {
    expect(error).toMatchObject({
      code: 'INVALID_WORKFLOW_MATERIAL_SOURCE_GRAPH'
    })
    return
  }
  throw new Error('预期公共物料图（MaterialGraph）投影失败关闭')
}

/**
 * 读取库位（Site）集合的稳定 UUID，并保留调用方给出的公共图顺序。
 *
 * @param sites 公共库位或工作流物料来源库位集合。
 * @returns 与输入遍历顺序一致的库位 UUID 数组。
 * @throws 不主动抛出异常。
 */
function siteIds(sites: ReadonlyArray<{ id?: string; uuid?: string }>): string[] {
  // 库位（Site）身份集合保存每个库位（Site）在公共图遍历中的稳定 UUID。
  const identities: string[] = []
  for (const site of sites) identities.push(site.id ?? site.uuid ?? '')
  return identities
}

/**
 * 构造测试使用的公共物料聚合（MaterialAggregate）。
 *
 * @param materialId 具体物料（Material）的稳定 UUID。
 * @param sourceTemplateId 物料实例来源的资源模板 UUID。
 * @param name 面向工作流创作界面的物料名称。
 * @param sites 由该物料直接拥有的库位（Site）集合。
 * @returns 只包含公共投影所需事实的物料聚合。
 */
function materialAggregate(
  materialId: string,
  sourceTemplateId: string,
  name: string,
  sites: readonly MaterialSite[] = []
): MaterialAggregate {
  return {
    material: {
      id: materialId,
      sourceTemplateId,
      code: materialId,
      name,
      config: {},
      createdAt: '2026-08-05T00:00:00Z',
      updatedAt: '2026-08-05T00:00:00Z'
    },
    placement: { kind: 'unplaced' },
    sites,
    revision: 1
  }
}

/**
 * 构造测试使用的公共库位（Site）事实。
 *
 * @param siteId 库位的稳定 UUID。
 * @param ownerMaterialId 直接拥有该库位的挂载物料 UUID。
 * @param name 库位显示名称。
 * @param allowedTemplateIds 该库位允许承载的资源模板 UUID 集合。
 * @param occupiedMaterialIds 当前权威库位占用（SiteOccupancy）的物料 UUID 集合。
 * @param kind 公共图中的结构类型；孔和吸头点位只用于验证过滤规则。
 * @returns 容量为一的公共库位对象。
 */
function materialSite(
  siteId: string,
  ownerMaterialId: string,
  name: string,
  allowedTemplateIds: readonly string[],
  occupiedMaterialIds: readonly string[],
  kind: MaterialSite['kind'] = 'site'
): MaterialSite {
  return {
    id: siteId,
    ownerMaterialId,
    key: siteId,
    name,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [100, 100, 100],
    capacity: 1,
    allowedTemplateIds,
    occupiedMaterialIds,
    kind
  }
}

/**
 * 构造携带公共 `sort_order` 投影的库位（Site）测试事实。
 *
 * @param siteId 库位稳定 UUID。
 * @param ownerMaterialId 直接所有者物料 UUID。
 * @param name 库位显示名称。
 * @param allowedTemplateIds 兼容资源模板 UUID 集合。
 * @param occupiedMaterialIds 当前占用物料 UUID 集合。
 * @param sortOrder 公共物料图发布的业务排序值。
 * @returns 带排序事实的容量一库位。
 * @throws 无。
 */
function materialSiteWithSortOrder(
  siteId: string,
  ownerMaterialId: string,
  name: string,
  allowedTemplateIds: readonly string[],
  occupiedMaterialIds: readonly string[],
  sortOrder: number
): MaterialSite & { sortOrder: number } {
  return {
    ...materialSite(
      siteId,
      ownerMaterialId,
      name,
      allowedTemplateIds,
      occupiedMaterialIds
    ),
    sortOrder
  }
}
