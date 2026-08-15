import { useEffect, useMemo, useState } from 'react'

import { DataAuthorityNotice, ModuleHeader, WorkstationDataState } from '../ModuleHeader'
import { BenchInspector, StatusBadge } from '../bench/BenchInspector'
import type {
  BenchMaterialProjection,
  BenchSiteProjection,
  BenchSnapshot,
  WorkstationDataStatus
} from '../types'
import { buttonClass, uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

type BenchView = 'sites' | 'materials'
type BenchSelection = { kind: 'site'; id: string } | { kind: 'material'; id: string }
const EMPTY_SITES: readonly BenchSiteProjection[] = []
const EMPTY_MATERIALS: readonly BenchMaterialProjection[] = []

/**
 * 展示公共物料图派生的实验台、库位（Site）与物料（Material）只读投影。
 * @param props 后端快照与加载状态；没有快照时绝不回退前端夹具。
 * @returns 可筛选的真实库位/物料清单和详情面板。
 */
export function BenchModule({
  snapshot,
  status
}: {
  snapshot?: BenchSnapshot
  status: WorkstationDataStatus
}): React.JSX.Element {
  const [view, setView] = useState<BenchView>('sites')
  const [selection, setSelection] = useState<BenchSelection | null>(null)
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const sites = snapshot?.sites ?? EMPTY_SITES
  const materials = snapshot?.materials ?? EMPTY_MATERIALS

  useEffect(() => {
    if (selection?.kind === 'site' && sites.some((site) => site.id === selection.id)) return
    if (selection?.kind === 'material' && materials.some((material) => material.id === selection.id)) return
    const firstSite = sites[0]
    setSelection(firstSite ? { kind: 'site', id: firstSite.id } : null)
  }, [materials, selection, sites])

  const filteredSites = useMemo(() => sites.filter((site) =>
    (ownerFilter === 'all' || site.device === ownerFilter) &&
    (statusFilter === 'all' || site.status === statusFilter)
  ), [ownerFilter, sites, statusFilter])
  const filteredMaterials = useMemo(() => materials.filter((material) => {
    const site = sites.find((candidate) => candidate.id === material.siteId)
    return Boolean(site) &&
      (ownerFilter === 'all' || site?.device === ownerFilter) &&
      (statusFilter === 'all' || site?.status === statusFilter)
  }), [materials, ownerFilter, sites, statusFilter])
  const selectedSite = selection?.kind === 'site'
    ? sites.find((site) => site.id === selection.id) ?? null
    : null
  const selectedMaterial = selection?.kind === 'material'
    ? materials.find((material) => material.id === selection.id) ?? null
    : null
  const ownerNames = [...new Set(sites.map((site) => site.device))]

  return (
    <div className={uiClass.modulePage} data-testid="workstation-bench">
      <ModuleHeader
        title="实验台"
        description="读取公共物料图，查看权威物料身份及其逻辑库位占用投影。"
        actions={status.retry ? (
          <button className={buttonClass('secondary', 'compact')} type="button" onClick={status.retry}>刷新数据</button>
        ) : undefined}
      />
      {status.phase !== 'ready' || !snapshot ? (
        <WorkstationDataState status={status} title={benchStateTitle(status)} icon="map" />
      ) : sites.length === 0 && materials.length === 0 ? (
        <WorkstationDataState
          status={{ phase: 'empty', message: '公共物料图已连接，但当前没有可展示的库位或物料。', retry: status.retry }}
          title="实验台暂无数据"
          icon="map"
        />
      ) : (
        <>
          <DataAuthorityNotice>
            数据来自后端公共物料图；“空闲/已占用”表示逻辑库位占用（SiteOccupancy）投影，不替代传感器现场观测。
          </DataAuthorityNotice>
          <section className={styles.benchToolbar} aria-label="实验台视图与筛选">
            <div className={styles.segmentedControl}>
              <button type="button" aria-pressed={view === 'sites'} onClick={() => setView('sites')}>
                <WorkstationIcon name="site" />
                库位清单
              </button>
              <button type="button" aria-pressed={view === 'materials'} onClick={() => setView('materials')}>
                <WorkstationIcon name="material" />
                物料清单
              </button>
            </div>
            <div className={styles.toolbarFilters}>
              <label>
                <span className={uiClass.screenReaderOnly}>所属物料筛选</span>
                <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                  <option value="all">全部所属物料</option>
                  {ownerNames.map((owner) => <option key={owner}>{owner}</option>)}
                </select>
              </label>
              <label>
                <span className={uiClass.screenReaderOnly}>库位状态筛选</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">全部状态</option>
                  <option value="empty">空闲</option>
                  <option value="occupied">已占用</option>
                  <option value="unknown">状态不明</option>
                </select>
              </label>
            </div>
          </section>
          <div className={styles.benchGrid}>
            <section className={styles.benchCanvas} aria-label={view === 'sites' ? '库位清单' : '物料清单'}>
              {view === 'sites' ? (
                <SiteTable
                  sites={filteredSites}
                  selection={selection}
                  onSelect={(id) => setSelection({ kind: 'site', id })}
                />
              ) : (
                <MaterialTable
                  materials={filteredMaterials}
                  sites={sites}
                  selection={selection}
                  onSelect={(id) => setSelection({ kind: 'material', id })}
                />
              )}
            </section>
            <BenchInspector
              key={`${selection?.kind ?? 'none'}-${selection?.id ?? 'none'}`}
              site={selectedSite}
              material={selectedMaterial}
              sites={sites}
              history={snapshot.history}
            />
          </div>
        </>
      )}
    </div>
  )
}

/** 渲染真实库位清单。 */
function SiteTable({
  sites,
  selection,
  onSelect
}: {
  sites: readonly BenchSiteProjection[]
  selection: BenchSelection | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  if (sites.length === 0) return <div className={uiClass.compactEmptyState}>没有符合筛选条件的库位</div>
  return (
    <div className={uiClass.tableScroll}>
      <table className={styles.dataTable}>
        <thead><tr><th>库位名称</th><th>所属物料</th><th>当前物料</th><th>逻辑占用</th></tr></thead>
        <tbody>{sites.map((site) => (
          <tr key={site.id} data-selected={selection?.kind === 'site' && selection.id === site.id}>
            <td><button type="button" onClick={() => onSelect(site.id)}><strong>{site.name}</strong><small>{site.id}</small></button></td>
            <td>{site.device}</td>
            <td>{site.materialName ?? '—'}</td>
            <td><StatusBadge status={site.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

/** 渲染真实物料与当前库位关系。 */
function MaterialTable({
  materials,
  sites,
  selection,
  onSelect
}: {
  materials: readonly BenchMaterialProjection[]
  sites: readonly BenchSiteProjection[]
  selection: BenchSelection | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  if (materials.length === 0) return <div className={uiClass.compactEmptyState}>没有符合筛选条件的已放置物料</div>
  return (
    <div className={uiClass.tableScroll}>
      <table className={styles.dataTable}>
        <thead><tr><th>物料名称</th><th>资源模板</th><th>当前库位</th><th>位置状态</th></tr></thead>
        <tbody>{materials.map((material) => {
          const site = sites.find((candidate) => candidate.id === material.siteId)
          return (
            <tr key={material.id} data-selected={selection?.kind === 'material' && selection.id === material.id}>
              <td><button type="button" onClick={() => onSelect(material.id)}><strong>{material.name}</strong><small>{material.id}</small></button></td>
              <td>{material.template}</td>
              <td>{site?.name ?? material.location}</td>
              <td>{material.status === 'unknown' ? '状态不明' : '已确认放置'}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

/** 返回实验台数据状态的简短标题。 */
function benchStateTitle(status: WorkstationDataStatus): string {
  if (status.phase === 'loading') return '正在读取实验台数据'
  if (status.phase === 'error') return '实验台数据读取失败'
  if (status.phase === 'unavailable') return '实验台接口不可用'
  return '实验台暂无数据'
}
