import { useMemo, useState } from 'react'
import {
  BINDINGS,
  POINTS,
  ROLE_LABELS,
  STATE_LABELS,
  type PointSetVersion,
  type PointBinding,
  type RobotPoint,
  type ValidationState
} from './robotPointFixture'
import {
  PointEditorDrawer,
  type DrawerStep
} from './PointEditorDrawer'
import './RobotPointWorkbench.scss'

/**
 * 渲染仪器设备模块内的机械臂点位管理任务页。
 *
 * @param onBack 返回 Edge 设备目录的导航回调；未提供时隐藏返回入口。
 * @returns 点位目录、结构化详情与失败关闭编辑抽屉。
 * @safety 当前没有点位写服务，所有保存只更新浏览器内存草稿。
 */
export default function RobotPointWorkbench({
  onBack
}: {
  onBack?: () => void
}): React.JSX.Element {
  const initialView = readInitialView()
  const [draftPoints, setDraftPoints] = useState<readonly RobotPoint[]>(POINTS)
  const [draftBindings, setDraftBindings] = useState<readonly PointBinding[]>(BINDINGS)
  const [pointSetVersion, setPointSetVersion] = useState<PointSetVersion>(initialView.version)
  const [selectedId, setSelectedId] = useState(initialView.pointId)
  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState<ValidationState | 'all'>('all')
  const [drawerOpen, setDrawerOpen] = useState(initialView.drawerOpen)
  const [drawerStep, setDrawerStep] = useState<DrawerStep>(initialView.step)
  const [dirty, setDirty] = useState(initialView.dirty)
  const [notice, setNotice] = useState('')

  // 点位集版本决定读取不可变基线还是浏览器内存草稿，两者不会静默合并。
  const points = pointSetVersion === 'ptlc-main@v12' ? POINTS : draftPoints
  const bindings = pointSetVersion === 'ptlc-main@v12' ? BINDINGS : draftBindings
  // selectedId 是当前点位稳定标识；binding 是独立的部署所有绑定投影。
  const selected = points.find((point) => point.id === selectedId) ?? points[0]
  const binding = bindings.find((item) =>
    [item.approach, item.interact, item.retreat].includes(selected.id)
  ) ?? null
  const visiblePoints = useMemo(
    () => filterPoints(points, query, stateFilter),
    [points, query, stateFilter]
  )

  /** 将候选点位和绑定补丁写入当前浏览器内存草稿版本。 */
  const saveDraft = (patch: Partial<RobotPoint>, bindingDraft: PointBinding | null): void => {
    const createsDraftVersion = pointSetVersion === 'ptlc-main@v12'
    setDraftPoints((current) => current.map((point) =>
      point.id === selected.id ? { ...point, ...patch } : point
    ))
    if (bindingDraft) {
      setDraftBindings((current) => {
        const next = current.filter((item) => item.id !== bindingDraft.id)
        return [...next, bindingDraft]
      })
    }
    setPointSetVersion('ptlc-main@v13-draft')
    setDirty(false)
    setNotice(createsDraftVersion
      ? '已从 v12 基线创建浏览器内存草稿 ptlc-main@v13-draft；v12 保持不可变，且未写入控制器或生产配置。'
      : '已更新浏览器内存中的 ptlc-main@v13-draft；未写入控制器或生产配置。')
  }

  /** 在存在未保存草稿时要求操作员明确确认放弃。 */
  const confirmDiscard = (): boolean => !dirty || window.confirm('当前有未保存修改。放弃修改并继续吗？')
  /** 通过放弃确认后关闭编辑抽屉并清空临时提示。 */
  const closeDrawer = (): void => {
    if (!confirmDiscard()) return
    setDrawerOpen(false)
    setDirty(false)
    setNotice('')
  }

  return (
    <section className="robot-point-workbench">
      <PageHeader onBack={onBack} />
      <main className="point-page">
        <PrototypeNotice />
        <PointSetBar
          version={pointSetVersion}
          onVersionChange={(version) => {
            if (!confirmDiscard()) return
            setPointSetVersion(version)
            setDirty(false)
            setNotice('')
          }}
        />
        <div className={`point-layout${drawerOpen ? ' has-drawer' : ''}`}>
          <PointDirectory
            points={visiblePoints}
            selectedId={selected.id}
            query={query}
            stateFilter={stateFilter}
            pointSetVersion={pointSetVersion}
            onQueryChange={setQuery}
            onStateFilterChange={setStateFilter}
            onSelect={(id) => {
              if (!confirmDiscard()) return
              setSelectedId(id)
              setDirty(false)
              setNotice('')
            }}
          />
          <PointDetail
            point={selected}
            binding={binding}
            drawerOpen={drawerOpen}
            onEdit={() => setDrawerOpen(true)}
          />
          {drawerOpen ? (
            <PointEditorDrawer
              point={selected}
              binding={binding}
              points={points}
              pointSetVersion={pointSetVersion}
              step={drawerStep}
              dirty={dirty}
              notice={notice}
              onStepChange={setDrawerStep}
              onDirty={() => {
                setDirty(true)
                setNotice('')
              }}
              onClose={closeDrawer}
              onSave={saveDraft}
            />
          ) : null}
        </div>
      </main>
    </section>
  )
}

/**
 * 绘制机械臂身份、连接上下文与返回设备目录入口。
 *
 * @param onBack 返回 Edge 设备目录的可选回调。
 * @returns 点位管理页头。
 */
function PageHeader({ onBack }: { onBack?: () => void }): React.JSX.Element {
  return (
    <header className="page-header">
      <div>
        {onBack ? (
          <button type="button" className="robot-point-back" onClick={onBack}>
            <span aria-hidden="true">←</span>
            仪器设备 / 主机械臂
          </button>
        ) : <span>仪器设备 / 主机械臂</span>}
        <h1>机械臂点位管理</h1>
      </div>
      <div className="header-context">
        <span className="robot-state"><i />远程自动 · 空闲</span>
        <code>FAIRINO FR5 · SN FR5-24-0718</code>
      </div>
    </header>
  )
}

/**
 * 标明演示数据、内存写入与物理运动的失败关闭边界。
 *
 * @returns 不可忽略的能力边界说明。
 */
function PrototypeNotice(): React.JSX.Element {
  return (
    <div className="prototype-notice" role="note">
      <strong>点位服务未接入 · 演示数据</strong>
      <span>保存只修改浏览器内存；不会写入控制器、点位集或库位控制绑定（SiteControlBinding），也不会执行点位运动（Point Motion）。</span>
    </div>
  )
}

/** 展示机械臂、点位集版本、标定和工具上下文。 */
function PointSetBar({ version, onVersionChange }: { version: PointSetVersion; onVersionChange: (version: PointSetVersion) => void }): React.JSX.Element {
  return (
    <section className="point-set-bar" aria-label="当前点位集">
      <label><span>机械臂 · 原型固定</span><select value="main" disabled title="原型仅提供一台机械臂"><option value="main">主机械臂 · FR5</option></select></label>
      <label><span>点位集</span><select value={version} onChange={(event) => onVersionChange(event.target.value as PointSetVersion)}><option value="ptlc-main@v12">ptlc-main@v12 · 当前基线</option><option value="ptlc-main@v13-draft">ptlc-main@v13-draft · 本地草稿</option></select></label>
      <div className="context-value"><span>基坐标 / 标定</span><code>cell_base@cal-2026-08-08</code></div>
      <div className="context-value"><span>工具 / TCP</span><code>plate-gripper-tcp@v2</code></div>
      <StatusPill state={version === 'ptlc-main@v12' ? 'robot_validated' : 'draft'} label={version === 'ptlc-main@v12' ? '当前基线版本' : '本地草稿 · 待验证'} />
      <div className="bar-actions">
        <button type="button" disabled title="点位集导入流程未纳入本原型">导入点位集</button>
        <button type="button" className="primary" disabled title="新建点位流程未纳入本原型">＋ 新建点位</button>
      </div>
      <small className="bar-boundary">导入与新建流程未接入原型</small>
    </section>
  )
}

interface DirectoryProps {
  points: readonly RobotPoint[]
  selectedId: string
  query: string
  stateFilter: ValidationState | 'all'
  pointSetVersion: PointSetVersion
  onQueryChange: (query: string) => void
  onStateFilterChange: (state: ValidationState | 'all') => void
  onSelect: (id: string) => void
}

/** 渲染可搜索、可按验证状态筛选的点位目录。 */
function PointDirectory(props: DirectoryProps): React.JSX.Element {
  const groups = groupPoints(props.points)
  return (
    <aside className="point-directory" aria-label="点位目录">
      <header><div><h2>点位目录</h2><span>{props.points.length} 个可见点位 · 批量操作未接入</span></div><button type="button" aria-label="目录更多操作" disabled title="批量点位操作未纳入本原型">•••</button></header>
      <div className="directory-tools">
        <label className="search-field"><span>⌕</span><input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索点位名称或 ID" aria-label="搜索点位" /></label>
        <select aria-label="按验证状态筛选" value={props.stateFilter} onChange={(event) => props.onStateFilterChange(event.target.value as ValidationState | 'all')}>
          <option value="all">全部验证状态</option>
          <option value="approved">已批准</option>
          <option value="robot_validated">真机已验证</option>
          <option value="simulation_validated">仿真已验证</option>
          <option value="draft">草稿</option>
        </select>
      </div>
      <div className="directory-scroll">
        {[...groups.entries()].map(([group, items]) => (
          <section className="point-group" key={group}>
            <h3><span>{group}</span><small>{items.length}</small></h3>
            {items.map((point) => (
              <button key={point.id} type="button" className={`point-row${point.id === props.selectedId ? ' selected' : ''}`} aria-current={point.id === props.selectedId ? 'true' : undefined} onClick={() => props.onSelect(point.id)}>
                <PointRoleIcon role={point.role} />
                <span><strong>{point.name}</strong><code>{point.id}</code></span>
                <StatusMarker state={point.state} />
              </button>
            ))}
          </section>
        ))}
      </div>
      <footer><span>状态来自当前点位集版本</span><code>{props.pointSetVersion === 'ptlc-main@v12' ? 'v12 · sha256:8d41…bf20' : 'v13-draft · 浏览器内存'}</code></footer>
    </aside>
  )
}

/** 展示当前点位的坐标、运动约束、绑定序列与验证证据。 */
function PointDetail({ point, binding, drawerOpen, onEdit }: { point: RobotPoint; binding: PointBinding | null; drawerOpen: boolean; onEdit: () => void }): React.JSX.Element {
  return (
    <section className="point-detail" aria-label={`${point.name} 点位详情`}>
      <header className="detail-head">
        <div className="detail-title"><PointRoleIcon role={point.role} large /><div><span>{ROLE_LABELS[point.role]} · {point.kind}</span><h2>{point.name}</h2><code>{point.id}</code></div></div>
        <div className="detail-actions"><StatusPill state={point.state} /><button type="button" onClick={onEdit}>{drawerOpen ? '正在编辑' : '编辑点位'}</button></div>
      </header>
      <div className="detail-scroll">
        <section className="measurement-panel">
          <div className="section-heading"><div><h3>位姿与关节构型</h3><span>基坐标 cell_base@cal-2026-08-08 · 单位 mm / degree</span></div><span className="data-source">{point.source}</span></div>
          <div className="coordinate-grid">
            {['X', 'Y', 'Z'].map((axis, index) => <Measurement key={axis} label={axis} value={point.position[index] ?? 0} unit="mm" />)}
            {['Rx', 'Ry', 'Rz'].map((axis, index) => <Measurement key={axis} label={axis} value={point.rotation[index] ?? 0} unit="°" />)}
          </div>
          <div className="joint-strip">
            <span>关节构型</span>
            {point.joints ? point.joints.map((value, index) => <code key={index}>J{index + 1} {value.toFixed(1)}°</code>) : <small>衍生点不保存关节角；仅允许经过验证的笛卡尔段。</small>}
          </div>
        </section>
        <div className="detail-columns">
          <section className="constraint-panel">
            <div className="section-heading"><div><h3>运动约束</h3><span>运行请求只能在批准上限内收紧</span></div></div>
            <dl>
              <div><dt>允许运动</dt><dd>{point.motion.map((motion) => <code key={motion}>{motion}</code>)}</dd></div>
              <div><dt>最大速度</dt><dd><strong>{point.maxSpeed}%</strong></dd></div>
              <div><dt>最大加速度</dt><dd><strong>{point.acceleration}%</strong></dd></div>
              <div><dt>位置容差</dt><dd><strong>± {point.positionTolerance} mm</strong></dd></div>
              <div><dt>姿态容差</dt><dd><strong>± {point.rotationTolerance}°</strong></dd></div>
            </dl>
            <button type="button" disabled title="需要有效的调试会话、运动许可与真机连接">移动到此点位</button>
            <small className="disabled-reason">需要有效调试会话；当前原型保持失败关闭。</small>
          </section>
          <ValidationPanel point={point} />
        </div>
        <BindingPanel binding={binding} selectedId={point.id} />
      </div>
    </section>
  )
}

/** 展示库位控制绑定，不读取或修改库位占用。 */
function BindingPanel({ binding, selectedId }: { binding: PointBinding | null; selectedId: string }): React.JSX.Element {
  if (!binding) return <section className="binding-panel empty"><h3>库位控制绑定</h3><p>当前点位未关联库位动作，可在右侧编辑器中选择稳定库位身份并创建草稿绑定。</p></section>
  const phases = [['接近', binding.approach], ['交互', binding.interact], ['退出', binding.retreat]] as const
  return (
    <section className="binding-panel">
      <div className="section-heading"><div><h3>库位控制绑定（SiteControlBinding）</h3><span>{binding.owner} / {binding.siteLabel} · {binding.operation}</span></div><StatusPill label={binding.status === 'validated' ? '绑定已验证' : '绑定草稿'} state={binding.status === 'validated' ? 'robot_validated' : 'draft'} /></div>
      <div className="binding-meta"><span><small>稳定库位身份</small><code>{binding.siteUuid}</code></span><span><small>程序</small><code>{binding.program}</code></span><span><small>工具 / 负载</small><code>{binding.tool} · {binding.payload}</code></span></div>
      <div className="motion-sequence" aria-label="取放点位序列">
        {phases.map(([label, id], index) => (
          <div key={id} className={id === selectedId ? 'active' : ''}><span>{index + 1}</span><small>{label}</small><code>{id}</code></div>
        ))}
      </div>
      <p className="binding-note">绑定只描述如何接近和操作库位；当前物料与库位占用（SiteOccupancy）由库存权威独立维护。</p>
    </section>
  )
}

/** 展示分层验证结果，并明确当前版本尚未批准。 */
function ValidationPanel({ point }: { point: RobotPoint }): React.JSX.Element {
  const checks = [
    ['Schema 与单位', true],
    ['可达性 / 关节限位', true],
    ['碰撞与接近路径', point.state !== 'draft'],
    ['真机低速复核', ['approved', 'robot_validated'].includes(point.state)]
  ] as const
  return (
    <section className="validation-panel">
      <div className="section-heading"><div><h3>验证证据</h3><span>最后更新 {point.validatedAt}</span></div></div>
      <ul>{checks.map(([label, passed]) => <li key={label} className={passed ? 'passed' : 'pending'}><span>{passed ? '✓' : '•'}</span><strong>{label}</strong><small>{passed ? '已通过' : '待完成'}</small></li>)}</ul>
    </section>
  )
}

/** 根据统一数据字体渲染一个可比较的位姿测量值。 */
function Measurement({ label, value, unit }: { label: string; value: number; unit: string }): React.JSX.Element {
  return <div className="measurement"><span>{label}</span><strong>{value.toFixed(1)}</strong><small>{unit}</small></div>
}

/** 将验证状态投影为同时包含文字与颜色的状态标签。 */
function StatusPill({ state, label }: { state: ValidationState; label?: string }): React.JSX.Element {
  return <span className={`status-pill state-${state}`}><i />{label ?? STATE_LABELS[state]}</span>
}

/** 将验证状态投影为点位目录中的紧凑文字标记。 */
function StatusMarker({ state }: { state: ValidationState }): React.JSX.Element {
  const shortLabels: Record<ValidationState, string> = {
    approved: '批准',
    robot_validated: '真机',
    simulation_validated: '仿真',
    draft: '草稿'
  }
  return <span className={`status-marker state-${state}`} aria-label={STATE_LABELS[state]} title={STATE_LABELS[state]}><i />{shortLabels[state]}</span>
}

/** 根据点位用途绘制不承担独立语义的几何图标。 */
function PointRoleIcon({ role, large = false }: { role: RobotPoint['role']; large?: boolean }): React.JSX.Element {
  return <span className={`role-icon role-${role}${large ? ' large' : ''}`} aria-hidden="true">{role === 'interact' ? '◎' : role === 'approach' ? '↘' : role === 'retreat' ? '↗' : role === 'park' ? '⌂' : '◇'}</span>
}

/** 按目录分组保持点位集的声明顺序。 */
function groupPoints(points: readonly RobotPoint[]): Map<string, readonly RobotPoint[]> {
  const groups = new Map<string, RobotPoint[]>()
  points.forEach((point) => groups.set(point.group, [...(groups.get(point.group) ?? []), point]))
  return groups
}

/** 按名称、稳定标识、分组和验证状态筛选点位。 */
export function filterPoints(points: readonly RobotPoint[], query: string, state: ValidationState | 'all'): readonly RobotPoint[] {
  const normalized = query.trim().toLowerCase()
  return points.filter((point) =>
    (state === 'all' || point.state === state) &&
    (!normalized || [point.name, point.id, point.group, ROLE_LABELS[point.role]].some((value) => value.toLowerCase().includes(normalized)))
  )
}

/**
 * 只为可重复截图和深链接提供确定性初始状态。
 *
 * @returns 经白名单校验的点位集版本、点位、抽屉步骤与草稿状态。
 */
function readInitialView(): { version: PointSetVersion; pointId: string; drawerOpen: boolean; step: DrawerStep; dirty: boolean } {
  const params = new URLSearchParams(window.location.search)
  const version = params.get('version') === 'ptlc-main@v13-draft' ? 'ptlc-main@v13-draft' : 'ptlc-main@v12'
  const requestedPoint = params.get('point')
  const pointId = requestedPoint && POINTS.some((point) => point.id === requestedPoint)
    ? requestedPoint
    : 's04.p01.pick.interact'
  const requestedStep = params.get('step') as DrawerStep | null
  const validSteps: readonly DrawerStep[] = ['basic', 'coordinate', 'motion', 'binding', 'validation']
  const step = requestedStep && validSteps.includes(requestedStep) ? requestedStep : 'coordinate'
  return {
    version,
    pointId,
    drawerOpen: params.get('drawer') !== '0',
    step,
    dirty: params.get('dirty') === '1'
  }
}
