import { clsx } from 'clsx'
import materialStyles from '../material.module.scss'
import sharedStyles from '../shared.module.scss'
import { Icon } from '@unilab/design-v2/icons'
import type { MaterialInspectionProjection, MaterialGraphNode } from '@unilab-fe/core'
import { DefinitionList } from '../shared/DefinitionList'
import { MaterialSitePresentation } from './MaterialSitePresentation'

export interface MaterialInspectorProps {
  readonly projection: MaterialInspectionProjection
  readonly onSelectSite?: (siteUuid: string) => void
  readonly onSelectOccupiedMaterial?: (materialUuid: string) => void
}

/** 物料节点的事实展示，不包含页面导航和物料变更命令。 */
export function MaterialInspector({
  projection,
  onSelectSite,
  onSelectOccupiedMaterial,
}: MaterialInspectorProps) {
  const detail = projection.node.material
  const selectedSite = projection.selectedSite?.siteUuid ?? projection.currentSite?.siteUuid

  return (
    <aside
      className={clsx(materialStyles['lab-ui-material-inspector'])}
      aria-label={`${detail.name} 物料详情`}
    >
      <header className={clsx(materialStyles['lab-ui-material-inspector__header'])}>
        <span
          className={clsx(materialStyles['lab-ui-material-inspector__icon'])}
          aria-hidden="true"
        >
          <Icon name="shapes/cube-03" color="primary" size={22} />
        </span>
        <div>
          <span className={clsx(sharedStyles['lab-ui-eyebrow'])}>物料</span>
          <h2>{detail.name || detail.materialUuid}</h2>
        </div>
      </header>
      <MaterialFacts node={projection.node} />
      <MaterialSitePresentation
        sites={projection.sites}
        selectedSiteUuid={selectedSite}
        onSelectSite={onSelectSite}
        onSelectOccupiedMaterial={(materialUuid) => onSelectOccupiedMaterial?.(materialUuid)}
      />
    </aside>
  )
}

function MaterialFacts({ node }: { readonly node: MaterialGraphNode }) {
  const detail = node.material
  return (
    <DefinitionList
      className={clsx(materialStyles['lab-ui-definition'])}
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
