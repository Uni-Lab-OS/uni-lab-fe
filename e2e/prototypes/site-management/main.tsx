import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type VariantKey = 'A' | 'B'
type OccupancyState = 'empty' | 'occupied' | 'unknown'
type SensorState = 'fresh' | 'stale' | 'not_managed'
type ClaimState = 'none' | 'running' | 'uncertain'

interface SiteRow {
  id: string
  label: string
  owner: string
  zone: string
  kind: string
  compatible: string
  occupancy: OccupancyState
  occupant?: string
  occupantCode?: string
  sensor: SensorState
  claim: ClaimState
  claimJob?: string
  quarantined: boolean
  updatedAt: string
  checkedAt: string
  anomaly?: string
  coordinate: string
}

const VARIANT_NAMES: Record<VariantKey, string> = {
  A: '运营台账',
  B: '异常处置'
}

// 原型库位身份使用稳定字符串，模拟服务端库位（Site）UUID，不承担真实权威。
const SITE_FIXTURE: readonly SiteRow[] = [
  { id: 'site-s2-t11', label: 'T11', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'occupied', occupant: 'TIP盒-200μL-018', occupantCode: 'TIP-202608-018', sensor: 'fresh', claim: 'none', quarantined: false, updatedAt: '09:41:22', checkedAt: '今天 08:30', coordinate: 'X 420 · Y 180 · Z 1260 mm' },
  { id: 'site-s2-t12', label: 'T12', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'empty', sensor: 'fresh', claim: 'none', quarantined: false, updatedAt: '09:41:22', checkedAt: '今天 08:30', coordinate: 'X 610 · Y 180 · Z 1260 mm' },
  { id: 'site-s2-t21', label: 'T21', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'unknown', occupant: 'TIP盒-200μL-021', occupantCode: 'TIP-202608-021', sensor: 'stale', claim: 'uncertain', claimJob: 'job_7f12…9ac1', quarantined: false, updatedAt: '09:36:04', checkedAt: '昨天 17:10', anomaly: '在位观测已超过新鲜度 TTL，禁止自动分配。', coordinate: 'X 420 · Y 180 · Z 930 mm' },
  { id: 'site-s2-t22', label: 'T22', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'occupied', occupant: 'TIP盒-200μL-024', occupantCode: 'TIP-202608-024', sensor: 'fresh', claim: 'running', claimJob: 'job_8f2a…1d07', quarantined: false, updatedAt: '09:41:20', checkedAt: '今天 08:30', coordinate: 'X 610 · Y 180 · Z 930 mm' },
  { id: 'site-s2-t31', label: 'T31', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'empty', sensor: 'fresh', claim: 'none', quarantined: true, updatedAt: '09:41:21', checkedAt: '今天 08:30', anomaly: '维护隔离：导轨阻力偏高，等待现场复核。', coordinate: 'X 420 · Y 180 · Z 600 mm' },
  { id: 'site-s2-t32', label: 'T32', owner: 'S2 TIP 仓', zone: '北区 / 自动仓储', kind: 'TIP 盒位', compatible: 'TIP Rack 200 μL', occupancy: 'occupied', occupant: 'TIP盒-200μL-031', occupantCode: 'TIP-202608-031', sensor: 'fresh', claim: 'none', quarantined: false, updatedAt: '09:41:22', checkedAt: '今天 08:30', coordinate: 'X 610 · Y 180 · Z 600 mm' },
  { id: 'site-s10-r01', label: 'R01', owner: 'S10 试剂瓶仓', zone: '南区 / 冷藏单元', kind: '试剂瓶位', compatible: '500 mL Reagent Bottle', occupancy: 'occupied', occupant: '乙腈-批次 ACN2608', occupantCode: 'RG-ACN-2608-03', sensor: 'fresh', claim: 'none', quarantined: false, updatedAt: '09:41:19', checkedAt: '今天 07:50', coordinate: 'X 2210 · Y 940 · Z 820 mm' },
  { id: 'site-s10-r02', label: 'R02', owner: 'S10 试剂瓶仓', zone: '南区 / 冷藏单元', kind: '试剂瓶位', compatible: '500 mL Reagent Bottle', occupancy: 'unknown', sensor: 'fresh', claim: 'none', quarantined: false, updatedAt: '09:41:19', checkedAt: '未盘点', anomaly: '传感器报告有物体，物料权威记录为空；需要人工核对。', coordinate: 'X 2390 · Y 940 · Z 820 mm' },
  { id: 'site-s04-p01', label: 'P01', owner: 'S4 移液工作站', zone: '中区 / 移液单元', kind: '孔板工位', compatible: 'SBS Plate', occupancy: 'occupied', occupant: 'PCR板-96孔-007', occupantCode: 'PCR-96-202608-007', sensor: 'fresh', claim: 'running', claimJob: 'job_12c4…8ea0', quarantined: false, updatedAt: '09:41:23', checkedAt: '今天 09:12', coordinate: 'X 1280 · Y 640 · Z 910 mm' },
  { id: 'site-s04-p02', label: 'P02', owner: 'S4 移液工作站', zone: '中区 / 移液单元', kind: '孔板工位', compatible: 'SBS Plate', occupancy: 'empty', sensor: 'not_managed', claim: 'none', quarantined: false, updatedAt: '09:40:55', checkedAt: '今天 09:12', coordinate: 'X 1460 · Y 640 · Z 910 mm' }
]

/**
 * 渲染库位管理平面页面原型，并把所有修改限制在内存演示状态。
 * @returns 当前 URL 选择的列表管理或异常处置方案。
 */
function App(): React.JSX.Element {
  const initialVariant = readVariant()
  const [variant, setVariant] = useState<VariantKey>(initialVariant)
  const [selectedId, setSelectedId] = useState('site-s2-t21')
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [quarantinedIds, setQuarantinedIds] = useState<Set<string>>(
    () => new Set(SITE_FIXTURE.filter((site) => site.quarantined).map((site) => site.id))
  )
  const [query, setQuery] = useState('')

  // 原型中的隔离身份集合只改变本地展示，不写入库位（Site）或库位占用（SiteOccupancy）权威。
  const sites = useMemo(
    () => SITE_FIXTURE.map((site) => ({ ...site, quarantined: quarantinedIds.has(site.id) })),
    [quarantinedIds]
  )
  const selectedSite = sites.find((site) => site.id === selectedId) ?? sites[0]

  /**
   * 切换平面页面结构方案，并更新可分享的 URL 参数。
   * @param next 下一项原型方案键。
   * @returns 无返回值。
   */
  const changeVariant = (next: VariantKey): void => {
    setVariant(next)
    writeQuery(next)
  }

  /** 切换一条库位记录的批量选择状态。 */
  const toggleChecked = (siteId: string): void => {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  /** 将已选择库位标记为原型内存隔离，不修改真实调度或物料事实。 */
  const quarantineChecked = (): void => {
    setQuarantinedIds((current) => new Set([...current, ...checkedIds]))
    setCheckedIds(new Set())
  }

  const shared = { sites, selectedSite, setSelectedId, checkedIds, toggleChecked, query, setQuery, quarantineChecked }

  return (
    <>
      {variant === 'A' ? <VariantA {...shared} /> : null}
      {variant === 'B' ? <VariantB {...shared} /> : null}
      {!import.meta.env.PROD ? (
        <PrototypeSwitcher current={variant} onChange={changeVariant} />
      ) : null}
    </>
  )
}

type VariantProps = {
  sites: readonly SiteRow[]
  selectedSite: SiteRow
  setSelectedId: (siteId: string) => void
  checkedIds: Set<string>
  toggleChecked: (siteId: string) => void
  query: string
  setQuery: (query: string) => void
  quarantineChecked: () => void
}

/**
 * 以高密度库位台账为主要工作面，右侧检查器保持稳定。
 * @param props 平面库位读取集合、选中身份与内存交互回调。
 * @returns 运营台账方案页面。
 */
function VariantA(props: VariantProps): React.JSX.Element {
  const filteredSites = filterSites(props.sites, props.query)
  return (
    <AppFrame>
      <PageHeader title="库位管理" path="资源与库存 / 库位" />
      <main className="ledger-page">
        <PrototypeNotice />
        <SummaryStrip sites={props.sites} />
        <div className="ledger-grid">
          <section className="ledger-main" aria-label="库位列表">
            <ListToolbar {...props} />
            <SiteTable {...props} sites={filteredSites} />
            <div className="table-footer"><span>显示 {filteredSites.length} / {props.sites.length} 个稳定库位</span><span>快照时间 09:41:23</span></div>
          </section>
          <Inspector site={props.selectedSite} />
        </div>
      </main>
    </AppFrame>
  )
}

/**
 * 按风险优先排列库位，把盘点与异常处置放在第一层。
 * @param props 平面库位读取集合、选中身份与内存交互回调。
 * @returns 异常处置方案页面。
 */
function VariantB(props: VariantProps): React.JSX.Element {
  const attentionSites = props.sites.filter((site) => site.anomaly || site.quarantined || site.claim !== 'none')
  return (
    <AppFrame>
      <PageHeader title="库位异常处置" path="资源与库存 / 库位 / 需要关注" />
      <main className="triage-page">
        <PrototypeNotice />
        <section className="triage-band" aria-label="处置摘要">
          <div><span>待人工核对</span><strong>2</strong><small>传感事实与逻辑事实不一致</small></div>
          <div><span>执行不确定</span><strong>1</strong><small>保留作业执行占用（JobExecutionClaim）</small></div>
          <div><span>维护隔离</span><strong>1</strong><small>禁止自动复用</small></div>
          <button type="button">发起盘点任务</button>
        </section>
        <div className="triage-grid">
          <aside className="triage-queue">
            <h2>处置队列</h2>
            <button type="button" className="queue-item active"><span>全部需要关注</span><strong>{attentionSites.length}</strong></button>
            <button type="button" className="queue-item"><span>观测未知</span><strong>2</strong></button>
            <button type="button" className="queue-item"><span>执行中或不确定</span><strong>3</strong></button>
            <button type="button" className="queue-item"><span>维护隔离</span><strong>1</strong></button>
            <div className="queue-note"><strong>失败关闭</strong><p>未知或矛盾证据不会自动清空占用，也不会猜测物料身份。</p></div>
          </aside>
          <section className="triage-list" aria-label="异常库位列表">
            <div className="triage-list-head"><div><h2>需要关注的库位</h2><span>按风险与更新时间排序</span></div></div>
            {attentionSites.map((site) => (
              <button key={site.id} type="button" className={`attention-row${site.id === props.selectedSite.id ? ' selected' : ''}`} onClick={() => props.setSelectedId(site.id)}>
                <span className="attention-severity" data-level={site.claim === 'uncertain' ? 'danger' : 'warning'}>{site.claim === 'uncertain' ? '高' : '中'}</span>
                <span><strong>{site.owner} / {site.label}</strong><small>{site.anomaly ?? (site.claim === 'running' ? '当前作业正在使用该库位。' : '库位处于维护隔离。')}</small></span>
                <StatusTag kind="occupancy" value={site.occupancy} />
                <span className="attention-time">{site.updatedAt}</span>
              </button>
            ))}
          </section>
          <Inspector site={props.selectedSite} compact />
        </div>
      </main>
    </AppFrame>
  )
}

/**
 * 提供 Uni-Lab 顶栏和一级导航，使原型处于真实应用密度中。
 * @param children 当前库位管理方案页面。
 * @returns 固定激活库位模块的应用外壳。
 */
function AppFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  const navItems = [['device', '仪器设备', '⌁'], ['sites', '库位', '▦'], ['material', '物料', '◇'], ['reagent', '试剂', '◉'], ['workflow', '工作流', '⌘']]
  return <div className="app-frame"><header className="topbar"><strong>Uni-Lab</strong><span className="topbar-separator" /><span>实验室自动化工作台</span><div className="topbar-state"><span className="online-dot" />Edge 在线</div><button type="button" className="avatar" aria-label="用户菜单">UL</button></header><div className="app-body"><nav className="primary-nav" aria-label="主导航">{navItems.map(([id, label, icon]) => <button key={id} type="button" aria-current={id === 'sites' ? 'page' : undefined} className={id === 'sites' ? 'active' : ''}><span>{icon}</span><small>{label}</small></button>)}</nav><div className="page-stage">{children}</div></div></div>
}

/**
 * 渲染页面身份与权威快照时间，不提供空间视图入口。
 * @param title 当前页面标题。
 * @param path 当前页面的产品路径。
 * @returns 库位模块页头。
 */
function PageHeader({ title, path }: { title: string; path: string }): React.JSX.Element {
  return <header className="page-header"><div><span>{path}</span><h1>{title}</h1></div><span className="snapshot">权威快照 · 09:41:23</span></header>
}

/** 明确样例数据和内存交互边界，防止原型被误认成生产能力。 */
function PrototypeNotice(): React.JSX.Element {
  return <div className="prototype-notice" role="note"><strong>交互原型 · 演示数据</strong><span>页面操作只改变浏览器内存，不会写入物料权威、库位占用（SiteOccupancy）或作业执行占用（JobExecutionClaim）。</span></div>
}

/** 从同一库位读取集合计算页面摘要，不持久化第二份计数。 */
function SummaryStrip({ sites }: { sites: readonly SiteRow[] }): React.JSX.Element {
  const metrics = [
    ['全部库位', sites.length, '一个读取快照'],
    ['已占用', sites.filter((site) => site.occupancy === 'occupied').length, '物料身份已确认'],
    ['空库位', sites.filter((site) => site.occupancy === 'empty').length, '不等于可调度'],
    ['状态未知', sites.filter((site) => site.occupancy === 'unknown').length, '保持失败关闭'],
    ['隔离 / 执行中', sites.filter((site) => site.quarantined || site.claim !== 'none').length, '独立状态轴']
  ]
  return <section className="summary-strip" aria-label="库位摘要">{metrics.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</section>
}

/** 提供库位搜索、筛选和批量隔离入口。 */
function ListToolbar(props: VariantProps): React.JSX.Element {
  return <div className="list-toolbar"><label className="search-field"><span>⌕</span><input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="搜索库位、所属设备或占用物料" aria-label="搜索库位" /></label><select aria-label="按占用状态筛选" defaultValue="all"><option value="all">全部占用状态</option><option>已占用</option><option>空</option><option>未知</option></select><select aria-label="按区域筛选" defaultValue="all"><option value="all">全部区域</option><option>北区</option><option>中区</option><option>南区</option></select><div className="toolbar-spacer" /><span className="selection-count">已选 {props.checkedIds.size}</span><button type="button" disabled={props.checkedIds.size === 0} onClick={props.quarantineChecked}>批量隔离</button><button type="button">发起盘点</button></div>
}

/** 渲染库位列表并保持占用、隔离和执行占用三个状态轴分离。 */
function SiteTable(props: VariantProps & { sites: readonly SiteRow[] }): React.JSX.Element {
  return <div className="table-scroll"><table className="site-table"><thead><tr><th aria-label="选择" /><th>库位</th><th>所属设备 / 区域</th><th>类型与兼容</th><th>库位占用</th><th>当前物料</th><th>在位观测</th><th>运维 / 执行</th><th>更新时间</th></tr></thead><tbody>{props.sites.map((site) => <tr key={site.id} className={site.id === props.selectedSite.id ? 'selected' : ''} onClick={() => props.setSelectedId(site.id)}><td><input type="checkbox" checked={props.checkedIds.has(site.id)} onChange={() => props.toggleChecked(site.id)} onClick={(event) => event.stopPropagation()} aria-label={`选择库位 ${site.label}`} /></td><td><strong>{site.label}</strong><code>{site.id}</code></td><td><strong>{site.owner}</strong><small>{site.zone}</small></td><td><strong>{site.kind}</strong><small>{site.compatible}</small></td><td><StatusTag kind="occupancy" value={site.occupancy} /></td><td>{site.occupant ? <><strong>{site.occupant}</strong><code>{site.occupantCode}</code></> : <span className="empty-value">—</span>}</td><td><StatusTag kind="sensor" value={site.sensor} /></td><td><div className="stacked-tags">{site.quarantined ? <StatusTag kind="quarantine" value="quarantined" /> : <span className="plain-state">正常</span>}{site.claim !== 'none' ? <StatusTag kind="claim" value={site.claim} /> : <span className="plain-state">无执行占用</span>}</div></td><td><code>{site.updatedAt}</code><small>{site.checkedAt}</small></td></tr>)}</tbody></table></div>
}

/** 展示共用库位检查器；历史与异常均围绕当前稳定库位身份组织。 */
function Inspector({ site, compact = false }: { site: SiteRow; compact?: boolean }): React.JSX.Element {
  const [tab, setTab] = useState<'overview' | 'history'>('overview')
  return <aside className={`inspector${compact ? ' compact' : ''}`} aria-label={`${site.label} 库位检查器`}><div className="inspector-head"><div><span>{site.owner}</span><h2>{site.label}</h2></div><StatusTag kind="occupancy" value={site.occupancy} /></div><div className="inspector-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>当前状态</button><button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史记录</button></div>{tab === 'overview' ? <><section className="inspector-section"><h3>物理位置</h3><dl><div><dt>稳定身份</dt><dd><code>{site.id}</code></dd></div><div><dt>空间坐标</dt><dd><code>{site.coordinate}</code></dd></div><div><dt>兼容类型</dt><dd>{site.compatible}</dd></div></dl></section><section className="inspector-section"><h3>独立状态轴</h3><div className="axis-row"><span>库位占用（SiteOccupancy）</span><StatusTag kind="occupancy" value={site.occupancy} /></div><div className="axis-row"><span>在位传感观测</span><StatusTag kind="sensor" value={site.sensor} /></div><div className="axis-row"><span>作业执行占用</span>{site.claim === 'none' ? <span className="plain-state">无</span> : <StatusTag kind="claim" value={site.claim} />}</div><div className="axis-row"><span>运维隔离</span>{site.quarantined ? <StatusTag kind="quarantine" value="quarantined" /> : <span className="plain-state">正常</span>}</div></section>{site.occupant ? <section className="material-block"><span>当前占用物料</span><strong>{site.occupant}</strong><code>{site.occupantCode}</code><button type="button">查看物料详情</button></section> : null}{site.anomaly ? <section className="anomaly-block" role="alert"><strong>需要人工核对</strong><p>{site.anomaly}</p><button type="button">打开处置记录</button></section> : null}<div className="inspector-actions"><button type="button">配置库位</button><button type="button" className="primary">发起盘点</button></div></> : <HistoryTimeline site={site} />}</aside>
}

/** 提供围绕当前库位身份的演示历史，不把日志伪装成真实服务数据。 */
function HistoryTimeline({ site }: { site: SiteRow }): React.JSX.Element {
  return <div className="history-list"><article><time>今天 09:41</time><strong>读取占用快照</strong><p>{site.occupancy === 'unknown' ? '观测证据不足，状态保持未知。' : '逻辑事实与传感观测一致。'}</p></article><article><time>今天 08:30</time><strong>完成日常盘点</strong><p>操作员：林值班 · 演示记录</p></article><article><time>昨天 16:18</time><strong>兼容规则已复核</strong><p>{site.compatible}</p></article></div>
}

/** 统一渲染物理占用、传感观测、执行占用和隔离标签。 */
function StatusTag({ kind, value }: { kind: 'occupancy' | 'sensor' | 'claim' | 'quarantine'; value: string }): React.JSX.Element {
  const labels: Record<string, string> = { empty: '空', occupied: '已占用', unknown: '未知', fresh: '新鲜', stale: '已过期', not_managed: '未接传感器', running: '执行中', uncertain: '执行不确定', quarantined: '已隔离' }
  return <span className={`status-tag ${kind}-${value}`}><i />{labels[value] ?? value}</span>
}

/**
 * 提供开发态平面方案切换，并支持键盘左右方向键。
 * @param current 当前原型方案键。
 * @param onChange 切换方案时调用的内存回调。
 * @returns 开发态浮动方案切换器。
 */
function PrototypeSwitcher({ current, onChange }: { current: VariantKey; onChange: (variant: VariantKey) => void }): React.JSX.Element {
  const variants: readonly VariantKey[] = ['A', 'B']
  useEffect(() => {
    /** 在非输入控件获得焦点时循环切换原型方案。 */
    const handleKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = variants.indexOf(current)
      const offset = event.key === 'ArrowRight' ? 1 : -1
      onChange(variants[(index + offset + variants.length) % variants.length])
    }
    globalThis.addEventListener('keydown', handleKey)
    return () => globalThis.removeEventListener('keydown', handleKey)
  }, [current, onChange])
  const index = variants.indexOf(current)
  return <div className="prototype-switcher" aria-label="原型方案切换"><button type="button" aria-label="上一个方案" onClick={() => onChange(variants[(index - 1 + variants.length) % variants.length])}>←</button><span><strong>{current}</strong> — {VARIANT_NAMES[current]}</span><button type="button" aria-label="下一个方案" onClick={() => onChange(variants[(index + 1) % variants.length])}>→</button></div>
}

/** 根据搜索文本过滤演示库位，不改变原始快照。 */
function filterSites(sites: readonly SiteRow[], query: string): readonly SiteRow[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sites
  return sites.filter((site) => [site.label, site.owner, site.zone, site.occupant, site.occupantCode].some((value) => value?.toLowerCase().includes(normalized)))
}

/**
 * 读取并校验 URL 中的平面原型方案键。
 * @returns 有效方案键；未知值回退为运营台账方案 A。
 */
function readVariant(): VariantKey {
  const value = new URLSearchParams(globalThis.location.search).get('variant')
  return value === 'B' ? value : 'A'
}

/**
 * 将当前平面原型方案写入浏览器地址，并清理旧空间视图参数。
 * @param variant 当前有效方案键。
 * @returns 无返回值。
 */
function writeQuery(variant: VariantKey): void {
  const url = new URL(globalThis.location.href)
  url.searchParams.set('variant', variant)
  url.searchParams.delete('view')
  globalThis.history.replaceState({}, '', url)
}

createRoot(document.getElementById('root')!).render(<App />)
