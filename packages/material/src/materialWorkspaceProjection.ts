import type { MaterialTemplateSummary } from './templateMaterial'
import type {
  MaterialAggregate,
  MaterialId,
  MaterialPlacement
} from './types'

export type MaterialWorkspaceView =
  | 'catalog'
  | 'spatial'
  | 'history'

export interface MaterialWorkspaceSummary {
  graphNodeCount: number
  resourceTemplateCount: number
  batchGroupCount: number
  physicalSiteCount: number
  occupiedPhysicalSiteCount: number
  batchCoveredCount: number
  trackedInstanceCount: number
  placedInstanceCount: number
  unbatchedInstanceCount: number
}

export interface MaterialWorkspaceRow {
  id: MaterialId
  name: string
  code: string
  templateId: string
  templateName: string
  batch: string | null
  placementLabel: string
  placed: boolean
  physicalSiteCount: number
  internalContainerCount: number
  revision: number
  updatedAt: string
}

export interface MaterialWorkspaceLotGroup {
  key: string
  batch: string | null
  templateId: string
  templateName: string
  rows: readonly MaterialWorkspaceRow[]
  placedCount: number
}

export interface MaterialWorkspaceTemplateGroup {
  template: MaterialTemplateSummary
  rows: readonly MaterialWorkspaceRow[]
  batches: readonly MaterialWorkspaceLotGroup[]
}

export interface MaterialWorkspaceProjection {
  summary: MaterialWorkspaceSummary
  templates: readonly MaterialWorkspaceTemplateGroup[]
  rows: readonly MaterialWorkspaceRow[]
  lotGroups: readonly MaterialWorkspaceLotGroup[]
}

/**
 * 从唯一物料聚合（MaterialAggregate）投影物料中心的只读业务视图。
 *
 * @param aggregatesById 以物料 UUID 为键的当前权威图前端投影。
 * @param templates 当前资源模板（ResourceTemplate）目录摘要；缺失分类的聚合不会进入实例台账。
 * @returns 实例、批次字段、位置与库位摘要；不推断库存可用性或任务预留。
 */
export function projectMaterialWorkspace(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  templates: readonly MaterialTemplateSummary[]
): MaterialWorkspaceProjection {
  const templateById = new Map(
    templates.map((template) => [template.uuid, template])
  )
  const resourceTemplateIds = new Set(
    templates
      .filter((template) => template.kind === 'resource')
      .map((template) => template.uuid)
  )
  const aggregates = Object.values(aggregatesById)
  const trackedAggregates = aggregates.filter((aggregate) => (
    aggregate.material.component?.managedByParent !== true &&
    resourceTemplateIds.has(aggregate.material.sourceTemplateId)
  ))
  const rows = trackedAggregates
    .map((aggregate) => projectMaterialWorkspaceRow(
      aggregate,
      aggregatesById,
      templateById.get(aggregate.material.sourceTemplateId)
    ))
    .sort(compareWorkspaceRows)
  const physicalSites = aggregates.flatMap((aggregate) =>
    aggregate.sites.filter(isPhysicalSite)
  )
  const lotGroups = groupMaterialWorkspaceLots(rows)
  const templateGroups = templates
    .filter((template) => template.kind === 'resource')
    .map((template) => {
      const templateRows = rows.filter((row) => row.templateId === template.uuid)
      return {
        template,
        rows: templateRows,
        batches: lotGroups.filter((group) => group.templateId === template.uuid)
      }
    })
    .sort((left, right) => (
      right.rows.length - left.rows.length ||
      left.template.displayName.localeCompare(right.template.displayName, 'zh-CN')
    ))

  return {
    summary: {
      graphNodeCount: aggregates.length,
      resourceTemplateCount: templateGroups.length,
      batchGroupCount: lotGroups.filter((group) => group.batch !== null).length,
      physicalSiteCount: physicalSites.length,
      occupiedPhysicalSiteCount: physicalSites.filter((site) =>
        site.occupiedMaterialIds.length > 0
      ).length,
      batchCoveredCount: rows.filter((row) => row.batch !== null).length,
      trackedInstanceCount: rows.length,
      placedInstanceCount: rows.filter((row) => row.placed).length,
      unbatchedInstanceCount: rows.filter((row) => row.batch === null).length
    },
    templates: templateGroups,
    rows,
    lotGroups
  }
}

/**
 * 将一个具体物料实例投影为实例台账行。
 *
 * @param aggregate 当前具体物料的权威聚合投影。
 * @param aggregatesById 物料 UUID 到聚合的索引，用于解析直接位置名称。
 * @param template 该物料来源模板的可选目录摘要。
 * @returns 不含库存可用性和任务状态的实例台账行。
 */
function projectMaterialWorkspaceRow(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  template: MaterialTemplateSummary | undefined
): MaterialWorkspaceRow {
  return {
    id: aggregate.material.id,
    name: aggregate.material.name,
    code: aggregate.material.code,
    templateId: aggregate.material.sourceTemplateId,
    templateName: template?.displayName ?? aggregate.material.sourceTemplateId,
    batch: materialBatch(aggregate.material.config),
    placementLabel: materialWorkspacePlacementLabel(
      aggregate.placement,
      aggregatesById
    ),
    placed: aggregate.placement.kind !== 'unplaced',
    physicalSiteCount: aggregate.sites.filter(isPhysicalSite).length,
    internalContainerCount: aggregate.sites.filter((site) =>
      site.kind === 'well' || site.kind === 'tip-spot'
    ).length,
    revision: aggregate.revision,
    updatedAt: aggregate.material.updatedAt
  }
}

/**
 * 从物料实例配置读取当前兼容批次字段。
 *
 * @param config 物料实例配置；当前只有 `batch` 是已知兼容字段。
 * @returns 非空批次文本；正式批次（Lot）实体未接入时返回 null。
 */
function materialBatch(config: Readonly<Record<string, unknown>>): string | null {
  const batch = config.batch
  return typeof batch === 'string' && batch.trim()
    ? batch.trim()
    : null
}

/**
 * 将物料放置关系翻译为可扫描的位置文本。
 *
 * @param placement 当前物料放置关系。
 * @param aggregatesById 物料图索引，用于解析父物料和库位名称。
 * @returns 面向用户的位置摘要，不改变库位占用（SiteOccupancy）事实。
 */
export function materialWorkspacePlacementLabel(
  placement: MaterialPlacement,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): string {
  if (placement.kind === 'unplaced') return '未放置'
  if (placement.kind === 'world') return '实验室坐标'
  const parent = aggregatesById[placement.parentId]
  const parentLabel = parent?.material.name ?? placement.parentId
  if (placement.kind === 'parent') return parentLabel
  const site = parent?.sites.find((candidate) =>
    candidate.id === placement.siteId
  )
  return `${parentLabel} / ${site?.name ?? placement.siteId}`
}

/**
 * 按资源模板与兼容批次字段组织批次追溯投影。
 *
 * @param rows 已按业务名称排序的实例台账行。
 * @returns 稳定排序的批次分组；未记录批次的实例不会被隐藏。
 */
function groupMaterialWorkspaceLots(
  rows: readonly MaterialWorkspaceRow[]
): readonly MaterialWorkspaceLotGroup[] {
  const groups = new Map<string, MaterialWorkspaceLotGroup>()
  for (const row of rows) {
    const key = `${row.templateId}::${row.batch ?? ''}`
    const group = groups.get(key)
    if (group) {
      groups.set(key, { ...group, rows: [...group.rows, row] })
      continue
    }
    groups.set(key, {
      key,
      batch: row.batch,
      templateId: row.templateId,
      templateName: row.templateName,
      rows: [row],
      placedCount: row.placed ? 1 : 0
    })
  }
  for (const [key, group] of groups) {
    groups.set(key, {
      ...group,
      placedCount: group.rows.filter((row) => row.placed).length
    })
  }
  return [...groups.values()].sort((left, right) => (
    left.templateName.localeCompare(right.templateName, 'zh-CN') ||
    compareBatchDescending(left.batch, right.batch)
  ))
}

/** 最近批次优先，未分批实例始终放在正式批次分组之后。 */
function compareBatchDescending(
  left: string | null,
  right: string | null
): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return right.localeCompare(left, 'zh-CN')
}

/** 判断一个展示位是否属于长期物理库位（Site）摘要。 */
function isPhysicalSite(site: MaterialAggregate['sites'][number]): boolean {
  return site.kind !== 'well' && site.kind !== 'tip-spot'
}

/** 按名称、代码与 UUID 稳定排序实例台账行。 */
function compareWorkspaceRows(
  left: MaterialWorkspaceRow,
  right: MaterialWorkspaceRow
): number {
  return left.name.localeCompare(right.name, 'zh-CN') ||
    left.code.localeCompare(right.code) || left.id.localeCompare(right.id)
}
