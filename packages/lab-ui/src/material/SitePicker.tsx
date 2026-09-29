import { EmptyState } from '@unilab/design-v2'
import type { SiteSummary } from '@unilab-fe/core'

export interface SitePickerProps {
  readonly sites: readonly SiteSummary[]
  readonly selectedSiteUuid?: string
  readonly onSelectSite?: (siteUuid: string) => void
  readonly disabled?: boolean
  readonly emptyDescription?: string
  /** 物料详情页的兼容外观；不改变库位选择语义。 */
  readonly variant?: 'default' | 'inspector'
}

/** 库位选择语义组件，不执行 attach、move 或 detach 命令。 */
export function SitePicker({
  sites,
  selectedSiteUuid,
  onSelectSite,
  disabled = false,
  emptyDescription = '暂无可用库位',
  variant = 'default',
}: SitePickerProps) {
  if (sites.length === 0) {
    return (
      <div className="lab-ui-empty-region">
        <EmptyState
          scene="no-data"
          size={variant === 'default' ? 'default' : 'compact'}
          title={emptyDescription}
        />
      </div>
    )
  }

  return (
    <div
      className={`lab-ui-site-picker${variant === 'inspector' ? ' lab-ui-site-picker--inspector' : ''}`}
      role="listbox"
      aria-label="库位选择"
    >
      {sites.map((site) => (
        <SitePickerItem
          key={site.siteUuid}
          site={site}
          selected={site.siteUuid === selectedSiteUuid}
          disabled={disabled}
          variant={variant}
          onSelect={onSelectSite}
        />
      ))}
    </div>
  )
}

function SitePickerItem({
  site,
  selected,
  disabled,
  variant,
  onSelect,
}: {
  readonly site: SiteSummary
  readonly selected: boolean
  readonly disabled: boolean
  readonly variant: NonNullable<SitePickerProps['variant']>
  readonly onSelect?: (siteUuid: string) => void
}) {
  const occupancy = occupancyLabel(site)
  const displayName = site.name || site.key || site.siteUuid
  const isInspector = variant === 'inspector'

  return (
    <button
      key={site.siteUuid}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={`lab-ui-site-picker__item${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect?.(site.siteUuid)}
    >
      {isInspector ? (
        <span className="lab-ui-site-picker__content">
          <strong>{displayName}</strong>
          <span className={`lab-ui-site-picker__status is-${occupancy.kind}`}>
            {occupancy.inspectorLabel}
          </span>
        </span>
      ) : (
        <span>
          <strong>{displayName}</strong>
          {site.key && site.key !== site.name && <small>{site.key}</small>}
        </span>
      )}
      {!isInspector && (
        <span className={`lab-ui-site-picker__status is-${occupancy.kind}`}>
          {occupancy.label}
        </span>
      )}
      {isInspector && site.key && site.key !== displayName && (
        <span
          className={`lab-ui-site-picker__key-tag is-${occupancy.kind}`}
          title={site.key}
        >
          {site.key}
        </span>
      )}
    </button>
  )
}

function occupancyLabel(site: SiteSummary): {
  kind: 'occupied' | 'empty' | 'unknown'
  label: string
  inspectorLabel: string
} {
  if (!site.occupancy.known) {
    return { kind: 'unknown', label: '占用未知', inspectorLabel: '占用未知' }
  }
  return site.occupancy.occupiedMaterialUuid
    ? { kind: 'occupied', label: '已占用', inspectorLabel: '已占用物料' }
    : { kind: 'empty', label: '空闲', inspectorLabel: '空闲' }
}
