import { cx } from './materialClassNames'
import { type NodeProps } from 'reactflow'
import { AppIcon } from '../../components/ui/Icon'
import {
  compactName,
  gridShape,
  isMaterialSiteSelected,
  type BlockNodeData,
  type GroupNodeData,
} from './materialFlowModel'

export function ResourceGroupNode({ data }: NodeProps<GroupNodeData>) {
  return (
    <div
      className={cx(
        `material-flow-group ${data.selected ? 'is-selected' : ''} ${data.highlighted ? 'is-search-match' : ''} ${data.hasSearch && !data.highlighted ? 'is-search-dimmed' : ''} nodrag nopan`,
      )}
    >
      <button
        type="button"
        className={cx('material-flow-group__header')}
        onClick={(event) => {
          event.stopPropagation()
          data.onSelect?.({ kind: 'node', nodeId: data.selectionId })
        }}
      >
        <span className={cx('material-flow-group__icon')}>
          <AppIcon
            name={data.kind === 'device' ? 'development/cpu-chip-01' : 'shapes/cube-03'}
            size={16}
          />
        </span>
        <div>
          <strong>{data.name}</strong>
          <small>
            {data.kind === 'device' ? '设备' : '资源台面'} · {data.materialCount} 个物料 ·{' '}
            {data.siteCount} 个库位
          </small>
        </div>
      </button>
    </div>
  )
}

export function ResourceBlockNode({ data }: NodeProps<BlockNodeData>) {
  const {
    sites,
    occupantBySite,
    selectedId,
    selectedSiteId,
    selectionId,
    label,
    typeLabel,
    hasSearch,
    highlighted,
    highlightedIds,
    onSelect,
  } = data
  const grid = gridShape(sites)
  const occupied = sites.filter((site) => Boolean(occupantBySite.get(site.siteUuid))).length
  return (
    <div
      className={cx(
        `material-flow-block ${highlighted ? 'is-search-match' : ''} ${hasSearch && !highlighted ? 'is-search-dimmed' : ''}`,
      )}
    >
      <button
        type="button"
        className={cx('material-flow-block__header')}
        onClick={(event) => {
          event.stopPropagation()
          onSelect({ kind: 'node', nodeId: selectionId })
        }}
      >
        <div>
          <strong>{label}</strong>
          <small>
            {occupied}/{sites.length} 有料
          </small>
        </div>
        <span className={cx('material-flow-block__type')}>{typeLabel}</span>
      </button>
      <div
        className={cx('material-flow-block__grid')}
        style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
      >
        {sites.map((site) => {
          const occupant = occupantBySite.get(site.siteUuid)
          const active = isMaterialSiteSelected(
            site.siteUuid,
            occupant?.materialUuid,
            selectedId,
            selectedSiteId,
          )
          const siteHighlighted = Boolean(
            occupant && hasSearch && highlightedIds.has(occupant.materialUuid),
          )
          return (
            <button
              type="button"
              key={site.siteUuid}
              className={cx(
                `material-flow-site ${occupant ? 'is-occupied' : 'is-empty'} ${active ? 'is-selected' : ''} ${siteHighlighted ? 'is-search-match' : ''} ${hasSearch && !highlighted && !siteHighlighted ? 'is-search-dimmed' : ''} nodrag nopan`,
              )}
              title={occupant ? `${site.name} · ${occupant.name}` : `${site.name} · 空库位`}
              aria-label={occupant ? `${site.name} · ${occupant.name}` : `${site.name} · 空库位`}
              data-selected={active ? 'true' : undefined}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onSelect(
                  occupant
                    ? { kind: 'material', materialId: occupant.materialUuid, siteId: site.siteUuid }
                    : { kind: 'site', siteId: site.siteUuid },
                )
              }}
            >
              <strong>{site.key || site.name}</strong>
              <small>{occupant ? compactName(occupant.name) : '空'}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
