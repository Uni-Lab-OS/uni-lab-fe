import MenuUnfoldOutlined from '@ant-design/icons/MenuUnfoldOutlined'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'

import { useMaterialStore } from './MaterialStoreProvider'
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
  onSelectionChange
}: MaterialTreeSidebarProps): React.JSX.Element {
  const [open, setOpen] = useState(initialMaterialTreeOpen)
  const reopenButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousOpenRef = useRef(open)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<MaterialId>>(
    new Set()
  )
  const [query, setQuery] = useState('')
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
  const searchActive = query.trim().length > 0
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

  useEffect(() => {
    if (previousOpenRef.current === open) return
    const target = open ? closeButtonRef.current : reopenButtonRef.current
    previousOpenRef.current = open
    target?.focus()
  }, [open])

  useEffect(() => {
    if (!open || !isMobileMaterialViewport()) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      globalThis.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (!open) {
    return (
      <button
        ref={reopenButtonRef}
        type="button"
        className={materialScopeClassName(
          'material-tree-sidebar__reopen'
        )}
        aria-label="展开物料列表"
        aria-controls="material-tree-sidebar"
        onClick={() => setOpen(true)}
      >
        <MenuUnfoldOutlined aria-hidden="true" />
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        className={materialScopeClassName(
          'material-tree-sidebar__backdrop'
        )}
        aria-label="关闭物料列表"
        onClick={() => setOpen(false)}
      />
      <aside
        id="material-tree-sidebar"
        className={materialScopeClassName('material-tree-sidebar')}
        aria-label="物料目录"
      >
      <header>
        <div>
          <span>物料列表</span>
          <strong>({Object.keys(aggregatesById).length})</strong>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="收起物料列表"
          onClick={() => setOpen(false)}
        >
          <PanelCloseIcon />
        </button>
      </header>
      <label className="material-tree-sidebar__search">
        <SearchIcon />
        <span className="material-tree-sidebar__visually-hidden">
          检索物料、设备或库位
        </span>
        <input
          type="search"
          value={query}
          placeholder="检索物料、设备或库位"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="清除物料检索"
            onClick={() => setQuery('')}
          >
            ×
          </button>
        ) : null}
      </label>
      <div
        className="material-tree-sidebar__legend"
        aria-label="库位状态说明"
      >
        <span>
          <i
            className="material-tree-sidebar__site-status is-occupied"
            aria-hidden="true"
          />
          已占用
        </span>
        <span>
          <i
            className="material-tree-sidebar__site-status is-empty"
            aria-hidden="true"
          />
          未占用
        </span>
      </div>
      <div className="material-tree-sidebar__tree" role="tree">
        {filteredEntries.length === 0 ? (
          <p role="status">
            {entries.length === 0
              ? '暂无物料'
              : `没有与“${query.trim()}”匹配的物料或库位`}
          </p>
        ) : (
          filteredEntries.map((entry) => (
            <MaterialTreeRow
              key={entry.aggregate.material.id}
              depth={0}
              entry={entry}
              expandedIds={expandedIds}
              forceExpanded={searchActive}
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
    </>
  )
}

export function initialMaterialTreeOpen(): boolean {
  return !isMobileMaterialViewport()
}

function isMobileMaterialViewport(): boolean {
  return typeof globalThis.matchMedia !== 'function'
    ? false
    : globalThis.matchMedia('(max-width: 720px)').matches
}

function MaterialTreeRow({
  entry,
  depth,
  expandedIds,
  forceExpanded,
  selectedIds,
  onSelect,
  onToggle
}: {
  entry: MaterialTreeEntry
  depth: number
  expandedIds: ReadonlySet<MaterialId>
  forceExpanded: boolean
  selectedIds: ReadonlySet<MaterialId>
  onSelect: (materialId: MaterialId) => void
  onToggle: (materialId: MaterialId) => void
}): React.JSX.Element {
  const materialId = entry.aggregate.material.id
  const hasChildren = entry.children.length > 0
  const expanded = hasChildren && (
    forceExpanded || expandedIds.has(materialId)
  )
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
                forceExpanded={forceExpanded}
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

/**
 * 按物料、设备与库位的公开标识过滤树，并保留命中节点的祖先路径。
 *
 * @param entries 已构建的物料目录树。
 * @param query 用户输入的检索词；空白查询返回原树。
 * @returns 可直接渲染的只读过滤树，不修改原节点。
 */
export function filterMaterialTree(
  entries: readonly MaterialTreeEntry[],
  query: string
): readonly MaterialTreeEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return entries

  /** 判断一个公开字符串字段是否包含规范化检索词。 */
  const matches = (value: string | undefined): boolean =>
    Boolean(value?.toLocaleLowerCase().includes(normalizedQuery))

  /** 递归保留自身命中、库位命中或包含后代命中的物料节点。 */
  const filterEntry = (entry: MaterialTreeEntry): MaterialTreeEntry | null => {
    const material = entry.aggregate.material
    const ownMatch = [
      material.id,
      material.code,
      material.name,
      material.description,
      material.sourceTemplateId,
      material.component?.key,
      entry.occupyingSite?.id,
      entry.occupyingSite?.key,
      entry.occupyingSite?.name
    ].some(matches)
    if (ownMatch) return entry

    const children = entry.children.flatMap((child): MaterialTreeNode[] => {
      if (child.kind === 'material') {
        const filtered = filterEntry(child)
        return filtered ? [filtered] : []
      }
      return [child.site.id, child.site.key, child.site.name].some(matches)
        ? [child]
        : []
    })
    return children.length > 0 ? { ...entry, children } : null
  }

  return entries.flatMap((entry) => {
    const filtered = filterEntry(entry)
    return filtered ? [filtered] : []
  })
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

/** 返回与现有图标体系一致的检索图标。 */
function SearchIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <circle cx="8" cy="8" r="4.5" />
      <path d="m11.5 11.5 3 3" />
    </svg>
  )
}
