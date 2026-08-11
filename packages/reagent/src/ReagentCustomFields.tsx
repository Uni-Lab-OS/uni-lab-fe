import type { ReagentCustomField } from './reagentWorkspace'

const MAX_CUSTOM_FIELD_COUNT = 20

export interface ReagentCustomFieldEditorProps {
  fields: readonly ReagentCustomField[]
  onChange: (fields: readonly ReagentCustomField[]) => void
}

/**
 * 生成当前试剂内未使用的稳定自定义字段键。
 * @param fields 当前试剂已有的自定义字段集合。
 * @returns 只用于写端口身份的稳定键；用户修改显示名称时该键保持不变。
 */
export function nextReagentCustomFieldKey(
  fields: readonly ReagentCustomField[]
): string {
  const existingKeys = new Set(fields.map((field) => field.key))
  let ordinal = 1
  while (existingKeys.has(`custom_field_${ordinal}`)) ordinal += 1
  return `custom_field_${ordinal}`
}

/**
 * 校验试剂自定义字段是否具备可提交的名称和值。
 * @param fields 待提交到试剂信息写端口的自定义字段集合。
 * @returns 第一个可行动的中文错误；合法时返回空值。
 */
export function validateReagentCustomFields(
  fields: readonly ReagentCustomField[]
): string | null {
  if (fields.length > MAX_CUSTOM_FIELD_COUNT) {
    return `每个试剂最多配置 ${MAX_CUSTOM_FIELD_COUNT} 个自定义字段。`
  }
  const labels = new Set<string>()
  for (const field of fields) {
    const label = field.label.trim()
    if (!label) return '请填写每个自定义字段的名称，或删除空字段。'
    if (!field.value.trim()) return `请填写“${label}”的字段值。`
    const normalizedLabel = label.toLocaleLowerCase()
    if (labels.has(normalizedLabel)) return `自定义字段名称“${label}”不能重复。`
    labels.add(normalizedLabel)
  }
  return null
}

/**
 * 清理自定义字段首尾空白，同时保留每个字段的稳定键。
 * @param fields 已通过校验的试剂自定义字段集合。
 * @returns 可直接提交给试剂信息写端口的字段集合。
 */
export function normalizeReagentCustomFields(
  fields: readonly ReagentCustomField[]
): readonly ReagentCustomField[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label.trim(),
    value: field.value.trim(),
    ...(field.unit?.trim() ? { unit: field.unit.trim() } : {})
  }))
}

/**
 * 渲染无需编写 JSON 的试剂自定义字段编辑器。
 * @param props 当前字段集合及结构化变更回调。
 * @returns 支持新增、修改和删除名称—值—单位字段的内联编辑区。
 */
export function ReagentCustomFieldEditor({
  fields,
  onChange
}: ReagentCustomFieldEditorProps): React.JSX.Element {
  const validationError = validateReagentCustomFields(fields)

  /** 新增一个带稳定键的空字段草稿。 */
  const addField = (): void => {
    if (fields.length >= MAX_CUSTOM_FIELD_COUNT) return
    onChange([...fields, {
      key: nextReagentCustomFieldKey(fields),
      label: '',
      value: ''
    }])
  }

  /**
   * 更新一个自定义字段的用户可见内容。
   * @param key 自定义字段的稳定键。
   * @param property 待更新的名称、值或单位属性。
   * @param value 用户输入的新文本。
   */
  const updateField = (
    key: string,
    property: 'label' | 'value' | 'unit',
    value: string
  ): void => {
    onChange(fields.map((field) => (
      field.key === key ? { ...field, [property]: value } : field
    )))
  }

  /**
   * 从当前试剂信息草稿移除一个自定义字段。
   * @param key 待删除字段的稳定键。
   */
  const removeField = (key: string): void => {
    onChange(fields.filter((field) => field.key !== key))
  }

  return (
    <section className="reagent-custom-fields" aria-label="自定义字段">
      <header>
        <div>
          <strong>自定义字段</strong>
          <small>补充实验室专属信息；稳定键由系统自动维护。</small>
        </div>
        <button
          type="button"
          disabled={fields.length >= MAX_CUSTOM_FIELD_COUNT}
          onClick={addField}
        >
          ＋ 新增字段
        </button>
      </header>
      {fields.length ? (
        <div className="reagent-custom-fields__rows">
          {fields.map((field, index) => (
            <div className="reagent-custom-fields__row" key={field.key}>
              <label>
                <span>字段名称</span>
                <input
                  aria-label={`自定义字段 ${index + 1} 名称`}
                  maxLength={40}
                  value={field.label}
                  placeholder="例如：纯度"
                  onChange={(event) => updateField(
                    field.key,
                    'label',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>字段值</span>
                <input
                  aria-label={`自定义字段 ${index + 1} 值`}
                  maxLength={200}
                  value={field.value}
                  placeholder="例如：99.5"
                  onChange={(event) => updateField(
                    field.key,
                    'value',
                    event.target.value
                  )}
                />
              </label>
              <label>
                <span>单位（可选）</span>
                <input
                  aria-label={`自定义字段 ${index + 1} 单位`}
                  maxLength={20}
                  value={field.unit ?? ''}
                  placeholder="例如：%"
                  onChange={(event) => updateField(
                    field.key,
                    'unit',
                    event.target.value
                  )}
                />
              </label>
              <button
                type="button"
                className="reagent-custom-fields__remove"
                aria-label={`删除自定义字段 ${field.label || index + 1}`}
                onClick={() => removeField(field.key)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p>暂无自定义字段。需要记录实验室专属信息时再添加。</p>
      )}
      {validationError ? (
        <div className="reagent-custom-fields__error" role="alert">
          {validationError}
        </div>
      ) : null}
    </section>
  )
}

/**
 * 展示当前试剂已经保存的用户自定义字段。
 * @param props 只读自定义字段集合。
 * @returns 与系统基本字段同层级的名称和值列表。
 */
export function ReagentCustomFieldDetails({
  fields
}: {
  fields: readonly ReagentCustomField[]
}): React.JSX.Element {
  return (
    <section className="reagent-custom-fields-summary" aria-label="自定义字段">
      <header>
        <strong>自定义字段</strong>
        <small>{fields.length ? `${fields.length} 项` : '未配置'}</small>
      </header>
      {fields.map((field) => (
        <dl key={field.key}>
          <dt>{field.label}</dt>
          <dd>{field.value}{field.unit ? ` ${field.unit}` : ''}</dd>
        </dl>
      ))}
      {!fields.length ? <p>该试剂尚未添加实验室专属字段。</p> : null}
    </section>
  )
}
