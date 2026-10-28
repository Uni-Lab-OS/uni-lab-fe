import { clsx } from 'clsx'
import { App, Button, Modal, Select, Tooltip, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { MaterialGraphNode, MaterialSitePlacementInput, SiteSummary } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { AppIcon } from '../../components/ui/Icon'
import materialInspectorStyles from './MaterialInspector.module.scss'
import { placementCandidates, resolveMaterialSiteAction } from './materialSiteActions'

/**
 * 库位人工上下料：空库位上料（从候选物料里选一个放进来）、已占用库位下料（解除占用）。
 * 只登记库存，不驱动设备；提交带读到的物料修订版本，OS 在修订已变或物料、库位被任务占用时拒绝。
 * 接口没有幂等键，失败或超时不自动重发：无论成败都重读物料图，以页面显示为准。
 */
export function SiteHandlingActions({
  site,
  nodes,
  preferredMaterialUuid,
  onChanged,
}: {
  site: SiteSummary
  nodes: readonly MaterialGraphNode[]
  /** 上料选择框的默认物料（例如当前查看的物料）；不在候选里时忽略。 */
  preferredMaterialUuid?: string
  onChanged: () => void
}) {
  const { backend } = useBackend()
  const { message, modal } = App.useApp()
  const capability = backend.getCapabilityStatus('material.sitePlacement')
  const action = resolveMaterialSiteAction(site.occupancy)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [choice, setChoice] = useState<string>()
  const candidates = useMemo(
    () => (action === 'load' ? placementCandidates(site, nodes) : []),
    [action, site, nodes],
  )
  if (action === 'unavailable') {
    return (
      <Typography.Text
        type="secondary"
        className={clsx(materialInspectorStyles['capability-note'])}
      >
        库位占用状态未知，暂不提供上下料操作。
      </Typography.Text>
    )
  }

  const siteLabel = site.name || site.key
  const occupant =
    action === 'unload'
      ? nodes.find((node) => node.material.materialUuid === site.occupancy.occupiedMaterialUuid)
      : undefined
  const blockedReason = !capability.available
    ? (capability.reason ?? '当前后端不支持人工上下料')
    : action === 'unload' && !occupant
      ? '物料图里找不到占用物料，请刷新后再试'
      : action === 'load' && candidates.length === 0
        ? '没有可放入该库位的物料'
        : undefined

  async function submit(input: MaterialSitePlacementInput, done: string) {
    setBusy(true)
    try {
      await backend.core.materialSite.updateSitePlacement(input)
      message.success(done)
      return true
    } catch (error) {
      message.error(
        `${error instanceof Error ? error.message : '提交失败'}（已重新读取物料图，请以页面显示为准）`,
      )
      return false
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  function confirmUnload() {
    if (!occupant) return
    const name = occupant.material.name
    modal.confirm({
      title: `确认已把「${name}」从「${siteLabel}」取走？`,
      content: '只修改库存记录，不会驱动设备。',
      okText: '确认下料',
      cancelText: '取消',
      onOk: () =>
        submit(
          {
            materialUuid: occupant.material.materialUuid,
            placement: { action: 'remove' },
            expectedRevision: occupant.material.revision,
          },
          `已下料：${name} 已离开 ${siteLabel}`,
        ),
    })
  }

  function openPicker() {
    const preferred = candidates.find((item) => item.materialUuid === preferredMaterialUuid)
    setChoice(preferred?.materialUuid ?? candidates[0]?.materialUuid)
    setPicking(true)
  }

  async function confirmLoad() {
    const candidate = candidates.find((item) => item.materialUuid === choice)
    if (!candidate) return
    const ok = await submit(
      {
        materialUuid: candidate.materialUuid,
        placement: { action: 'place', siteUuid: site.siteUuid },
        expectedRevision: candidate.revision,
      },
      `已上料：${candidate.name} 已放入 ${siteLabel}`,
    )
    if (ok) setPicking(false)
  }

  const isLoad = action === 'load'
  const button = (
    <Button
      className={clsx(materialInspectorStyles['material-site-action'])}
      disabled={Boolean(blockedReason)}
      loading={busy}
      icon={
        <AppIcon
          name={isLoad ? 'general/upload-01' : 'general/download-01'}
          color={isLoad ? 'primary' : undefined}
          size={16}
        />
      }
      onClick={isLoad ? openPicker : confirmUnload}
    >
      {isLoad ? '上料' : '下料'}
    </Button>
  )
  const chosen = candidates.find((item) => item.materialUuid === choice)
  return (
    <>
      <div className={clsx(materialInspectorStyles['inspector-actions'])} aria-label="库位上下料">
        {blockedReason ? <Tooltip title={blockedReason}>{button}</Tooltip> : button}
      </div>
      <Typography.Text
        type="secondary"
        className={clsx(materialInspectorStyles['capability-note'])}
      >
        {capability.available
          ? '上下料只登记库存，不驱动设备：请先完成实物取放再登记。物料或库位正被任务使用时系统会拒绝。'
          : (capability.reason ?? '当前后端不支持人工上下料')}
      </Typography.Text>
      <Modal
        open={picking}
        title={`上料到「${siteLabel}」`}
        okText="确认上料"
        cancelText="取消"
        okButtonProps={{ disabled: !chosen, loading: busy }}
        onOk={confirmLoad}
        onCancel={() => setPicking(false)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          只修改库存记录，不会驱动设备。选已在别处库位的物料时，会从原库位换到这里。
        </Typography.Paragraph>
        <Select
          className={clsx(materialInspectorStyles['site-load-select'])}
          showSearch
          optionFilterProp="label"
          aria-label="选择上料物料"
          value={choice}
          onChange={setChoice}
          options={candidates.map((item) => ({
            value: item.materialUuid,
            label: item.currentSiteLabel
              ? `${item.name}（当前在 ${item.currentSiteLabel}）`
              : `${item.name}（未放置）`,
          }))}
        />
      </Modal>
    </>
  )
}
