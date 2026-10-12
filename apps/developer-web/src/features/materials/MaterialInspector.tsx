import { clsx } from 'clsx'
import { useState } from 'react'
import materialInspectorStyles from './MaterialInspector.module.scss'
import materialManagementStyles from './MaterialManagement.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Alert, Button, Modal, Select, Tooltip, Typography } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import type {
  MaterialGraph,
  MaterialGraphNode,
  MaterialInspectionProjection,
  SiteSummary,
} from '@unilab-fe/core'
import type { IconColor, IconName } from '@unilab/design-v2/icons'
import { DefinitionList, MaterialSitePresentation, StatusBadge } from '@unilab/lab-ui'
import { AppIcon } from '../../components/ui/Icon'
import { isMaterialGraphNodeHidden, type MaterialSelection } from './materialFlowModel'
import { resolveMaterialSiteAction } from './materialSiteActions'

export function MaterialInspector({
  graph,
  projection,
  selection,
  onSelect,
  onChangeSite,
}: {
  graph: MaterialGraph
  projection?: MaterialInspectionProjection
  selection: MaterialSelection | null
  onSelect: (selection: MaterialSelection) => void
  onChangeSite: (materialUuid: string, expectedRevision: number, siteUuid?: string) => Promise<void>
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
      <SiteInspector
        graph={graph}
        node={projection.node}
        site={projection.selectedSite}
        onSelect={onSelect}
        onChangeSite={onChangeSite}
      />
    )
  }

  if (selection.kind === 'node') {
    return <NodeInspector node={projection.node} sites={projection.sites} onSelect={onSelect} />
  }

  return <MaterialDetailInspector projection={projection} />
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
      {/* 节点视图的库位列表只展示占用状态；查看占用物料走「库位详情 → 查看占用物料」。 */}
      <MaterialSitePresentation
        sites={sites}
        onSelectSite={(siteUuid) => onSelect({ kind: 'site', siteId: siteUuid })}
      />
    </aside>
  )
}

function SiteInspector({
  graph,
  node,
  site,
  onSelect,
  onChangeSite,
}: {
  graph: MaterialGraph
  node: MaterialGraphNode
  site: SiteSummary
  onSelect: (selection: MaterialSelection) => void
  onChangeSite: (materialUuid: string, expectedRevision: number, siteUuid?: string) => Promise<void>
}) {
  const occupied = site.occupancy.occupiedMaterialUuid
  const siteAction = resolveMaterialSiteAction(site.occupancy)
  const status = site.occupancy.known ? (occupied ? 'available' : 'empty') : 'attention'
  const occupantName = occupied
    ? (graph.nodes.find((candidate) => candidate.material.materialUuid === occupied)?.material
        .name ?? occupied)
    : null
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
          {
            label: '当前物料',
            value: occupantName ? (
              <Tooltip title={occupied}>
                <span className={clsx(materialInspectorStyles['definition-value-tooltip'])}>
                  {occupantName}
                </span>
              </Tooltip>
            ) : (
              '空库位'
            ),
          },
        ]}
      />
      {(occupied || siteAction !== 'unavailable') && (
        <div className={clsx(materialInspectorStyles['inspector-actions'])} aria-label="库位操作">
          {occupied && (
            <Button
              type="default"
              className={clsx(materialInspectorStyles['material-inspector__button'])}
              onClick={() =>
                onSelect({ kind: 'material', materialId: occupied, siteId: site.siteUuid })
              }
            >
              查看占用物料
            </Button>
          )}
          <SiteHandlingAction
            graph={graph}
            site={site}
            action={siteAction}
            onChangeSite={onChangeSite}
          />
        </div>
      )}
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

function MaterialDetailInspector({ projection }: { projection: MaterialInspectionProjection }) {
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
      <Typography.Text
        type="secondary"
        className={clsx(materialInspectorStyles['capability-note'])}
      >
        {siteAction === 'unavailable'
          ? '当前页面仅展示物料与库位状态；库位占用状态未知。'
          : '上下料请从库位详情操作。'}
      </Typography.Text>
    </aside>
  )
}

/**
 * 上料候选必须是「当前没有占用任何库位、可以放到目标库位上的物料实例」。
 *
 * 「未分配」只看库位占用事实（`currentSiteUuid`），不能看父物料：OS 的
 * `site_placement: remove` 只解除库位占用，`parent_uuid` 仍指向原承载方
 * （见 Uni-Lab-OS backend_contract._apply_site_placement 与其用例
 * test_material_update_places_moves_and_removes_atomically）。若把父物料为空
 * 当作未分配，刚下料的物料就再也回不到上料列表。
 *
 * 同理也不能按「自带库位」排除：TIP 盒自带 24 个孔位，同时又是上料过渡仓
 * 库位上的可放置实例；能否放进目标库位由库位的 allowed_resource_template_uuids
 * 决定，不由它自己有没有库位决定。
 *
 * 画布隐藏节点（virtual / logical mount / deck / host_node）与设备实例不是可
 * 搬运的物料实例，仍然排除；前者复用画布同一判定，避免两处各写一份而分叉。
 */
function isLoadCandidate(
  node: MaterialGraphNode,
  allowed: readonly string[] | null | undefined,
): boolean {
  if (isMaterialGraphNodeHidden(node)) return false
  if (node.material.materialType === 'device') return false
  if (node.currentSiteUuid !== null) return false
  return !allowed?.length || allowed.includes(node.material.resourceTemplateUuid)
}

function SiteHandlingAction({
  graph,
  site,
  action,
  onChangeSite,
}: {
  graph: MaterialGraph
  site: SiteSummary
  action: ReturnType<typeof resolveMaterialSiteAction>
  onChangeSite: (materialUuid: string, expectedRevision: number, siteUuid?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [candidateId, setCandidateId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  // 占用状态未知时不提供任何方向的上料/下料，避免覆盖未知状态。
  if (action === 'unavailable') return null
  const isLoad = action === 'load'
  const occupiedId = site.occupancy.occupiedMaterialUuid
  const occupied = occupiedId
    ? graph.nodes.find((candidate) => candidate.material.materialUuid === occupiedId)
    : undefined
  const allowed = site.allowedResourceTemplateUuids
  const candidates = isLoad
    ? graph.nodes.filter((candidate) => isLoadCandidate(candidate, allowed))
    : []

  const openDialog = () => {
    setCandidateId(undefined)
    setError(undefined)
    setOpen(true)
  }

  const submit = async () => {
    const material = isLoad
      ? candidates.find((candidate) => candidate.material.materialUuid === candidateId)
      : occupied
    if (!material) {
      setError(
        isLoad ? '请选择要上料的物料。' : '当前库位的占用物料不在最新物料图中，请刷新后重试。',
      )
      return
    }
    setSubmitting(true)
    setError(undefined)
    const revision = material.material.revision
    if (revision === null) {
      setError('物料 revision 尚未读取，请刷新后重试。')
      return
    }
    try {
      await onChangeSite(
        material.material.materialUuid,
        revision,
        isLoad ? site.siteUuid : undefined,
      )
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '库位操作失败，请刷新后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button
        className={clsx(materialInspectorStyles['material-site-action'])}
        onClick={openDialog}
        icon={
          <AppIcon
            name={isLoad ? 'general/upload-01' : 'general/download-01'}
            color={isLoad ? 'primary' : undefined}
            size={16}
          />
        }
      >
        {isLoad ? '上料' : '下料'}
      </Button>
      <Modal
        open={open}
        title={isLoad ? `上料至 ${site.name || site.key}` : `从 ${site.name || site.key} 下料`}
        onCancel={() => !submitting && setOpen(false)}
        onOk={() => void submit()}
        okText={isLoad ? '确认上料' : '确认下料'}
        cancelText="取消"
        confirmLoading={submitting}
        okButtonProps={{ disabled: isLoad && !candidateId }}
        destroyOnHidden
      >
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {isLoad ? (
          candidates.length ? (
            <Select
              aria-label="选择待上料物料"
              className={clsx(materialInspectorStyles['material-site-select'])}
              placeholder="选择未占用库位的物料"
              value={candidateId}
              onChange={setCandidateId}
              options={candidates.map((candidate) => ({
                value: candidate.material.materialUuid,
                label: `${candidate.material.name}${candidate.material.barcode ? ` · ${candidate.material.barcode}` : ''}`,
              }))}
            />
          ) : (
            <Typography.Text type="secondary">
              {allowed?.length
                ? '没有符合该库位模板限制、且未占用库位的物料。'
                : '当前没有未占用库位、可上料的物料。'}
            </Typography.Text>
          )
        ) : (
          <Typography.Text type="secondary">
            下料只解除该库位的占用，不会删除物料实例；物料仍挂在原父级承载方下。
          </Typography.Text>
        )}
      </Modal>
    </>
  )
}
