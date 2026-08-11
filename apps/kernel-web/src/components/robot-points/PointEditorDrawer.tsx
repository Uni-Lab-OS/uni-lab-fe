import { useEffect, useState } from 'react'

import {
  ROLE_LABELS,
  type PointBinding,
  type PointKind,
  type PointRole,
  type PointSetVersion,
  type RobotPoint
} from './robotPointFixture'

export type DrawerStep = 'basic' | 'coordinate' | 'motion' | 'binding' | 'validation'

const STEPS: readonly DrawerStep[] = [
  'basic',
  'coordinate',
  'motion',
  'binding',
  'validation'
]

const STEP_LABELS: Record<DrawerStep, string> = {
  basic: '基本信息',
  coordinate: '坐标与关节',
  motion: '运动限制',
  binding: '库位绑定',
  validation: '验证发布'
}

interface PointEditorDrawerProps {
  point: RobotPoint
  binding: PointBinding | null
  points: readonly RobotPoint[]
  pointSetVersion: PointSetVersion
  step: DrawerStep
  dirty: boolean
  notice: string
  onStepChange: (step: DrawerStep) => void
  onDirty: () => void
  onClose: () => void
  onSave: (patch: Partial<RobotPoint>, binding: PointBinding | null) => void
}

interface PointFormState {
  name: string
  id: string
  role: PointRole
  kind: PointKind
  position: [string, string, string]
  rotation: [string, string, string]
  joints: [string, string, string, string, string, string]
  maxSpeed: string
  acceleration: string
  positionTolerance: string
  rotationTolerance: string
  motionJ: boolean
  motionL: boolean
  bindingId: string
  siteUuid: string
  operation: PointBinding['operation']
  program: string
  approach: string
  interact: string
  retreat: string
  observation: string
}

/**
 * 以右侧抽屉呈现结构化点位编辑流程；原型保存只返回内存补丁。
 */
export function PointEditorDrawer(props: PointEditorDrawerProps): React.JSX.Element {
  // 表单草稿只代表浏览器内候选点位定义，不是控制器或部署权威事实。
  const [form, setForm] = useState<PointFormState>(() => formFromPoint(props.point, props.binding))

  useEffect(() => {
    setForm(formFromPoint(props.point, props.binding))
  }, [props.point.id, props.binding])

  /** 更新一个结构化字段，并把当前编辑会话标记为未保存。 */
  const update = <Key extends keyof PointFormState>(key: Key, value: PointFormState[Key]): void => {
    setForm((current) => ({ ...current, [key]: value }))
    props.onDirty()
  }

  /** 校验点位与库位控制绑定（SiteControlBinding）后提交内存草稿补丁。 */
  const save = (): void => {
    if (errors.length > 0) return
    const motion: ('move_j' | 'move_l')[] = []
    if (form.motionJ) motion.push('move_j')
    if (form.motionL) motion.push('move_l')
    const hasBinding = Boolean(form.siteUuid || form.program || form.approach || form.interact || form.retreat)
    const siteLabel = form.siteUuid.includes('p02') ? 'P02' : 'P01'
    const nextBinding: PointBinding | null = hasBinding ? {
      id: form.bindingId || `binding-${siteLabel.toLowerCase()}-${form.operation}-draft`,
      siteUuid: form.siteUuid,
      siteLabel,
      owner: 'S4 移液工作站',
      operation: form.operation,
      materialTypes: props.binding?.materialTypes ?? ['SBS PCR Plate'],
      approach: form.approach,
      interact: form.interact,
      retreat: form.retreat,
      program: form.program.trim(),
      tool: props.binding?.tool ?? 'plate-gripper-tcp@v2',
      payload: props.binding?.payload ?? 'pcr-plate-loaded@v1',
      observation: form.observation.trim(),
      status: 'draft'
    } : null
    props.onSave({
      name: form.name.trim(),
      role: form.role,
      kind: form.kind,
      position: form.position.map(numberFrom) as unknown as RobotPoint['position'],
      rotation: form.rotation.map(numberFrom) as unknown as RobotPoint['rotation'],
      joints: form.joints.some((value) => value.trim())
        ? form.joints.map(numberFrom) as unknown as NonNullable<RobotPoint['joints']>
        : undefined,
      motion: motion.length ? motion : props.point.motion,
      maxSpeed: numberFrom(form.maxSpeed),
      acceleration: numberFrom(form.acceleration),
      positionTolerance: numberFrom(form.positionTolerance),
      rotationTolerance: numberFrom(form.rotationTolerance),
      state: 'draft',
      validatedAt: '尚未验证'
    }, nextBinding)
  }

  const errors = validateForm(form, props.points)

  return (
    <aside className="point-drawer" aria-label="编辑点位">
      <header className="drawer-head">
        <div><span>编辑点位</span><h2>{props.point.name}</h2><code>{props.point.id}</code></div>
        <button type="button" aria-label="关闭编辑侧栏" onClick={props.onClose}>×</button>
      </header>
      <nav className="drawer-steps" aria-label="点位配置步骤">
        {STEPS.map((item, index) => (
          <button key={item} type="button" aria-current={props.step === item ? 'step' : undefined} className={props.step === item ? 'active' : ''} onClick={() => props.onStepChange(item)}>
            <span>{index + 1}</span><small>{STEP_LABELS[item]}</small>
          </button>
        ))}
      </nav>
      <div className="drawer-scroll">
        {props.step === 'basic' ? <BasicStep form={form} update={update} pointSetVersion={props.pointSetVersion} /> : null}
        {props.step === 'coordinate' ? <CoordinateStep form={form} update={update} point={props.point} /> : null}
        {props.step === 'motion' ? <MotionStep form={form} update={update} /> : null}
        {props.step === 'binding' ? <BindingStep form={form} update={update} points={props.points} /> : null}
        {props.step === 'validation' ? <ValidationStep point={props.point} pointSetVersion={props.pointSetVersion} /> : null}
      </div>
      {errors.length > 0 && props.dirty ? <div className="drawer-errors" role="alert"><strong>请先修正 {errors.length} 项配置</strong><span>{errors[0]}</span></div> : null}
      {props.notice ? <div className="drawer-notice" role="status">{props.notice}</div> : null}
      <footer className="drawer-footer">
        <button type="button" onClick={props.onClose}>取消</button>
        <button type="button" className="primary" disabled={!props.dirty || errors.length > 0} title={errors[0]} onClick={save}>{props.pointSetVersion === 'ptlc-main@v12' ? '保存为新版本' : '保存草稿'}</button>
      </footer>
    </aside>
  )
}

type UpdateForm = <Key extends keyof PointFormState>(key: Key, value: PointFormState[Key]) => void

/** 渲染稳定点位身份、用途与冻结标定上下文。 */
function BasicStep({ form, update, pointSetVersion }: { form: PointFormState; update: UpdateForm; pointSetVersion: PointSetVersion }): React.JSX.Element {
  return (
    <section className="drawer-section">
      <SectionIntro title="基本信息" description="点位身份在同一点位集版本中唯一；发布后通过新版本修改。" />
      <Field label="点位名称" required><input value={form.name} onChange={(event) => update('name', event.target.value)} /></Field>
      <Field label="稳定点位 ID" required hint="发布后不可修改"><input value={form.id} disabled /></Field>
      <div className="field-pair">
        <Field label="点位用途" required><select value={form.role} onChange={(event) => update('role', event.target.value as PointRole)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="点位类型" required><select value={form.kind} onChange={(event) => update('kind', event.target.value as PointKind)}><option value="taught">直接示教</option><option value="offset">受限偏移</option><option value="affine_grid">阵列派生</option></select></Field>
      </div>
      <div className="context-lock"><strong>冻结上下文</strong><dl><div><dt>机械臂</dt><dd>主机械臂 · FR5</dd></div><div><dt>编辑版本</dt><dd><code>{pointSetVersion}</code></dd></div><div><dt>标定</dt><dd><code>cell_base@cal-2026-08-08</code></dd></div></dl></div>
    </section>
  )
}

/** 渲染毫米位置、XYZ degree 姿态与可选关节构型字段。 */
function CoordinateStep({ form, update, point }: { form: PointFormState; update: UpdateForm; point: RobotPoint }): React.JSX.Element {
  return (
    <section className="drawer-section">
      <SectionIntro title="坐标与关节" description="页面使用 mm 与固定 XYZ degree；厂家单位只在 Adapter 边界转换。" />
      <div className="capture-bar"><div><strong>当前控制器位姿</strong><span>只读连接尚未接入原型</span></div><button type="button" disabled>读取当前位置</button></div>
      <fieldset><legend>笛卡尔位置 <small>mm</small></legend><div className="coordinate-inputs">{(['X', 'Y', 'Z'] as const).map((axis, index) => <Field key={axis} label={axis}><input type="number" step="0.1" value={form.position[index]} onChange={(event) => update('position', replaceAt(form.position, index, event.target.value))} /></Field>)}</div></fieldset>
      <fieldset><legend>XYZ 姿态 <small>degree</small></legend><div className="coordinate-inputs">{(['Rx', 'Ry', 'Rz'] as const).map((axis, index) => <Field key={axis} label={axis}><input type="number" step="0.1" value={form.rotation[index]} onChange={(event) => update('rotation', replaceAt(form.rotation, index, event.target.value))} /></Field>)}</div></fieldset>
      <fieldset><legend>关节构型 <small>degree · 可选</small></legend><div className="joint-inputs">{form.joints.map((value, index) => <Field key={index} label={`J${index + 1}`}><input type="number" step="0.1" value={value} onChange={(event) => update('joints', replaceAt(form.joints, index, event.target.value))} /></Field>)}</div></fieldset>
      <div className="inline-info"><strong>坐标来源</strong><span>{point.source}</span></div>
    </section>
  )
}

/** 渲染允许运动与运行请求不可突破的速度、加速度和容差上限。 */
function MotionStep({ form, update }: { form: PointFormState; update: UpdateForm }): React.JSX.Element {
  return (
    <section className="drawer-section">
      <SectionIntro title="运动限制" description="这些值是发布上限；运行请求只能选择允许的运动并进一步降低速度。" />
      <fieldset><legend>允许运动</legend><div className="check-list"><label><input type="checkbox" checked={form.motionJ} onChange={(event) => update('motionJ', event.target.checked)} /><span><strong>move_j</strong><small>关节运动；需要稳定关节构型</small></span></label><label><input type="checkbox" checked={form.motionL} onChange={(event) => update('motionL', event.target.checked)} /><span><strong>move_l</strong><small>笛卡尔直线运动；用于已验证接近段</small></span></label></div></fieldset>
      <div className="field-pair"><Field label="最大速度" unit="%"><input type="number" min="1" max="100" value={form.maxSpeed} onChange={(event) => update('maxSpeed', event.target.value)} /></Field><Field label="最大加速度" unit="%"><input type="number" min="1" max="100" value={form.acceleration} onChange={(event) => update('acceleration', event.target.value)} /></Field></div>
      <div className="field-pair"><Field label="位置容差" unit="mm"><input type="number" min="0" step="0.1" value={form.positionTolerance} onChange={(event) => update('positionTolerance', event.target.value)} /></Field><Field label="姿态容差" unit="°"><input type="number" min="0" step="0.1" value={form.rotationTolerance} onChange={(event) => update('rotationTolerance', event.target.value)} /></Field></div>
      <div className="warning-note"><strong>安全边界</strong><span>页面参数不是安全速度或碰撞保护；现场安全系统与机械臂安全配置继续承担最终安全功能。</span></div>
    </section>
  )
}

/** 渲染部署所有的库位控制绑定（SiteControlBinding）和三段点位序列。 */
function BindingStep({ form, update, points }: { form: PointFormState; update: UpdateForm; points: readonly RobotPoint[] }): React.JSX.Element {
  const pointOptions = points.map((point) => point.id)
  return (
    <section className="drawer-section">
      <SectionIntro title="库位绑定" description="绑定部署参数，不把机械臂坐标写入库位（Site），也不推断库位占用。" />
      <Field label="稳定库位身份" required><select value={form.siteUuid} onChange={(event) => update('siteUuid', event.target.value)}><option value="">选择库位…</option><option value="site-s04-p01-5db3">S4 移液工作站 / P01</option><option value="site-s04-p02-818a">S4 移液工作站 / P02</option></select></Field>
      <div className="field-pair"><Field label="操作" required><select value={form.operation} onChange={(event) => update('operation', event.target.value as PointBinding['operation'])}><option value="pick">pick · 取</option><option value="place">place · 放</option></select></Field><Field label="程序版本" required><input value={form.program} onChange={(event) => update('program', event.target.value)} /></Field></div>
      <fieldset><legend>交互点位序列</legend><div className="sequence-form">{([['接近点', 'approach'], ['交互点', 'interact'], ['退出点', 'retreat']] as const).map(([label, key], index) => {
        const currentMissing = Boolean(form[key] && !pointOptions.includes(form[key]))
        return <div key={label}><span>{index + 1}</span><label><small>{label}</small><select value={form[key]} aria-invalid={currentMissing} onChange={(event) => update(key, event.target.value)}><option value="">选择点位…</option>{currentMissing ? <option value={form[key]} disabled>{form[key]} · 当前版本不存在</option> : null}{pointOptions.map((pointId) => <option key={pointId} value={pointId}>{pointId}</option>)}</select></label></div>
      })}</div></fieldset>
      <Field label="观测与前置条件"><textarea rows={3} value={form.observation} onChange={(event) => update('observation', event.target.value)} /></Field>
      <div className="inline-info"><strong>独立权威</strong><span>物料身份、当前位置和库位占用不会随此表单保存。</span></div>
    </section>
  )
}

/** 渲染验证证据与失败关闭的发布预览。 */
function ValidationStep({ point, pointSetVersion }: { point: RobotPoint; pointSetVersion: PointSetVersion }): React.JSX.Element {
  const items = [['Schema、单位与坐标系', '已通过'], ['可达性与关节限位', '已通过'], ['碰撞与接近 / 退出路径', point.state === 'draft' ? '待执行' : '已通过'], ['真机低速空载验证', ['approved', 'robot_validated'].includes(point.state) ? '已通过' : '待执行'], ['第二人复核与批准', point.state === 'approved' ? '已通过' : '待执行']] as const
  return (
    <section className="drawer-section">
      <SectionIntro title="验证与发布" description="任何位姿、TCP、负载或标定变化都会生成新版本并使既有验证失效。" />
      <div className="validation-list">{items.map(([label, state]) => <div key={label} className={state === '已通过' ? 'passed' : 'pending'}><span>{state === '已通过' ? '✓' : '•'}</span><strong>{label}</strong><small>{state}</small></div>)}</div>
      <div className="publish-summary"><strong>{pointSetVersion === 'ptlc-main@v12' ? '新版本预览' : '草稿更新预览'}</strong><dl><div><dt>当前版本</dt><dd><code>{pointSetVersion}</code></dd></div><div><dt>保存后</dt><dd><code>ptlc-main@v13-draft</code></dd></div><div><dt>验证状态</dt><dd>草稿 · 禁止生产使用</dd></div><div><dt>版本语义</dt><dd>{pointSetVersion === 'ptlc-main@v12' ? 'v12 基线保持不可变' : '更新当前内存草稿'}</dd></div></dl></div>
      <button type="button" className="validation-action" disabled>提交真机验证</button>
      <small className="action-reason">需要生产级点位服务、审批记录与有效调试会话；当前原型未接入。</small>
    </section>
  )
}

/** 渲染抽屉步骤的标题与领域边界说明。 */
function SectionIntro({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <header className="drawer-section-head"><h3>{title}</h3><p>{description}</p></header>
}

/** 渲染具备必填、单位和提示语义的结构化表单字段。 */
function Field({ label, required = false, unit, hint, children }: { label: string; required?: boolean; unit?: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return <label className="form-field"><span>{label}{required ? <em>必填</em> : null}{unit ? <small>{unit}</small> : null}</span>{children}{hint ? <small>{hint}</small> : null}</label>
}

/** 从当前点位和可选绑定建立可编辑字符串表单，不改变输入事实。 */
function formFromPoint(point: RobotPoint, binding: PointBinding | null): PointFormState {
  return {
    name: point.name,
    id: point.id,
    role: point.role,
    kind: point.kind,
    position: point.position.map(String) as PointFormState['position'],
    rotation: point.rotation.map(String) as PointFormState['rotation'],
    joints: (point.joints ?? ['', '', '', '', '', '']).map(String) as PointFormState['joints'],
    maxSpeed: String(point.maxSpeed),
    acceleration: String(point.acceleration),
    positionTolerance: String(point.positionTolerance),
    rotationTolerance: String(point.rotationTolerance),
    motionJ: point.motion.includes('move_j'),
    motionL: point.motion.includes('move_l'),
    bindingId: binding?.id ?? '',
    siteUuid: binding?.siteUuid ?? '',
    operation: binding?.operation ?? 'pick',
    program: binding?.program ?? '',
    approach: binding?.approach ?? '',
    interact: binding?.interact ?? point.id,
    retreat: binding?.retreat ?? '',
    observation: binding?.observation ?? ''
  }
}

/** 校验数值边界、允许运动和绑定引用完整性。 */
function validateForm(form: PointFormState, points: readonly RobotPoint[]): string[] {
  const errors: string[] = []
  const requiredNumbers = [
    ...form.position.map((value, index) => [`位置 ${['X', 'Y', 'Z'][index]}`, value] as const),
    ...form.rotation.map((value, index) => [`姿态 ${['Rx', 'Ry', 'Rz'][index]}`, value] as const)
  ]
  if (!form.name.trim()) errors.push('点位名称不能为空。')
  requiredNumbers.forEach(([label, value]) => {
    if (!value.trim() || !Number.isFinite(Number(value))) errors.push(`${label} 必须是有效数字。`)
  })
  if (!form.motionJ && !form.motionL) errors.push('至少允许一种运动方式。')
  validateRange(errors, '最大速度', form.maxSpeed, 0, 100)
  validateRange(errors, '最大加速度', form.acceleration, 0, 100)
  validateRange(errors, '位置容差', form.positionTolerance, 0, Number.POSITIVE_INFINITY)
  validateRange(errors, '姿态容差', form.rotationTolerance, 0, Number.POSITIVE_INFINITY)
  if (form.motionJ || form.joints.some((value) => value.trim())) {
    form.joints.forEach((value, index) => {
      if (!value.trim() || !Number.isFinite(Number(value))) errors.push(`move_j 需要有效的 J${index + 1} 关节角。`)
    })
  }
  const hasBinding = Boolean(form.siteUuid || form.program || form.approach || form.retreat)
  if (hasBinding) {
    if (!form.siteUuid) errors.push('库位绑定需要稳定库位身份。')
    if (!form.program.trim()) errors.push('库位绑定需要程序版本。')
    if (!form.approach || !form.interact || !form.retreat) errors.push('库位绑定需要完整的接近、交互、退出点位序列。')
    if (new Set([form.approach, form.interact, form.retreat]).size !== 3) errors.push('接近、交互、退出点位不能重复。')
    const pointIds = new Set(points.map((point) => point.id))
    const sequencePoints = [form.approach, form.interact, form.retreat]
    sequencePoints.forEach((pointId) => {
      if (pointId && !pointIds.has(pointId)) errors.push(`绑定引用的点位 ${pointId} 不在当前点位集中。`)
    })
  }
  return errors
}

/** 向错误集合追加一个不满足开闭区间约束的数值字段错误。 */
function validateRange(errors: string[], label: string, value: string, lowerExclusive: number, upperInclusive: number): void {
  const parsed = Number(value)
  if (!value.trim() || !Number.isFinite(parsed) || parsed <= lowerExclusive || parsed > upperInclusive) {
    errors.push(`${label} 必须大于 ${lowerExclusive}${Number.isFinite(upperInclusive) ? ` 且不超过 ${upperInclusive}` : ''}。`)
  }
}

/** 将已校验的表单数字转为有限数值，异常值安全回退为零。 */
function numberFrom(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 不改变原元组地替换一个表单坐标或关节字符串。 */
function replaceAt<Tuple extends readonly string[]>(tuple: Tuple, index: number, value: string): Tuple {
  const next = [...tuple]
  next[index] = value
  return next as unknown as Tuple
}
