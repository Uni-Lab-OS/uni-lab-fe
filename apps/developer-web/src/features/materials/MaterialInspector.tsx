import { clsx } from 'clsx'
import materialInspectorStyles from './MaterialInspector.module.scss'
import materialManagementStyles from './MaterialManagement.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Tooltip, Typography } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import type { MaterialGraphNode, MaterialInspectionProjection, SiteSummary } from '@unilab-fe/core'
import type { IconColor, IconName } from '@unilab/design-v2/icons'
import { DefinitionList, MaterialSitePresentation, StatusBadge } from '@unilab/lab-ui'
import { AppIcon } from '../../components/ui/Icon'
import { type MaterialSelection } from './MaterialFlowCanvas'
import { resolveMaterialSiteAction } from './materialSiteActions'

export function MaterialInspector({
  projection,
  selection,
  onSelect,
}: {
  projection?: MaterialInspectionProjection
  selection: MaterialSelection | null
  onSelect: (selection: MaterialSelection) => void
}) {
  if (!projection || !selection)
    return (
      <aside
        className={clsx(
          materialInspectorStyles['material-inspector'],
          materialManagementStyles['material-inspector'],
          sharedStyles['material-inspector'],
          materialInspectorStyles['material-inspector--empty'],
        )}
      >
        <EmptyState scene="no-data" title="选择节点、库位或物料查看详情" />
      </aside>
    )

  if (selection.kind === 'site' && projection.selectedSite) {
    return (
      <SiteInspector node={projection.node} site={projection.selectedSite} onSelect={onSelect} />
    )
  }

  if (selection.kind === 'node') {
    return <NodeInspector node={projection.node} sites={projection.sites} onSelect={onSelect} />
  }

  return <MaterialDetailInspector projection={projection} onSelect={onSelect} />
}

function InspectorHeading({
  icon,
  title,
  iconColor = 'primary',
}: {
  icon: IconName
  title: string
  iconColor?: IconColor
}) {
  return (
    <div className={clsx(materialInspectorStyles['inspector-heading'])}>
      <span className={clsx(materialInspectorStyles['inspector-icon'])}>
        <AppIcon name={icon} color={iconColor} size={22} />
      </span>
      <div>
        <h2>{title}</h2>
      </div>
    </div>
  )
}

function NodeInspector({
  node,
  sites,
  onSelect,
}: {
  node: MaterialGraphNode
  sites: readonly SiteSummary[]
  onSelect: (selection: MaterialSelection) => void
}) {
  const detail = node.material
  return (
    <aside
      className={clsx(
        materialInspectorStyles['material-inspector'],
        materialManagementStyles['material-inspector'],
        sharedStyles['material-inspector'],
      )}
    >
      <InspectorHeading icon="shapes/cube-03" title={detail.name} />
      <DefinitionList
        className={clsx(materialInspectorStyles['definition-list'])}
        items={[
          { label: '节点类型', value: detail.materialType },
          { label: '资源模板', value: node.resourceTemplate?.name },
          { label: '父节点', value: detail.parentMaterialUuid ?? '根节点' },
          { label: '库位数量', value: sites.length },
        ]}
      />
      <MaterialSitePresentation
        sites={sites}
        onSelectSite={(siteUuid) => onSelect({ kind: 'site', siteId: siteUuid })}
        onSelectOccupiedMaterial={(materialId, siteId) =>
          onSelect({ kind: 'material', materialId, siteId })
        }
      />
    </aside>
  )
}

function SiteInspector({
  node,
  site,
  onSelect,
}: {
  node: MaterialGraphNode
  site: SiteSummary
  onSelect: (selection: MaterialSelection) => void
}) {
  const occupied = site.occupancy.occupiedMaterialUuid
  const siteAction = resolveMaterialSiteAction(site.occupancy)
  const status = site.occupancy.known ? (occupied ? 'available' : 'empty') : 'attention'
  return (
    <aside
      className={clsx(
        materialInspectorStyles['material-inspector'],
        materialManagementStyles['material-inspector'],
        sharedStyles['material-inspector'],
      )}
    >
      <InspectorHeading
        icon="shapes/cube-03"
        title={site.name || site.key}
        iconColor={status === 'available' ? 'success' : status === 'empty' ? 'default' : 'error'}
      />
      <div className={clsx(materialInspectorStyles['material-inspector__status'])}>
        <StatusBadge
          status={status}
          label={site.occupancy.known ? (occupied ? '已占用' : '空闲') : '占用未知'}
          className={clsx(sharedStyles['status-badge'])}
        />
      </div>
      <DefinitionList
        className={clsx(materialInspectorStyles['definition-list'])}
        items={[
          { label: '所属节点', value: node.material.name },
          {
            label: '库位标识',
            value: (
              <Tooltip title={site.siteUuid}>
                <span className={clsx(materialInspectorStyles['definition-value-tooltip'])}>
                  {site.siteUuid}
                </span>
              </Tooltip>
            ),
          },
          { label: '允许资源', value: `${site.allowedResourceTemplateUuids?.length ?? 0} 种` },
          { label: '当前物料', value: occupied ?? '空库位' },
        ]}
      />
      {occupied && (
        <div className={clsx(materialInspectorStyles['inspector-section'])}>
          <Button
            type="default"
            className={clsx(materialInspectorStyles['material-inspector__button'])}
            onClick={() =>
              onSelect({ kind: 'material', materialId: occupied, siteId: site.siteUuid })
            }
          >
            查看占用物料
          </Button>
        </div>
      )}
      <SiteHandlingActions action={siteAction} />
      {siteAction === 'unavailable' && (
        <Typography.Text
          type="secondary"
          className={clsx(materialInspectorStyles['capability-note'])}
        >
          库位占用状态未知，暂不提供上下料操作。
        </Typography.Text>
      )}
    </aside>
  )
}

function MaterialDetailInspector({
  projection,
  onSelect,
}: {
  projection: MaterialInspectionProjection
  onSelect: (selection: MaterialSelection) => void
}) {
  const detail = projection.node.material
  const site = projection.activeSite
  const siteAction = site ? resolveMaterialSiteAction(site.occupancy) : 'unavailable'
  const status = !site
    ? 'empty'
    : site.occupancy.known
      ? site.occupancy.occupiedMaterialUuid
        ? 'available'
        : 'empty'
      : 'attention'
  return (
    <aside
      className={clsx(
        materialInspectorStyles['material-inspector'],
        materialManagementStyles['material-inspector'],
        sharedStyles['material-inspector'],
      )}
    >
      <InspectorHeading
        icon="layout/layers-two-01"
        title={detail.name}
        iconColor={status === 'available' ? 'success' : status === 'empty' ? 'default' : 'error'}
      />
      <div className={clsx(materialInspectorStyles['material-inspector__status'])}>
        <StatusBadge
          status={status}
          className={clsx(sharedStyles['status-badge'])}
          label={
            !site
              ? '未绑定库位'
              : site.occupancy.known
                ? site.occupancy.occupiedMaterialUuid
                  ? '已占用'
                  : '空闲'
                : '占用未知'
          }
        />
      </div>
      <DefinitionList
        className={clsx(materialInspectorStyles['definition-list'])}
        items={[
          { label: '物料类型', value: detail.materialType },
          { label: '当前库位', value: site?.name ?? '未绑定库位' },
          { label: '父物料', value: detail.parentMaterialUuid ?? '根节点' },
          { label: '修订版本', value: detail.revision },
        ]}
      />
      <MaterialSitePresentation
        sites={site ? [site] : projection.sites}
        selectedSiteUuid={site?.siteUuid}
        onSelectSite={(siteUuid) => onSelect({ kind: 'site', siteId: siteUuid })}
        onSelectOccupiedMaterial={(materialId, siteId) =>
          onSelect({ kind: 'material', materialId, siteId })
        }
      />
      <SiteHandlingActions action={siteAction} />
      <Typography.Text
        type="secondary"
        className={clsx(materialInspectorStyles['capability-note'])}
      >
        {siteAction === 'unavailable'
          ? '当前页面仅展示物料与库位状态；库位占用状态未知。'
          : '当前只展示库位允许的操作方向；统一物料命令接入后可执行。'}
      </Typography.Text>
    </aside>
  )
}

function SiteHandlingActions({ action }: { action: ReturnType<typeof resolveMaterialSiteAction> }) {
  if (action === 'unavailable') return null
  const isLoad = action === 'load'
  return (
    <div className={clsx(materialInspectorStyles['inspector-actions'])} aria-label="库位上下料">
      <Button
        className={clsx(materialInspectorStyles['material-site-action'])}
        disabled
        icon={
          <AppIcon
            name={isLoad ? 'general/upload-01' : 'general/download-01'}
            color={isLoad ? 'primary' : undefined}
            size={16}
          />
        }
        title="统一物料命令尚未接入"
      >
        {isLoad ? '上料' : '下料'}
      </Button>
    </div>
  )
}
