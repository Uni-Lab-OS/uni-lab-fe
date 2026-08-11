import { useMemo, useState } from 'react'

import type { MaterialId } from '@unilab/material'

import {
  formatReagentDate,
  formatReagentMeasurement,
  formatReagentQualityState,
  reagentContainerAttentionReasons,
  resolveReagentExpiryState,
  type CapabilityStatus,
  type ReagentCatalogGroup
} from './reagentWorkspace'

type ReagentLedgerScope = 'all' | 'placed' | 'attention'

const UNPLACED_FILTER_VALUE = '__unplaced__'

/**
 * 在单一试剂台账中统一查询试剂、批次、容器数量与当前库位（Site）。
 * @param props 试剂目录、共享搜索词、库存能力、选择状态与容器选择回调。
 * @returns 使用试剂、库位和关注状态筛选的唯一容器表。
 */
export function ReagentContainerLedger({
  groups,
  query,
  readStatus,
  selectedMaterialIds,
  onSelectContainer
}: {
  groups: readonly ReagentCatalogGroup[]
  query: string
  readStatus: CapabilityStatus
  selectedMaterialIds: readonly MaterialId[]
  onSelectContainer: (materialId: MaterialId, reagentInfoId: string) => void
}): React.JSX.Element {
  const [reagentInfoId, setReagentInfoId] = useState('all')
  const [placement, setPlacement] = useState('all')
  const [scope, setScope] = useState<ReagentLedgerScope>('all')
  const normalized = query.trim().toLocaleLowerCase()
  const allContainers = useMemo(
    () => readStatus.available
      ? groups.flatMap((group) => group.containers)
      : [],
    [groups, readStatus.available]
  )
  const placementOptions = useMemo(() => Array.from(new Set(
    allContainers
      .filter((container) => container.material.placed)
      .map((container) => container.material.placementLabel)
  )).sort((left, right) => left.localeCompare(right, 'zh-CN')), [allContainers])
  const containers = allContainers.filter((container) => {
    const matchesQuery = !normalized || [
      container.reagentInfo.name,
      container.reagentInfo.cas ?? '',
      container.reagentInfo.manufacturer ?? '',
      container.material.name,
      container.material.code,
      container.material.placementLabel,
      container.storageCondition ?? '',
      container.lot.code
    ].join(' ').toLocaleLowerCase().includes(normalized)
    const matchesReagent = reagentInfoId === 'all' ||
      container.reagentInfoId === reagentInfoId
    const matchesPlacement = placement === 'all' || (
      placement === UNPLACED_FILTER_VALUE
        ? !container.material.placed
        : container.material.placementLabel === placement
    )
    const needsAttention = reagentContainerAttentionReasons(container).length > 0
    const matchesScope = scope === 'all' ||
      (scope === 'placed' && container.material.placed) ||
      (scope === 'attention' && needsAttention)
    return matchesQuery && matchesReagent && matchesPlacement && matchesScope
  })
  const placedCount = containers.filter(
    (container) => container.material.placed
  ).length
  const attentionCount = containers.filter((container) => (
    reagentContainerAttentionReasons(container).length > 0
  )).length
  const hasStructuredFilters = reagentInfoId !== 'all' || placement !== 'all' ||
    scope !== 'all'

  /**
   * 清除台账内部结构化筛选，保留父级共享搜索词由用户直接修改。
   * @returns 无返回值；只恢复当前页面筛选状态，不修改权威试剂数据。
   */
  const resetStructuredFilters = (): void => {
    setReagentInfoId('all')
    setPlacement('all')
    setScope('all')
  }

  return (
    <section
      className="reagent-operational reagent-ledger-table"
      aria-label="试剂容器台账"
    >
      <header className="reagent-operational__header">
        <div>
          <h4>全部试剂容器</h4>
          <p>同一张表查看试剂身份、批次、余量、当前位置、存储条件和容器状态。</p>
        </div>
        <dl aria-label="当前查询摘要">
          <div><dt>结果</dt><dd>{containers.length}</dd></div>
          <div><dt>已放置</dt><dd>{placedCount}</dd></div>
          <div><dt>需关注</dt><dd>{attentionCount}</dd></div>
        </dl>
      </header>

      {!readStatus.available ? (
        <CapabilityBoundary title="数量库存不可用" detail={readStatus.reason} />
      ) : null}

      <div className="reagent-operational__toolbar reagent-ledger-table__filters">
        <label>
          <span>试剂</span>
          <select
            aria-label="按试剂筛选"
            value={reagentInfoId}
            onChange={(event) => setReagentInfoId(event.target.value)}
          >
            <option value="all">全部试剂</option>
            {groups.map((group) => (
              <option key={group.reagentInfo.id} value={group.reagentInfo.id}>
                {group.reagentInfo.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>库位</span>
          <select
            aria-label="按库位筛选"
            value={placement}
            onChange={(event) => setPlacement(event.target.value)}
          >
            <option value="all">全部库位</option>
            <option value={UNPLACED_FILTER_VALUE}>尚未放置</option>
            {placementOptions.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="容器关注状态">
          {([
            ['all', '全部'],
            ['placed', '已放置'],
            ['attention', '需关注']
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="reagent-ledger-table__reset"
          disabled={!hasStructuredFilters}
          onClick={resetStructuredFilters}
        >
          重置筛选
        </button>
      </div>

      <div className="reagent-storage__table-wrap">
        {containers.length ? (
          <table>
            <thead>
              <tr>
                <th scope="col">试剂 / 容器</th>
                <th scope="col">批次 / 有效期</th>
                <th scope="col">当前数量</th>
                <th scope="col">当前位置</th>
                <th scope="col">存储条件</th>
                <th scope="col">容器状态</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => {
                const selected = selectedMaterialIds.includes(
                  container.materialId
                )
                return (
                  <tr key={container.materialId} aria-selected={selected}>
                    <td>
                      <button
                        type="button"
                        aria-current={selected || undefined}
                        onClick={() => onSelectContainer(
                          container.materialId,
                          container.reagentInfoId
                        )}
                      >
                        <strong>{container.reagentInfo.name}</strong>
                        <small>{container.material.name} · {container.material.code}</small>
                      </button>
                    </td>
                    <td>
                      <strong>{container.lot.code}</strong>
                      <small>{formatReagentQualityState(
                        container.lot.qualityState
                      )} · 至 {formatReagentDate(
                        container.expiresAt ?? container.lot.expiresAt
                      )}</small>
                    </td>
                    <td>
                      <strong>{formatReagentMeasurement(container.quantity)}</strong>
                      <small>初始 {formatReagentMeasurement(
                        container.initialQuantity
                      )}</small>
                      <span
                        className="reagent-level"
                        role="progressbar"
                        aria-label={`${container.material.name} 剩余比例`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(container.remainingRatio * 100)}
                      >
                        <span style={{ width: `${container.remainingRatio * 100}%` }} />
                      </span>
                    </td>
                    <td>
                      <strong>{container.material.placementLabel}</strong>
                      <small>{container.material.placed
                        ? '库位占用（SiteOccupancy）已确认'
                        : '尚未附着稳定库位（Site）'}</small>
                    </td>
                    <td>
                      <strong>{container.storageCondition ?? '—'}</strong>
                      <small>{container.reagentInfo.hazardLabels.join(' · ') || '无危险标签'}</small>
                    </td>
                    <td>
                      <ContainerState value={container.state} />
                      <small>{expiryStateLabel(resolveReagentExpiryState(
                        container.expiresAt ?? container.lot.expiresAt
                      ))}</small>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="reagent-operational__empty" role="status">
            <strong>没有匹配的试剂容器</strong>
            <p>{readStatus.available
              ? '调整搜索、试剂、库位或关注状态筛选。'
              : '数量库存服务接入后才会显示真实容器余量与当前位置。'}</p>
          </div>
        )}
      </div>
      <footer className="reagent-operational__boundary">
        数量来自试剂库存投影；当前位置来自物料（Material）的库位（Site）与库位占用（SiteOccupancy）。台账不推断任务可用性。
      </footer>
    </section>
  )
}

/**
 * 渲染容器自身状态，避免将其解释为任务可用性。
 * @param props 试剂容器自身的开启、隔离或耗尽状态。
 * @returns 不承诺任务物料预留或作业执行占用的状态标签。
 */
function ContainerState({
  value
}: {
  value: ReagentCatalogGroup['containers'][number]['state']
}): React.JSX.Element {
  const labels = {
    sealed: '未开封',
    opened: '使用中',
    quarantined: '已隔离',
    empty: '已耗尽'
  }
  return (
    <span className="reagent-container-state" data-state={value}>
      {labels[value]}
    </span>
  )
}

/** 将有效期投影状态转换为试剂台账显示文本。 */
function expiryStateLabel(
  value: ReturnType<typeof resolveReagentExpiryState>
): string {
  const labels = {
    valid: '有效期正常',
    expiring: '即将到期',
    expired: '已过期',
    unknown: '有效期未知'
  }
  return labels[value]
}

/**
 * 展示试剂数量投影缺失时的失败关闭原因。
 * @param props 能力名称与宿主返回的不可用原因。
 * @returns 不以空集合冒充权威查询结果的状态提示。
 */
function CapabilityBoundary({ title, detail }: {
  title: string
  detail?: string
}): React.JSX.Element {
  return (
    <div className="reagent-capability-boundary" role="status">
      <span aria-hidden="true">!</span>
      <div><strong>{title}</strong><small>{detail ?? '当前宿主未声明此能力'}</small></div>
    </div>
  )
}
