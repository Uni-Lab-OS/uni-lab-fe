import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { SitePicker } from './SitePicker'

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
      className="lab-ui-material-inspector"
      aria-label={`${detail.name} 物料详情`}
    >
      <header className="lab-ui-material-inspector__header">
        <div>
          <span className="lab-ui-eyebrow">物料</span>
          <h2>{detail.name || detail.materialUuid}</h2>
        </div>
        <span className="lab-ui-identity">{detail.materialUuid}</span>
      </header>
      <MaterialFacts node={node} />
      <section className="lab-ui-material-inspector__sites">
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
    <dl className="lab-ui-definition-list">
      <div>
        <dt>物料类型</dt>
        <dd>{detail.materialType || '未提供'}</dd>
      </div>
      <div>
        <dt>资源模板</dt>
        <dd>{node.resourceTemplate?.displayName || '未提供'}</dd>
      </div>
      <div>
        <dt>条码</dt>
        <dd>{detail.barcode || '未提供'}</dd>
      </div>
      <div>
        <dt>当前库位</dt>
        <dd>{node.currentSiteUuid || '未绑定库位'}</dd>
      </div>
    </dl>
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
    <div className="lab-ui-material-inspector__occupants">
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
