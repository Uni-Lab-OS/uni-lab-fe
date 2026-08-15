import { useState } from 'react'

import type { BenchHistoryRecord, BenchMaterialProjection, BenchSiteProjection, ProjectionStatus } from '../types'
import { pillBaseClass, uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

/** 根据选中对象展示基础信息以及可按任务筛选的历史/流转记录。 */
export function BenchInspector({
  site,
  material,
  sites,
  history,
}: {
  site: BenchSiteProjection | null
  material: BenchMaterialProjection | null
  sites: readonly BenchSiteProjection[]
  history: readonly BenchHistoryRecord[]
}): React.JSX.Element {
  const [tab, setTab] = useState<'basic' | 'history'>('basic')
  const [taskQuery, setTaskQuery] = useState('')
  const objectId = site?.id ?? material?.id ?? ''
  const visibleHistory = history.filter(
    (record) =>
      record.objectId === objectId &&
      (!taskQuery.trim() || record.taskId?.toLocaleLowerCase('zh-CN').includes(taskQuery.trim().toLocaleLowerCase('zh-CN'))),
  )
  const materialSite = material ? (sites.find((candidate) => candidate.id === material.siteId) ?? null) : null
  const status = site?.status ?? (material?.status === 'unknown' ? 'unknown' : (materialSite?.status ?? 'unknown'))
  const title = site?.name ?? material?.name ?? '未选择'
  return (
    <aside className={styles.benchInspector} aria-label={`${title}详情`}>
      <header>
        <div>
          <h2>{title}</h2>
          <p>{site ? `${site.id} · ${site.device}` : material ? `${material.template} · ${material.id}` : '—'}</p>
        </div>
        <StatusBadge status={status} />
      </header>
      <div className={styles.inspectorTabs}>
        <button type="button" aria-pressed={tab === 'basic'} onClick={() => setTab('basic')}>
          基础信息
        </button>
        <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>
          {site ? '历史记录' : '流转记录'}
        </button>
      </div>
      {tab === 'basic' ? (
        site ? (
          <SiteDetails site={site} />
        ) : material ? (
          <MaterialDetails material={material} site={materialSite} />
        ) : null
      ) : (
        <HistoryPanel records={visibleHistory} query={taskQuery} onQueryChange={setTaskQuery} />
      )}
    </aside>
  )
}

function SiteDetails({ site }: { site: BenchSiteProjection }): React.JSX.Element {
  return (
    <>
      <dl className={styles.detailList}>
        <div>
          <dt>库位状态</dt>
          <dd>{statusLabel(site.status)}</dd>
        </div>
        <div>
          <dt>当前物料</dt>
          <dd>{site.materialName ?? '无已知物料'}</dd>
        </div>
        <div>
          <dt>关联任务</dt>
          <dd>{site.workflowLabel ?? '无'}</dd>
        </div>
        <div>
          <dt>物料类型</dt>
          <dd>{site.materialType}</dd>
        </div>
        <div>
          <dt>所属设备</dt>
          <dd>{site.device}</dd>
        </div>
        <div>
          <dt>现场位置</dt>
          <dd>{site.position}</dd>
        </div>
        {site.unknownReason ? (
          <div className={styles.unknownReason}>
            <dt>无法确认原因</dt>
            <dd>{site.unknownReason}</dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.inspectorFootnote}>状态不明时保持失败关闭，不用于调度准入。</p>
    </>
  )
}

function MaterialDetails({ material, site }: { material: BenchMaterialProjection; site: BenchSiteProjection | null }): React.JSX.Element {
  return (
    <>
      <dl className={styles.detailList}>
        <div>
          <dt>物料类型</dt>
          <dd>{material.template}</dd>
        </div>
        <div>
          <dt>当前库位</dt>
          <dd>{site?.name ?? '无法确认'}</dd>
        </div>
        <div>
          <dt>关联任务</dt>
          <dd>{material.workflowLabel ?? '无'}</dd>
        </div>
        <div>
          <dt>位置投影</dt>
          <dd>{site?.position ?? '无法确认'}</dd>
        </div>
        {material.status === 'unknown' && site?.unknownReason ? (
          <div className={styles.unknownReason}>
            <dt>无法确认原因</dt>
            <dd>{site.unknownReason}</dd>
          </div>
        ) : null}
      </dl>
      <p className={styles.inspectorFootnote}>物料身份与位置来自只读投影，前端不反推库存事实。</p>
    </>
  )
}

function HistoryPanel({
  records,
  query,
  onQueryChange,
}: {
  records: readonly BenchHistoryRecord[]
  query: string
  onQueryChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className={styles.historyPanel}>
      <label className={styles.searchField}>
        <WorkstationIcon name="search" />
        <span className={uiClass.screenReaderOnly}>按任务筛选记录</span>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="按任务编号筛选" />
      </label>
      {records.length ? (
        <ol>
          {records.map((record) => (
            <li key={record.id}>
              <span>
                <strong>{record.action}</strong>
                <time>{record.occurredAt}</time>
              </span>
              <small>
                任务 {record.taskId ?? '—'} · Trace {record.traceId}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <div className={uiClass.compactEmptyState}>没有符合条件的记录</div>
      )}
    </div>
  )
}

export function StatusBadge({ status }: { status: ProjectionStatus }): React.JSX.Element {
  return (
    <span className={`${pillBaseClass} ${styles.statusBadge}`} data-status={status}>
      <StatusDot status={status} />
      {statusLabel(status)}
    </span>
  )
}

export function StatusDot({ status }: { status: ProjectionStatus }): React.JSX.Element {
  return <span className={styles.projectionDot} data-status={status} aria-hidden="true" />
}

export function statusLabel(status: ProjectionStatus): string {
  return status === 'empty' ? '空闲' : status === 'occupied' ? '已占用' : '状态不明'
}
