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
  return (
    <section className={clsx(materialStyles['lab-ui-material-sites'], className)}>
      <h3>库位</h3>
      <SitePicker
        sites={sites}
        variant="inspector"
        selectedSiteUuid={selectedSiteUuid}
        emptyDescription={emptyDescription}
        onSelectSite={onSelectSite}
        onSelectOccupiedMaterial={onSelectOccupiedMaterial}
      />
    </section>
  )
}
