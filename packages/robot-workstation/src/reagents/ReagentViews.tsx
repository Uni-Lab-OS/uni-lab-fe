import { Button } from '@unilab/design-system'

import type { ReagentInfoProjection, ReagentInventoryProjection } from '../types'
import { pillBaseClass, uiClass } from '../uiClasses'
import { WorkstationIcon, type WorkstationIconName } from '../WorkstationIcon'
import styles from '../workstation.module.scss'
import { MoleculeStructure2D } from './MoleculeStructure2D'

export interface ReagentLedgerActions {
  edit(item: ReagentInventoryProjection): void
  history(item: ReagentInventoryProjection): void
  delete(item: ReagentInventoryProjection): void
}

export interface ReagentInfoActions {
  edit(item: ReagentInfoProjection): void
  delete(item: ReagentInfoProjection): void
}

/**
 * 按附件的信息层级展示真实试剂台账，不把缺失的业务字段补成示例值。
 * @param props 权威库存条目、搜索词和可选 Backend 行操作。
 * @returns 包含三项摘要和库存业务列的台账视图。
 */
export function ReagentLedgerView({
  items,
  query,
  actions
}: {
  items: readonly ReagentInventoryProjection[]
  query: string
  actions?: ReagentLedgerActions
}): React.JSX.Element {
  const visibleItems = filterReagentInventory(items, query)
  const totals = summarizeReagentInventory(items)
  return (
    <>
      <div className={styles.reagentStats} aria-label="试剂库存摘要">
        <ReagentStat icon="flask" label="试剂库存" value={totals.count} tone="info" />
        <ReagentStat icon="shield" label="可用" value={totals.available} tone="success" />
        <ReagentStat icon="point" label="预留中" value={totals.reserved} tone="warning" />
      </div>
      <div className={`${uiClass.panel} ${uiClass.tableScroll} ${styles.reagentLedgerPanel}`}>
        <table className={`${styles.dataTable} ${styles.reagentLedgerTable}`} aria-label="试剂库存">
          <thead>
            <tr>
              <th>试剂名称</th>
              <th>CAS 号</th>
              <th>物料号</th>
              <th>试剂量</th>
              <th>状态</th>
              <th>库位</th>
              <th>有效期</th>
              <th>供应商</th>
              <th>密度</th>
              <th>关联任务</th>
              {actions ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map(item => (
              <tr key={item.id}>
                <td data-label="试剂名称">
                  <strong>{item.name}</strong>
                </td>
                <td data-label="CAS 号" className={uiClass.mono}>{item.cas ?? '—'}</td>
                <td data-label="物料号" className={uiClass.mono}>{item.lotLabel ?? '—'}</td>
                <td data-label="试剂量">
                  <strong>{formatQuantity(item.totalQuantity, item.unit)}</strong>
                </td>
                <td data-label="状态"><InventoryStatus status={item.status} /></td>
                <td data-label="库位">{item.siteLabel ?? '—'}</td>
                <td data-label="有效期" className={uiClass.mono}>{formatDate(item.expiresAt)}</td>
                <td data-label="供应商">{metadataText(item.metadata, ['supplier', 'vendor']) ?? '—'}</td>
                <td data-label="密度">{formatDensity(item)}</td>
                <td data-label="关联任务">{metadataText(item.metadata, ['current_task', 'workflow_task', 'task_id']) ?? '—'}</td>
                {actions ? (
                  <td data-label="操作">
                    <div className={uiClass.rowActions}>
                      <RowAction icon="edit" label={`编辑 ${item.name}`} disabled={item.revision == null} onClick={() => actions.edit(item)} />
                      <RowAction icon="history" label={`查看 ${item.name} 历史`} disabled={!item.materialId} onClick={() => actions.history(item)} />
                      <RowAction icon="trash" label={`删除 ${item.name}`} disabled={item.revision == null} onClick={() => actions.delete(item)} />
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {visibleItems.length === 0 ? (
              <tr><td colSpan={actions ? 11 : 10}><div className={uiClass.compactEmptyState}>没有符合搜索条件的试剂库存</div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * 展示 Backend 化学品字典，并在能力开放时提供纠错与受限删除入口。
 * @param props 权威基础信息条目、当前搜索词和可选行操作。
 * @returns 与附件试剂库列结构一致的表格。
 */
export function ReagentLibraryView({
  infos,
  query,
  actions
}: {
  infos: readonly ReagentInfoProjection[]
  query: string
  actions?: ReagentInfoActions
}): React.JSX.Element {
  const visibleInfos = filterReagentInfos(infos, query)
  const columnCount = 5 + Number(Boolean(actions))
  return (
    <section className={uiClass.panel}>
      <div className={uiClass.tableScroll}>
        <table className={`${styles.dataTable} ${styles.reagentLibraryTable}`} aria-label="试剂基础信息库">
          <thead>
            <tr>
              <th>试剂名称</th>
              <th>CAS 号</th>
              <th>分子式</th>
              <th>2D 结构</th>
              <th>物性</th>
              {actions ? <th className={styles.reagentLibraryActions}>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleInfos.map(info => {
              const parameterSummary = formatInfoParameters(info)
              return (
                <tr key={info.id}>
                  <td data-label="试剂名称">
                    <strong>{info.name}</strong>
                    <small>{formatAliases(info)}</small>
                    {parameterSummary ? <small className={styles.reagentIdentityParameters}>{parameterSummary}</small> : null}
                  </td>
                  <td data-label="CAS 号" className={uiClass.mono}>{info.cas ?? '—'}</td>
                  <td data-label="分子式" className={styles.reagentFormula}>{info.molecularFormula ?? '—'}</td>
                  <td data-label="2D 结构"><MoleculeStructure2D name={info.name} smiles={info.smiles} size="compact" /></td>
                  <td data-label="物性">
                    <div className={styles.reagentProperties}>
                      <strong>{info.molecularWeight == null ? '—' : `${info.molecularWeight.toLocaleString('zh-CN')} g/mol`}</strong>
                      <span>{physicalStateLabel(info.physicalState)}</span>
                    </div>
                  </td>
                  {actions ? (
                    <td data-label="操作" className={styles.reagentLibraryActions}>
                      <div className={uiClass.rowActions}>
                        <RowAction icon="edit" label={`编辑试剂基础信息 ${info.name}`} disabled={false} onClick={() => actions.edit(info)} />
                        <RowAction icon="trash" label={`删除试剂基础信息 ${info.name}`} disabled={false} onClick={() => actions.delete(info)} />
                      </div>
                    </td>
                  ) : null}
                </tr>
              )
            })}
            {visibleInfos.length === 0 ? (
              <tr><td colSpan={columnCount}><div className={uiClass.compactEmptyState}>没有符合搜索条件的试剂基础信息</div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 按台账所有可见业务身份筛选权威库存条目。 */
export function filterReagentInventory(
  items: readonly ReagentInventoryProjection[],
  query: string
): readonly ReagentInventoryProjection[] {
  const normalized = normalizeQuery(query)
  if (!normalized) return items
  return items.filter(item => [
    item.name, item.cas, item.molecularFormula, item.lotLabel, item.siteLabel,
    item.materialId, item.reagentInfoId, item.id,
    ...['supplier', 'vendor', 'current_task', 'workflow_task', 'task_id']
      .map(key => metadataText(item.metadata, [key]))
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalized))
}

/** 按名称、别名、CAS 和结构字段筛选试剂基础信息。 */
export function filterReagentInfos(
  infos: readonly ReagentInfoProjection[],
  query: string
): readonly ReagentInfoProjection[] {
  const normalized = normalizeQuery(query)
  if (!normalized) return infos
  return infos.filter(info => [
    info.name, info.nameEn, ...info.aliases, info.cas, info.molecularFormula,
    info.smiles, info.inchiKey, info.physicalState
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalized))
}

/** 汇总库存实例数、可用实例数和可被证明的预留实例数。 */
function summarizeReagentInventory(items: readonly ReagentInventoryProjection[]): {
  count: number
  available: number
  reserved: number | '—'
} {
  const reservedKnown = items.some(item => item.reservedQuantity != null || item.status === 'reserved')
  return {
    count: items.length,
    available: items.filter(item => item.status === 'available').length,
    reserved: reservedKnown
      ? items.filter(item => (item.reservedQuantity ?? 0) > 0 || item.status === 'reserved').length
      : '—'
  }
}

/** 渲染附件风格的紧凑台账摘要项。 */
function ReagentStat({
  icon,
  label,
  value,
  tone
}: {
  icon: 'flask' | 'shield' | 'point'
  label: string
  value: number | string
  tone: 'info' | 'success' | 'warning'
}): React.JSX.Element {
  return (
    <div data-tone={tone}>
      <span><WorkstationIcon name={icon} /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  )
}

/** 渲染同时包含文字与语义色的库存状态。 */
function InventoryStatus({ status }: { status: ReagentInventoryProjection['status'] }): React.JSX.Element {
  return (
    <span className={`${pillBaseClass} ${styles.reagentStatus}`} data-tone={inventoryStatusTone(status)}>
      <span aria-hidden="true" />
      {inventoryStatusLabel(status)}
    </span>
  )
}

/** 将库存状态映射到现有语义色层级。 */
function inventoryStatusTone(status: ReagentInventoryProjection['status']): 'success' | 'info' | 'warning' | 'archived' {
  if (status === 'available') return 'success'
  if (status === 'reserved') return 'info'
  if (status === 'empty') return 'archived'
  return 'warning'
}

/** 返回库存状态中文标签。 */
function inventoryStatusLabel(status: ReagentInventoryProjection['status']): string {
  if (status === 'available') return '可用'
  if (status === 'reserved') return '已预留'
  if (status === 'empty') return '已耗尽'
  if (status === 'quarantined') return '已隔离'
  return '状态不明'
}

/** 渲染带可访问名称的紧凑行操作。 */
function RowAction({
  icon,
  label,
  disabled,
  onClick
}: {
  icon: WorkstationIconName
  label: string
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={disabled ? `${label}（权威字段缺失）` : label}
    >
      <WorkstationIcon name={icon} />
    </Button>
  )
}

/** 格式化实例密度及其可选测定条件。 */
function formatDensity(item: ReagentInventoryProjection): string {
  if (item.densityGPerMl == null) return '—'
  const condition = metadataText(item.metadata, ['density_condition'])
  return `${item.densityGPerMl.toLocaleString('zh-CN')} g/mL${condition ? ` · ${condition}` : ''}`
}

/** 格式化一个已知数量；缺失维度显示为未知。 */
function formatQuantity(value: number | undefined, unit: string | undefined): string {
  return value == null ? '—' : `${value.toLocaleString('zh-CN')} ${unit ?? ''}`.trim()
}

/** 同列展示权威可用量与预留量，并保留缺失维度。 */
function formatAvailability(item: ReagentInventoryProjection): string {
  return `${formatQuantity(item.availableQuantity, item.unit)} / ${formatQuantity(item.reservedQuantity, item.unit)}`
}

/** 格式化有效期为本地日期；非法值保持原文。 */
function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(date)
}

/** 从元数据中的候选键读取第一个标量文本，不解释对象结构。 */
function metadataText(metadata: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

/** 合并英文名和别名作为名称的次级说明。 */
function formatAliases(info: ReagentInfoProjection): string {
  return [info.nameEn, ...info.aliases].filter(Boolean).join(' · ') || '—'
}

const INTERNAL_REAGENT_INFO_METADATA = new Set([
  'source',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by'
])

/** 只提取用户可识别的自定义参数，不暴露前端来源等内部元数据。 */
export function reagentInfoParameterEntries(info: ReagentInfoProjection): readonly string[] {
  const metadata = info.metadata ?? {}
  const nestedParameters = Array.isArray(metadata.custom_parameters)
    ? metadata.custom_parameters.flatMap(parameter => {
      if (!isRecord(parameter)) return []
      const name = scalarText(parameter.name)
      const value = scalarText(parameter.value)
      return name && value ? [`${name}: ${value}`] : []
    })
    : []
  const scalarParameters = Object.entries(metadata).flatMap(([key, value]) => {
    if (key === 'custom_parameters' || INTERNAL_REAGENT_INFO_METADATA.has(key)) return []
    const text = scalarText(value)
    return text ? [`${metadataLabel(key)}: ${text}`] : []
  })
  return [...nestedParameters, ...scalarParameters]
}

/** 把用户自定义参数压缩为表格中的只读摘要。 */
function formatInfoParameters(info: ReagentInfoProjection): string {
  return reagentInfoParameterEntries(info).slice(0, 3).join('；')
}

/** 将未信任元数据中的标量转换为非空展示文本。 */
function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return undefined
}

/** 判断自定义参数元素是否为可读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 将常见元数据键转为产品中文，其余键保持服务端名称。 */
function metadataLabel(key: string): string {
  if (key === 'storage') return '储存要求'
  if (key === 'hazard') return '危险性'
  if (key === 'supplier') return '供应商'
  return key
}

/** 将 Backend 物态枚举转为中文产品文案。 */
function physicalStateLabel(value: string): string {
  if (value === 'liquid') return '液体'
  if (value === 'solid') return '固体'
  if (value === 'gas') return '气体'
  if (value === 'other' || value === 'unknown') return '未确定'
  return value || '—'
}

/** 规范搜索词，使用中文区域的小写规则。 */
function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase('zh-CN')
}
