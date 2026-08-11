import type {
  MaterialTreeEntry,
  MaterialTreeNode
} from './MaterialTreeSidebar'
import type { MaterialSite } from './types'

/**
 * 按名称、代码、稳定身份、模板或库位过滤物料树，并保留命中项的祖先路径。
 * @param entries 当前物料聚合派生的树根。
 * @param query 用户输入的本地查询文本。
 * @returns 不复制领域实体的可见树投影；空查询返回原树。
 */
export function filterMaterialTree(
  entries: readonly MaterialTreeEntry[],
  query: string
): readonly MaterialTreeEntry[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  if (!needle) return entries
  return entries
    .map((entry) => filterMaterialTreeEntry(entry, needle))
    .filter((entry): entry is MaterialTreeEntry => entry !== null)
}

/**
 * 统计当前可见物料树中的物料实例数，不把库位计入数量。
 * @param entries 待统计的物料树根。
 * @returns 当前投影中的物料节点数量。
 */
export function countMaterialEntries(
  entries: readonly MaterialTreeEntry[]
): number {
  return entries.reduce(
    (total, entry) =>
      total +
      1 +
      countMaterialEntries(
        entry.children.filter(
          (child): child is MaterialTreeEntry => child.kind === 'material'
        )
      ),
    0
  )
}

/**
 * 过滤单个物料分支；父项命中时完整保留其后代，否则只保留命中后代。
 * @param entry 待检查的物料树节点。
 * @param needle 已规范化的小写查询文本。
 * @returns 命中的树节点，或在整条分支均未命中时返回 null。
 */
function filterMaterialTreeEntry(
  entry: MaterialTreeEntry,
  needle: string
): MaterialTreeEntry | null {
  const material = entry.aggregate.material
  if (
    [
      material.name,
      material.code,
      material.id,
      material.sourceTemplateId
    ].some((value) =>
      value.toLocaleLowerCase('zh-CN').includes(needle)
    ) ||
    (entry.occupyingSite
      ? siteMatchesQuery(entry.occupyingSite, needle)
      : false)
  ) {
    return entry
  }

  const children = entry.children.flatMap(
    (child): readonly MaterialTreeNode[] => {
      if (child.kind === 'material') {
        const filtered = filterMaterialTreeEntry(child, needle)
        return filtered ? [filtered] : []
      }
      return siteMatchesQuery(child.site, needle) ? [child] : []
    }
  )
  return children.length > 0 ? { ...entry, children } : null
}

/**
 * 判断库位字段是否命中当前查询。
 * @param site 物料聚合中的稳定库位。
 * @param needle 已规范化的小写查询文本。
 * @returns 名称、键或 UUID 任一命中时为 true。
 */
function siteMatchesQuery(site: MaterialSite, needle: string): boolean {
  return [site.name, site.key, site.id].some((value) =>
    value.toLocaleLowerCase('zh-CN').includes(needle)
  )
}
