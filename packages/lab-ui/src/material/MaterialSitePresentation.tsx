import { clsx } from 'clsx'
import type { SiteSummary } from '@unilab-fe/core'
import materialStyles from '../material.module.scss'
import { SitePicker } from './SitePicker'

export interface MaterialSitePresentationProps {
  readonly sites: readonly SiteSummary[]
  readonly selectedSiteUuid?: string
  readonly emptyDescription?: string
  readonly onSelectSite?: (siteUuid: string) => void
  readonly onSelectOccupiedMaterial?: (materialUuid: string, siteUuid: string) => void
  readonly className?: string
}

/**
 * 只读展示 Material 的库位与占用关系。页面负责把稳定 id 接回自己的 selection。
 */
export function MaterialSitePresentation({
  sites,
  selectedSiteUuid,
  emptyDescription = '没有库位信息',
  onSelectSite,
  onSelectOccupiedMaterial,
  className,
}: MaterialSitePresentationProps) {
  const occupiedSites = sites.filter((site) => Boolean(site.occupancy.occupiedMaterialUuid))
  return (
    <section className={clsx(materialStyles['lab-ui-material-sites'], className)}>
      <h3>库位</h3>
      <SitePicker
        sites={sites}
        variant="inspector"
        selectedSiteUuid={selectedSiteUuid}
        emptyDescription={emptyDescription}
        onSelectSite={onSelectSite}
      />
      {occupiedSites.length > 0 && (
        <div className={clsx(materialStyles['lab-ui-material-sites__occupants'])}>
          {occupiedSites.map((site) => {
            const materialUuid = site.occupancy.occupiedMaterialUuid
            if (!materialUuid) return null
            return (
              <button
                key={`${site.siteUuid}-occupant`}
                type="button"
                onClick={() => onSelectOccupiedMaterial?.(materialUuid, site.siteUuid)}
              >
                查看 {site.name || site.key} 中的物料
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
