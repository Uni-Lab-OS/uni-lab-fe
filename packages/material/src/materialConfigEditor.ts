export type MaterialConfigFieldKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'number-list'

export interface MaterialConfigField {
  key: string
  label: string
  description?: string
  kind: MaterialConfigFieldKind
  value: unknown
  required: boolean
  integer: boolean
  present: boolean
}

export interface MaterialAdvancedConfigItem {
  key: string
  label: string
  summary: string
}

export interface MaterialConfigProjection {
  fields: readonly MaterialConfigField[]
  advancedItems: readonly MaterialAdvancedConfigItem[]
}

export interface ParsedMaterialConfigField<T> {
  valid: boolean
  value?: T
  message?: string
}

const CONFIG_LABELS: Readonly<Record<string, string>> = {
  batch: '批次',
  capacity: '容量',
  columns: '列数',
  dimensionsMm: '外形尺寸（毫米）',
  footprintMm: '占地尺寸（毫米）',
  kind: '类型',
  rendering: '渲染配置',
  rows: '行数',
  volumeUl: '体积（微升）'
}

/**
 * 判断未知值是否为可枚举的普通对象。
 * @param value 待判断的配置或 Schema 片段。
 * @returns 非空且非数组对象返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/**
 * 读取 JSON Schema 的顶层 properties；缺失或格式异常时安全回退为空对象。
 * @param schema 物料模板声明的配置 Schema。
 * @returns 可用于表单投影的属性定义表。
 */
function schemaProperties(
  schema: Record<string, unknown> | undefined
): Record<string, unknown> {
  return isRecord(schema?.properties) ? schema.properties : {}
}

/**
 * 读取 JSON Schema 顶层必填字段，不把异常值当作必填声明。
 * @param schema 物料模板声明的配置 Schema。
 * @returns 顶层必填字段名集合。
 */
function schemaRequired(
  schema: Record<string, unknown> | undefined
): ReadonlySet<string> {
  return new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter(
          (item): item is string => typeof item === 'string'
        )
      : []
  )
}

/**
 * 生成字段的中文展示名；模板 title 优先，未知键保留原名以避免误译领域含义。
 * @param key 配置对象中的稳定字段名。
 * @param property 对应的 JSON Schema 属性声明。
 * @returns 供非代码表单展示的字段名称。
 */
function fieldLabel(
  key: string,
  property: Record<string, unknown>
): string {
  return typeof property.title === 'string' && property.title.trim()
    ? property.title.trim()
    : CONFIG_LABELS[key] ?? key
}

/**
 * 判断一个值是否能由简单数值列表控件安全编辑。
 * @param value 当前配置值。
 * @param property 对应的 JSON Schema 属性声明。
 * @returns 当前值或 Schema 明确为数值数组时返回 true。
 */
function isNumberList(
  value: unknown,
  property: Record<string, unknown>
): boolean {
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    return true
  }
  if (property.type !== 'array') return false
  const items = isRecord(property.items) ? property.items : {}
  return items.type === 'number' || items.type === 'integer'
}

/**
 * 依据 Schema 与当前值推导一个可安全表单化的字段类型。
 * @param value 当前物料实例中的字段值。
 * @param property 对应的 JSON Schema 属性声明。
 * @returns 简单控件类型；复杂对象和混合数组返回 null 并进入高级配置。
 */
function fieldKind(
  value: unknown,
  property: Record<string, unknown>
): MaterialConfigFieldKind | null {
  if (isNumberList(value, property)) return 'number-list'
  const declaredType = property.type
  if (declaredType === 'boolean' || typeof value === 'boolean') {
    return 'boolean'
  }
  if (
    declaredType === 'number' ||
    declaredType === 'integer' ||
    typeof value === 'number'
  ) {
    return 'number'
  }
  if (declaredType === 'string' || typeof value === 'string') {
    return 'text'
  }
  return null
}

/**
 * 为高级配置项生成只读摘要，避免在常用模式中暴露原始结构。
 * @param value 当前配置值。
 * @returns 对象、数组或空值的简短中文说明。
 */
function advancedValueSummary(value: unknown): string {
  if (Array.isArray(value)) return `数组 · ${value.length} 项`
  if (isRecord(value)) return `对象 · ${Object.keys(value).length} 项`
  if (value === null) return '空值'
  if (value === undefined) return '由模板定义，尚未设置'
  return '复杂配置'
}

/**
 * 将物料实例配置投影为常用字段与高级字段，复杂结构默认只读。
 * @param config 当前物料实例配置，仍是保存时的唯一事实源。
 * @param schema 可选的模板 JSON Schema，用于补充名称、类型和必填约束。
 * @returns 不产生第二份业务实体的表单投影。
 */
export function projectMaterialConfig(
  config: Record<string, unknown>,
  schema?: Record<string, unknown>
): MaterialConfigProjection {
  const properties = schemaProperties(schema)
  const required = schemaRequired(schema)
  const keys = [
    ...Object.keys(properties),
    ...Object.keys(config).filter((key) => !(key in properties))
  ]
  const fields: MaterialConfigField[] = []
  const advancedItems: MaterialAdvancedConfigItem[] = []

  for (const key of keys) {
    const property = isRecord(properties[key]) ? properties[key] : {}
    const present = Object.prototype.hasOwnProperty.call(config, key)
    const value = present ? config[key] : property.default
    const kind = fieldKind(value, property)
    const label = fieldLabel(key, property)
    if (!kind) {
      advancedItems.push({
        key,
        label,
        summary: advancedValueSummary(value)
      })
      continue
    }
    fields.push({
      key,
      label,
      description:
        typeof property.description === 'string'
          ? property.description
          : undefined,
      kind,
      value,
      required: required.has(key),
      integer: property.type === 'integer',
      present
    })
  }

  return { fields, advancedItems }
}

/**
 * 不可变地更新或移除一个顶层配置字段，供表单与高级 JSON 共用同一份草稿。
 * @param config 当前有效配置对象。
 * @param key 待更新的顶层稳定字段名。
 * @param value 新值；undefined 表示移除可选字段。
 * @returns 新的配置对象，不修改输入对象。
 */
export function setMaterialConfigValue(
  config: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  const next = { ...config }
  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = value
  }
  return next
}

/**
 * 解析数字输入并保留整数约束，不接受空值、NaN 或无穷值。
 * @param text 用户输入的数字文本。
 * @param integer 字段是否只允许整数。
 * @returns 可写回配置的数字或面向用户的校验原因。
 */
export function parseMaterialNumber(
  text: string,
  integer: boolean
): ParsedMaterialConfigField<number> {
  if (!text.trim()) return { valid: false, message: '请输入数字' }
  const value = Number(text)
  if (!Number.isFinite(value)) {
    return { valid: false, message: '请输入有效数字' }
  }
  if (integer && !Number.isInteger(value)) {
    return { valid: false, message: '请输入整数' }
  }
  return { valid: true, value }
}

/**
 * 解析逗号或空格分隔的数值列表，兼容中文逗号且拒绝无效数字。
 * @param text 用户输入的数值列表文本。
 * @param integer 列表元素是否只允许整数。
 * @returns 可写回配置的数值数组或面向用户的校验原因。
 */
export function parseMaterialNumberList(
  text: string,
  integer: boolean
): ParsedMaterialConfigField<readonly number[]> {
  const trimmed = text.trim()
  if (!trimmed) return { valid: true, value: [] }
  const parts = trimmed.split(/[\s,，]+/).filter(Boolean)
  const values: number[] = []
  for (const part of parts) {
    const parsed = parseMaterialNumber(part, integer)
    if (!parsed.valid || parsed.value === undefined) {
      return {
        valid: false,
        message: integer ? '请使用逗号分隔整数' : '请使用逗号分隔数字'
      }
    }
    values.push(parsed.value)
  }
  return { valid: true, value: values }
}

/**
 * 将常用配置字段格式化为浏览器输入值。
 * @param field 待显示的表单字段投影。
 * @returns 文本、数字或数值列表的可编辑字符串。
 */
export function formatMaterialConfigField(
  field: MaterialConfigField
): string {
  if (field.kind === 'number-list') {
    return Array.isArray(field.value) ? field.value.join(', ') : ''
  }
  if (field.value === undefined || field.value === null) return ''
  return String(field.value)
}
