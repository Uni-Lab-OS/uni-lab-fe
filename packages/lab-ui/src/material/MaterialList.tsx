import { EmptyState } from '@unilab/design-v2'
import type { MaterialSummary } from '@unilab-fe/core'

import { cx } from '../classNames'
export interface MaterialListProps {
  readonly items: readonly MaterialSummary[]
  readonly selectedMaterialUuid?: string
  readonly onSelectMaterial?: (materialUuid: string) => void
  readonly emptyDescription?: string
}

/** 物料语义列表。搜索、分页和数据加载由场景拥有。 */
export function MaterialList({
  items,
  selectedMaterialUuid,
  onSelectMaterial,
  emptyDescription = '暂无物料',
}: MaterialListProps) {
  if (items.length === 0) {
    return (
      <div className={cx('lab-ui-empty-region')}>
        <EmptyState
          scene="no-data"
          size="compact"
          title={emptyDescription}
        />
      </div>
    )
  }

  return (
    <ul className={cx('lab-ui-material-list')} aria-label="物料列表">
      {items.map((item) => (
        <MaterialListItem
          key={item.materialUuid}
          item={item}
          selected={item.materialUuid === selectedMaterialUuid}
          onSelect={onSelectMaterial}
        />
      ))}
    </ul>
  )
}

function MaterialListItem({
  item,
  selected,
  onSelect,
}: {
  readonly item: MaterialSummary
  readonly selected: boolean
  readonly onSelect?: (materialUuid: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        className={cx('lab-ui-material-list__item', selected && 'is-selected')}
        aria-pressed={selected}
        onClick={() => onSelect?.(item.materialUuid)}
      >
        <span className={cx('lab-ui-material-list__primary')}>
          <strong>{item.name || item.materialUuid}</strong>
          <span>{item.materialType || '未分类物料'}</span>
        </span>
        <span className={cx('lab-ui-material-list__meta')}>
          {item.barcode || item.materialUuid}
        </span>
      </button>
    </li>
  )
}
