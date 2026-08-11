import MenuUnfoldOutlined from '@ant-design/icons/MenuUnfoldOutlined'
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { useMaterialStore } from './MaterialStoreProvider'
import {
  countMaterialEntries,
  filterMaterialTree
} from './materialTreeQuery'
import { materialScopeClassName } from './materialStyles'
import type {
  MaterialAggregate,
  MaterialId,
  MaterialPlacement,
  MaterialSite
} from './types'

export interface MaterialTreeSidebarProps {
  selectedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  catalogStatus?: CapabilityStatus
  onRequestCreate?: () => void
}

export interface MaterialTreeEntry {
  kind: 'material'
  aggregate: MaterialAggregate
  occupyingSite?: MaterialSite
  children: readonly MaterialTreeNode[]
}

export interface MaterialTreeSiteEntry {
  kind: 'empty-site'
  ownerMaterialId: MaterialId
  site: MaterialSite
}

export type MaterialTreeNode = MaterialTreeEntry | MaterialTreeSiteEntry

export function MaterialTreeSidebar({
  selectedMaterialIds = [],
  onSelectionChange,
  catalogStatus = { available: false, reason: '当前模板目录不可用' },
  onRequestCreate
}: MaterialTreeSidebarProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<MaterialId>>(
    new Set()
  )
  const aggregatesById = useMaterialStore(
    (state) => state.aggregatesById
  )
  const graphIndex = useMaterialStore((state) => state.graphIndex)
  const entries = useMemo(
    () => buildMaterialTree(aggregatesById, graphIndex.childrenByParentId),
    [aggregatesById, graphIndex.childrenByParentId]
  )
  const filteredEntries = useMemo(
    () => filterMaterialTree(entries, query),
    [entries, query]
  )
  const visibleMaterialCount = useMemo(
    () => countMaterialEntries(filteredEntries),
    [filteredEntries]
  )
  const selected = new Set(selectedMaterialIds)

  useEffect(() => {
    if (selectedMaterialIds.length === 0) return
    setExpandedIds((current) => {
      const next = new Set(current)
      for (const materialId of selectedMaterialIds) {
        let aggregate = aggregatesById[materialId]
        while (aggregate) {
          const parentId = placementParentId(aggregate.placement)
          if (!parentId) break
          next.add(parentId)
          aggregate = aggregatesById[parentId]
        }
      }
      return next
    })
  }, [aggregatesById, selectedMaterialIds])

  if (!open) {
    return (
      <button
        type="button"
        className={materialScopeClassName(
          'material-tree-sidebar__reopen'
        )}
        aria-label="展开物料列表"
        onClick={() => setOpen(true)}
      >
        <MenuUnfoldOutlined aria-hidden="true" />
      </button>
    )
  }

  return (
    <aside
      className={materialScopeClassName('material-tree-sidebar')}
    >
      <header>
        <div>
          <span>物料列表</span>
          <strong>({Object.keys(aggregatesById).length})</strong>
        </div>
        <div className="material-tree-sidebar__header-actions">
          <button
            type="button"
            className="material-tree-sidebar__create"
            disabled={!catalogStatus.available}
            title={
              catalogStatus.available
                ? '从资源模板新建物料'
                : catalogStatus.reason
            }
            onClick={onRequestCreate}
          >
            <PlusIcon />
            <span>新建</span>
          </button>
          <button
            type="button"
            aria-label="收起物料列表"
            onClick={() => setOpen(false)}
          >
            <PanelCloseIcon />
          </button>
        </div>
      </header>
      <div className="material-tree-sidebar__query">
        <label>
          <SearchIcon />
          <input
            type="search"
            value={query}
            aria-label="查询物料"
            placeholder="名称、代码、UUID 或库位"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {query.trim() ? (
          <small role="status">找到 {visibleMaterialCount} 个物料</small>
        ) : !catalogStatus.available && catalogStatus.reason ? (
          <small className="is-warning">
            新建不可用：{catalogStatus.reason}
          </small>
        ) : null}
      </div>
      <div className="material-tree-sidebar__tree" role="tree">
        {entries.length === 0 ? (
          <p>暂无物料</p>
        ) : filteredEntries.length === 0 ? (
          <p>没有匹配的物料或库位</p>
        ) : (
          filteredEntries.map((entry) => (
            <MaterialTreeRow
              key={entry.aggregate.material.id}
              depth={0}
              entry={entry}
              expandedIds={expandedIds}
              selectedIds={selected}
              onSelect={(materialId) =>
                onSelectionChange?.([materialId])
              }
              onToggle={(materialId) => {
                setExpandedIds((current) => {
                  const next = new Set(current)
                  if (next.has(materialId)) next.delete(materialId)
                  else next.add(materialId)
                  return next
                })
              }}
            />
          ))
        )}
      </div>
      <div
        className="material-tree-sidebar__resize-hint"
        aria-hidden="true"
      />
    </aside>
  )
}

function MaterialTreeRow({
  entry,
  depth,
  expandedIds,
  selectedIds,
  onSelect,
  onToggle
}: {
  entry: MaterialTreeEntry
  depth: number
  expandedIds: ReadonlySet<MaterialId>
  selectedIds: ReadonlySet<MaterialId>
  onSelect: (materialId: MaterialId) => void
  onToggle: (materialId: MaterialId) => void
}): React.JSX.Element {
  const materialId = entry.aggregate.material.id
  const hasChildren = entry.children.length > 0
  const expanded = hasChildren && expandedIds.has(materialId)
  const rowStyle = {
    '--material-tree-depth': depth
  } as CSSProperties

  return (
    <>
      <div
        className="material-tree-sidebar__row"
        data-material-tree-id={materialId}
        data-material-tree-site-id={entry.occupyingSite?.id}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        aria-selected={selectedIds.has(materialId)}
        style={rowStyle}
      >
        <span className="material-tree-sidebar__grip" aria-hidden="true">
          ⠿
        </span>
        {hasChildren ? (
          <button
            type="button"
            className="material-tree-sidebar__toggle"
            aria-label={`${expanded ? '收起' : '展开'} ${entry.aggregate.material.name}`}
            onClick={() => onToggle(materialId)}
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : (
          <span className="material-tree-sidebar__toggle-spacer" />
        )}
        <button
          type="button"
          className="material-tree-sidebar__label"
          title={entry.aggregate.material.name}
          onClick={() => onSelect(materialId)}
        >
          {entry.aggregate.material.name}
        </button>
        {entry.occupyingSite ? (
          <SiteStatus site={entry.occupyingSite} occupied />
        ) : null}
      </div>
      {expanded
        ? entry.children.map((child) =>
            child.kind === 'material' ? (
              <MaterialTreeRow
                key={child.aggregate.material.id}
                depth={depth + 1}
                entry={child}
                expandedIds={expandedIds}
                selectedIds={selectedIds}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ) : (
              <MaterialTreeEmptySiteRow
                key={child.site.id}
                depth={depth + 1}
                entry={child}
              />
            )
          )
        : null}
    </>
  )
}

function MaterialTreeEmptySiteRow({
  entry,
  depth
}: {
  entry: MaterialTreeSiteEntry
  depth: number
}): React.JSX.Element {
  return (
    <div
      className="material-tree-sidebar__row material-tree-sidebar__row--site"
      data-material-tree-site-id={entry.site.id}
      data-site-occupancy="empty"
      role="treeitem"
      aria-label={`${entry.site.name}，未占用`}
      aria-level={depth + 1}
      style={{ '--material-tree-depth': depth } as CSSProperties}
    >
      <span className="material-tree-sidebar__grip" aria-hidden="true" />
      <span className="material-tree-sidebar__toggle-spacer" />
      <span
        className="material-tree-sidebar__site-label"
        title={entry.site.name}
      >
        {entry.site.name}
      </span>
      <SiteStatus site={entry.site} occupied={false} />
    </div>
  )
}

function SiteStatus({
  site,
  occupied
}: {
  site: MaterialSite
  occupied: boolean
}): React.JSX.Element {
  const state = occupied ? 'occupied' : 'empty'
  return (
    <span
      className={`material-tree-sidebar__site-status is-${state}`}
      data-site-occupancy={state}
      role="img"
      aria-label={`${site.name}，${occupied ? '已占用' : '未占用'}`}
      title={`${site.name} · ${occupied ? '已占用' : '未占用'}`}
    />
  )
}

export function buildMaterialTree(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  childrenByParentId: Readonly<Record<MaterialId, readonly MaterialId[]>>
): readonly MaterialTreeEntry[] {
  const roots = Object.values(aggregatesById)
    .filter((aggregate) => !placementParentId(aggregate.placement))
    .sort(compareAggregates)

  const build = (
    aggregate: MaterialAggregate,
    occupyingSite?: MaterialSite
  ): MaterialTreeEntry => {
    const directChildren = (childrenByParentId[aggregate.material.id] ?? [])
      .map((materialId) => aggregatesById[materialId])
      .filter(
        (candidate): candidate is MaterialAggregate => candidate != null
      )
    const childById = new Map(
      directChildren.map((child) => [child.material.id, child])
    )
    const siteOccupantIds = new Set<MaterialId>()
    const siteNodes = aggregate.sites.map((site): MaterialTreeNode => {
      const occupantId = site.occupiedMaterialIds[0]
      const occupant = occupantId ? childById.get(occupantId) : undefined
      if (occupant) {
        siteOccupantIds.add(occupant.material.id)
        return build(occupant, site)
      }
      return {
        kind: 'empty-site',
        ownerMaterialId: aggregate.material.id,
        site
      }
    })
    const unboundChildren = directChildren
      .filter((child) => !siteOccupantIds.has(child.material.id))
      .sort(compareAggregates)
      .map((child) => build(child))
    return {
      kind: 'material',
      aggregate,
      occupyingSite,
      children: [...siteNodes, ...unboundChildren]
    }
  }

  return roots.map((aggregate) => build(aggregate))
}

function compareAggregates(
  left: MaterialAggregate,
  right: MaterialAggregate
): number {
  return (
    left.material.name.localeCompare(right.material.name, 'zh-CN') ||
    left.material.id.localeCompare(right.material.id)
  )
}

function placementParentId(
  placement: MaterialPlacement
): MaterialId | null {
  return placement.kind === 'parent' || placement.kind === 'site'
    ? placement.parentId
    : null
}

function ChevronIcon({
  expanded
}: {
  expanded: boolean
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={expanded ? 'is-expanded' : undefined}
      viewBox="0 0 12 12"
    >
      <path d="m4 2.5 3.5 3.5L4 9.5" />
    </svg>
  )
}

function PanelCloseIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M3 4.5h12M3 9h12M3 13.5h12M6 3v12" />
      <path d="m11 7-2 2 2 2" />
    </svg>
  )
}

/** 返回查询输入使用的线性图标。 */
function SearchIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <circle cx="8" cy="8" r="4.5" />
      <path d="m11.5 11.5 3 3" />
    </svg>
  )
}

/** 返回新建物料动作使用的加号图标。 */
function PlusIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M9 4v10M4 9h10" />
    </svg>
  )
}
