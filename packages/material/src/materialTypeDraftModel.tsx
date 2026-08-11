export type MaterialTypeDraftStep = 'basic' | 'fields' | 'layout' | 'compatibility'
export type MaterialTypeDraftFieldType = 'text' | 'date' | 'number' | 'boolean' | 'select'
export type MaterialContainerLayout = 'none' | 'grid'
export type MaterialContainerNaming = 'row-column' | 'numeric'
export type CompatibleContent = 'reagent' | 'sample' | 'consumable' | 'container'
export type CompatibleSite = 'deck-slot' | 'storage-rack' | 'cold-storage' | 'custom'

export interface MaterialTypeBasicDraft {
  name: string
  category: 'consumable' | 'container' | 'sample' | 'other'
  description: string
  manufacturerModel: string
  unit: 'piece' | 'mL' | 'g'
}

export interface MaterialTypeDraftField {
  id: number
  name: string
  key: string
  type: MaterialTypeDraftFieldType
  required: boolean
  defaultValue: string
  description: string
}

export const CONTENT_OPTIONS: ReadonlyArray<{
  id: CompatibleContent
  label: string
  detail: string
}> = [
  { id: 'reagent', label: '试剂', detail: '液体、粉末等试剂物料实例' },
  { id: 'sample', label: '样品', detail: '实验样品及其派生物料实例' },
  { id: 'consumable', label: '耗材实例', detail: '枪头、管、封膜等耗材实例' },
  { id: 'container', label: '子容器', detail: '管、板、盒等容器类物料实例' }
]

export const SITE_OPTIONS: ReadonlyArray<{
  id: CompatibleSite
  label: string
  detail: string
}> = [
  { id: 'deck-slot', label: '设备台面位', detail: '设备工作台上的稳定库位（Site）' },
  { id: 'storage-rack', label: '存储架库位', detail: '常温货架或料架中的稳定库位' },
  { id: 'cold-storage', label: '冷藏库位', detail: '冰箱、冷柜等温控存储库位' },
  { id: 'custom', label: '自定义库位类型', detail: '由实验室扩展的稳定库位类型' }
]

/**
 * 渲染向导步骤标题，统一步骤说明、状态徽标与可选操作。
 *
 * @param props 步骤标题的可见内容和辅助操作。
 * @returns 可被编程聚焦的步骤标题区域。
 */
export function MaterialTypeDraftStepHeader({
  titleRef,
  id,
  eyebrow,
  title,
  detail,
  badge,
  action
}: {
  titleRef: React.Ref<HTMLHeadingElement>
  id: string
  eyebrow: string
  title: string
  detail: string
  badge?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="material-type-draft__step-header">
      <div>
        <span>{eyebrow}</span>
        <h4 ref={titleRef} id={id} tabIndex={-1}>{title}</h4>
        <p>{detail}</p>
      </div>
      {action ?? (badge ? <strong>{badge}</strong> : null)}
    </header>
  )
}

/**
 * 根据字段类型渲染只读的实例配置控件预览。
 *
 * @param field 实例字段草稿。
 * @returns 不参与提交的只读预览控件。
 */
export function MaterialTypeDraftPreviewControl({
  field
}: {
  field: MaterialTypeDraftField
}): React.JSX.Element {
  if (field.type === 'boolean') {
    return <select aria-label={`${field.name}预览`} disabled><option>请选择</option></select>
  }
  if (field.type === 'select') {
    return <select aria-label={`${field.name}预览`} disabled><option>选择一个选项</option></select>
  }
  return (
    <input
      aria-label={`${field.name}预览`}
      type={field.type}
      placeholder={field.defaultValue || '由实例填写'}
      disabled
    />
  )
}

/**
 * 渲染容器内部位置的小型几何预览。
 *
 * @param rows 网格行数。
 * @param columns 网格列数。
 * @param naming 位置命名规则。
 * @returns 最多展示 96 个位置的非权威结构预览。
 */
export function MaterialTypeDraftGridPreview({
  rows,
  columns,
  naming
}: {
  rows: number
  columns: number
  naming: MaterialContainerNaming
}): React.JSX.Element {
  const visibleRows = Math.min(rows, Math.max(1, Math.floor(96 / columns)))
  const visibleCount = visibleRows * columns
  return (
    <figure className="material-type-draft__grid-preview">
      <figcaption>
        <div><strong>结构预览</strong><small>{rows} 行 × {columns} 列</small></div>
        <span>{rows * columns} 个内部位置</span>
      </figcaption>
      <div
        className="material-type-draft__grid-cells"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(24px, 42px))` }}
      >
        {Array.from({ length: visibleCount }, (_, index) => {
          const row = Math.floor(index / columns)
          const column = index % columns
          return (
            <span key={index}>{containerPositionLabel(row, column, columns, naming)}</span>
          )
        })}
      </div>
      {visibleCount < rows * columns ? (
        <small>预览显示前 {visibleCount} 个位置，完整结构共 {rows * columns} 个。</small>
      ) : (
        <small>命名与位置数量会作为资源模板结构保存。</small>
      )}
    </figure>
  )
}

/**
 * 校验字段配置键是否可作为稳定的实例配置属性。
 *
 * @param target 当前字段。
 * @param fields 同一草稿中的全部字段。
 * @returns 无问题时返回空字符串，否则返回中文校验提示。
 */
export function materialTypeDraftFieldKeyIssue(
  target: MaterialTypeDraftField,
  fields: ReadonlyArray<MaterialTypeDraftField>
): string {
  if (!target.key.trim()) return '请输入配置键'
  if (!/^[a-z][a-zA-Z0-9]*$/.test(target.key)) return '使用小写字母开头的驼峰格式'
  if (fields.some((field) => field.id !== target.id && field.key === target.key)) {
    return '配置键不能重复'
  }
  return ''
}

/**
 * 将用户输入收敛为限定范围内的正整数。
 *
 * @param value 数值输入框的字符串值。
 * @param maximum 页面预览支持的最大值。
 * @returns 1 到 maximum 之间的整数。
 */
export function boundedMaterialTypeDraftInteger(value: string, maximum: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, parsed)) : 1
}

/**
 * 生成规则网格中一个内部位置的可读名称。
 *
 * @param row 从零开始的行号。
 * @param column 从零开始的列号。
 * @param columns 总列数，用于连续编号。
 * @param naming 位置命名规则。
 * @returns A1 或 01 形式的位置名称。
 */
export function containerPositionLabel(
  row: number,
  column: number,
  columns: number,
  naming: MaterialContainerNaming
): string {
  if (naming === 'numeric') {
    const index = row * columns + column + 1
    return String(index).padStart(2, '0')
  }
  return `${String.fromCharCode(65 + row)}${column + 1}`
}

/**
 * 将内部位置类型编码转换为界面用语。
 *
 * @param kind 内部位置类型编码。
 * @returns 对应的中文类型名称。
 */
export function containerKindLabel(kind: string): string {
  if (kind === 'tip-spot') return '枪头位'
  if (kind === 'container') return '子容器位'
  return '孔位'
}

/**
 * 将已选兼容规则呈现为摘要标签。
 *
 * @param options 规则选项及其可见名称。
 * @param selected 当前选中状态。
 * @returns 一个或多个摘要标签；无选择时显示明确空状态。
 */
export function selectedMaterialTypeDraftLabels<T extends string>(
  options: ReadonlyArray<{ id: T; label: string }>,
  selected: Record<T, boolean>
): React.JSX.Element {
  const labels = options.filter((option) => selected[option.id])
  if (labels.length === 0) return <span className="is-empty">未设置兼容类型</span>
  return <>{labels.map((option) => <span key={option.id}>{option.label}</span>)}</>
}
