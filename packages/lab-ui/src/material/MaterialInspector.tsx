import { Icon } from '@unilab/design-v2/icons'
import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { SitePicker } from './SitePicker'
import { DefinitionList } from '../shared/DefinitionList'

import { cx } from '../classNames'
export interface MaterialInspectorProps {
  readonly node: MaterialGraphNode
  readonly selectedSiteUuid?: string
  readonly onSelectSite?: (siteUuid: string) => void
  readonly onSelectOccupiedMaterial?: (materialUuid: string) => void
}

/** 物料节点的事实展示，不包含页面导航和物料变更命令。 */
export function MaterialInspector({
  node,
  selectedSiteUuid,
  onSelectSite,
  onSelectOccupiedMaterial,
}: MaterialInspectorProps) {
  const detail = node.material
  const selectedSite = selectedSiteUuid ?? node.currentSiteUuid ?? undefined
  const occupiedSites = node.sites.filter(
    (site) => site.occupancy.occupiedMaterialUuid,
  )

  return (
    <aside
      className={cx('lab-ui-material-inspector')}
      aria-label={`${detail.name} 物料详情`}
    >
      <header className={cx('lab-ui-material-inspector__header')}>
        <span className={cx('lab-ui-material-inspector__icon')} aria-hidden="true">
          <Icon name="shapes/cube-03" color="primary" size={22} />
        </span>
        <div>
          <span className={cx('lab-ui-eyebrow')}>物料</span>
          <h2>{detail.name || detail.materialUuid}</h2>
        </div>
      </header>
      <MaterialFacts node={node} />
      <section className={cx('lab-ui-material-inspector__sites')}>
        <h3>库位</h3>
        <SitePicker
          sites={node.sites}
          selectedSiteUuid={selectedSite}
          onSelectSite={onSelectSite}
        />
        {occupiedSites.length > 0 && (
          <OccupiedMaterialList
            sites={occupiedSites}
            onSelectMaterial={onSelectOccupiedMaterial}
          />
        )}
      </section>
    </aside>
  )
}

function MaterialFacts({ node }: { readonly node: MaterialGraphNode }) {
  const detail = node.material
  return (
    <DefinitionList
      className={cx('lab-ui-definition-list')}
      items={[
        { label: '物料 ID', value: detail.materialUuid, mono: true },
        { label: '物料类型', value: detail.materialType },
        { label: '资源模板', value: node.resourceTemplate?.displayName },
        { label: '条码', value: detail.barcode, mono: true },
        { label: '当前库位', value: node.currentSiteUuid, missingText: '未绑定库位', mono: true },
      ]}
    />
  )
}

function OccupiedMaterialList({
  sites,
  onSelectMaterial,
}: {
  readonly sites: readonly SiteSummary[]
  readonly onSelectMaterial?: (materialUuid: string) => void
}) {
  return (
    <div className={cx('lab-ui-material-inspector__occupants')}>
      {sites.map((site) => {
        const materialUuid = site.occupancy.occupiedMaterialUuid
        if (!materialUuid) return null
        return (
          <button
            key={`${site.siteUuid}-occupant`}
            type="button"
            onClick={() => onSelectMaterial?.(materialUuid)}
          >
            查看 {site.name || site.key} 中的物料
          </button>
        )
      })}
    </div>
  )
}
