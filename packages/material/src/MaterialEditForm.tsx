import { useMemo, useState, type FormEvent } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import {
  formatMaterialConfigField,
  parseMaterialNumber,
  parseMaterialNumberList,
  projectMaterialConfig,
  setMaterialConfigValue,
  type MaterialConfigField
} from './materialConfigEditor'
import { parseMaterialConfigText } from './materialCrud'
import type {
  MaterialAggregate,
  UpdateMaterialConfigCommand
} from './types'

export interface MaterialEditFormProps {
  aggregate: MaterialAggregate
  configSchema?: Record<string, unknown>
  status: CapabilityStatus
  pending: boolean
  error: string | null
  onCancel: () => void
  onSave: (patch: UpdateMaterialConfigCommand['patch']) => Promise<void>
}

/**
 * 为数字和数值列表字段建立显示草稿，使非法的中间输入不会污染有效 JSON。
 * @param fields 当前常用配置字段投影。
 * @returns 以稳定配置键索引的输入文本。
 */
function initialNumericDrafts(
  fields: readonly MaterialConfigField[]
): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter(
        (field) => field.kind === 'number' || field.kind === 'number-list'
      )
      .map((field) => [field.key, formatMaterialConfigField(field)])
  )
}

/**
 * 计算 Schema 必填字段的即时校验信息，不替服务端伪造最终业务校验。
 * @param fields 当前常用配置字段投影。
 * @returns 以稳定配置键索引的必填错误。
 */
function requiredFieldErrors(
  fields: readonly MaterialConfigField[]
): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter(
        (field) =>
          field.required &&
          (field.value === undefined ||
            (typeof field.value === 'string' && !field.value.trim()))
      )
      .map((field) => [field.key, '此配置为必填项'])
  )
}

/**
 * 编辑物料可变基础信息，并以常用表单优先、高级 JSON 渐进披露的方式维护配置。
 * @param props 当前聚合、模板 Schema、能力状态、提交状态与保存/取消回调。
 * @returns 与物料实例配置共享单一草稿和校验结果的编辑表单。
 */
export function MaterialEditForm({
  aggregate,
  configSchema,
  status,
  pending,
  error,
  onCancel,
  onSave
}: MaterialEditFormProps): React.JSX.Element {
  const [name, setName] = useState(aggregate.material.name)
  const [description, setDescription] = useState(
    aggregate.material.description ?? ''
  )
  const [configText, setConfigText] = useState(
    JSON.stringify(aggregate.material.config, null, 2)
  )
  const [advanced, setAdvanced] = useState(false)
  const parsedConfig = useMemo(
    () => parseMaterialConfigText(configText),
    [configText]
  )
  const projection = useMemo(
    () => projectMaterialConfig(parsedConfig.value ?? {}, configSchema),
    [configSchema, parsedConfig.value]
  )
  const [numericDrafts, setNumericDrafts] = useState(() =>
    initialNumericDrafts(projection.fields)
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const trimmedName = name.trim()
  const requiredErrors = requiredFieldErrors(projection.fields)
  const allFieldErrors = { ...requiredErrors, ...fieldErrors }
  const hasFieldErrors = Object.keys(allFieldErrors).length > 0
  const valid = Boolean(
    trimmedName && parsedConfig.valid && !hasFieldErrors && status.available
  )

  /**
   * 把一个常用字段写回唯一 JSON 草稿，避免基本模式与高级模式形成两份配置。
   * @param key 待更新的顶层稳定配置键。
   * @param value 经控件校验后的 JSON 值。
   * @returns 无返回值；高级 JSON 文本同步更新。
   */
  const writeConfigValue = (key: string, value: unknown): void => {
    if (!parsedConfig.value) return
    setConfigText(
      JSON.stringify(
        setMaterialConfigValue(parsedConfig.value, key, value),
        null,
        2
      )
    )
  }

  /**
   * 更新数字字段草稿，仅在校验通过后写回配置事实源。
   * @param field 当前数字字段及其整数约束。
   * @param text 浏览器输入文本。
   * @returns 无返回值；非法输入保留在控件中并阻止保存。
   */
  const updateNumber = (field: MaterialConfigField, text: string): void => {
    setNumericDrafts((current) => ({ ...current, [field.key]: text }))
    const parsed = parseMaterialNumber(text, field.integer)
    if (!parsed.valid || parsed.value === undefined) {
      setFieldErrors((current) => ({
        ...current,
        [field.key]: parsed.message ?? '请输入有效数字'
      }))
      return
    }
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[field.key]
      return next
    })
    writeConfigValue(field.key, parsed.value)
  }

  /**
   * 更新数值列表草稿，仅在全部元素有效后写回配置事实源。
   * @param field 当前列表字段及其整数约束。
   * @param text 逗号或空格分隔的浏览器输入文本。
   * @returns 无返回值；非法输入保留在控件中并阻止保存。
   */
  const updateNumberList = (
    field: MaterialConfigField,
    text: string
  ): void => {
    setNumericDrafts((current) => ({ ...current, [field.key]: text }))
    const parsed = parseMaterialNumberList(text, field.integer)
    if (!parsed.valid || parsed.value === undefined) {
      setFieldErrors((current) => ({
        ...current,
        [field.key]: parsed.message ?? '请输入有效数值列表'
      }))
      return
    }
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[field.key]
      return next
    })
    writeConfigValue(field.key, parsed.value)
  }

  /**
   * 在常用配置与高级 JSON 之间切换；返回常用模式前要求 JSON 有效。
   * @returns 无返回值；切换后刷新数字控件草稿并清除过期错误。
   */
  const toggleAdvanced = (): void => {
    if (advanced && !parsedConfig.valid) return
    if (!advanced && hasFieldErrors) return
    if (advanced) {
      const nextProjection = projectMaterialConfig(
        parsedConfig.value ?? {},
        configSchema
      )
      setNumericDrafts(initialNumericDrafts(nextProjection.fields))
      setFieldErrors({})
    }
    setAdvanced((current) => !current)
  }

  /**
   * 校验表单并提交最小物料实例配置补丁。
   * @param event 浏览器表单提交事件。
   * @returns 提交完成后结束；无效表单不会调用服务端口。
   */
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!valid || pending || !parsedConfig.value) return
    await onSave({
      name: trimmedName,
      description: description.trim(),
      config: parsedConfig.value
    })
  }

  return (
    <form
      className="material-inspector__form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="material-config-editor__scope-note">
        <strong>只修改当前物料实例</strong>
        <span>保存不会修改系统代码、设备驱动、物料模板或实验流程。</span>
      </div>

      <fieldset className="material-config-editor__group">
        <legend>基础信息</legend>
        <label>
          <span>物料名称</span>
          <input
            value={name}
            maxLength={120}
            aria-invalid={!trimmedName}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          {!trimmedName ? <small>名称不能为空</small> : null}
        </label>
        <label>
          <span>说明</span>
          <textarea
            value={description}
            rows={3}
            maxLength={500}
            placeholder="记录该物料实例的用途或差异"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </fieldset>

      <section className="material-config-editor" aria-labelledby="config-title">
        <header>
          <div>
            <h3 id="config-title">
              {advanced ? '高级 JSON' : '常用配置'}
            </h3>
            <p>
              {advanced
                ? '适合熟悉配置结构的用户，保存前会校验 JSON。'
                : '按字段直接填写，无需编写 JSON。'}
            </p>
          </div>
          <button
            type="button"
            className="material-config-editor__mode"
            aria-expanded={advanced}
            disabled={advanced ? !parsedConfig.valid : hasFieldErrors}
            onClick={toggleAdvanced}
          >
            {advanced ? '返回常用配置' : '打开高级 JSON'}
          </button>
        </header>

        {advanced ? (
          <label className="material-config-editor__json">
            <span>完整配置 JSON</span>
            <textarea
              className="is-code"
              value={configText}
              rows={14}
              spellCheck={false}
              aria-invalid={!parsedConfig.valid}
              onChange={(event) => setConfigText(event.target.value)}
            />
            {!parsedConfig.valid ? <small>{parsedConfig.message}</small> : null}
          </label>
        ) : (
          <div className="material-config-editor__fields">
            {projection.fields.length ? (
              projection.fields.map((field) => {
                const fieldId = `material-config-${field.key}`
                const errorMessage = allFieldErrors[field.key]
                return field.kind === 'boolean' ? (
                  <label
                    key={field.key}
                    className="material-config-editor__boolean"
                    htmlFor={fieldId}
                  >
                    <span>
                      <strong>{field.label}</strong>
                      <code>{field.key}</code>
                      {field.description ? (
                        <small className="is-hint">{field.description}</small>
                      ) : null}
                    </span>
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={field.value === true}
                      onChange={(event) =>
                        writeConfigValue(field.key, event.target.checked)
                      }
                    />
                  </label>
                ) : (
                  <label key={field.key} htmlFor={fieldId}>
                    <span className="material-config-editor__field-title">
                      <strong>
                        {field.label}
                        {field.required ? ' *' : ''}
                      </strong>
                      <code>{field.key}</code>
                    </span>
                    {field.kind === 'number' ? (
                      <input
                        id={fieldId}
                        type="number"
                        step={field.integer ? 1 : 'any'}
                        value={
                          numericDrafts[field.key] ??
                          formatMaterialConfigField(field)
                        }
                        aria-invalid={Boolean(errorMessage)}
                        onChange={(event) =>
                          updateNumber(field, event.target.value)
                        }
                      />
                    ) : field.kind === 'number-list' ? (
                      <input
                        id={fieldId}
                        type="text"
                        inputMode="decimal"
                        value={
                          numericDrafts[field.key] ??
                          formatMaterialConfigField(field)
                        }
                        placeholder="例如：127.8, 85.5, 14.4"
                        aria-invalid={Boolean(errorMessage)}
                        onChange={(event) =>
                          updateNumberList(field, event.target.value)
                        }
                      />
                    ) : (
                      <input
                        id={fieldId}
                        value={
                          typeof field.value === 'string' ? field.value : ''
                        }
                        aria-invalid={Boolean(errorMessage)}
                        onChange={(event) =>
                          writeConfigValue(field.key, event.target.value)
                        }
                      />
                    )}
                    {field.description ? (
                      <small className="is-hint">{field.description}</small>
                    ) : null}
                    {field.kind === 'number-list' && !errorMessage ? (
                      <small className="is-hint">多个数字请用逗号分隔</small>
                    ) : null}
                    {errorMessage ? <small>{errorMessage}</small> : null}
                  </label>
                )
              })
            ) : (
              <div className="material-config-editor__empty">
                当前没有可直接填写的常用配置项。
              </div>
            )}

            {projection.advancedItems.length ? (
              <div className="material-config-editor__advanced-summary">
                <div>
                  <strong>结构化配置</strong>
                  <small>为避免误改，以下内容收在高级 JSON 中。</small>
                </div>
                <ul>
                  {projection.advancedItems.map((item) => (
                    <li key={item.key}>
                      <span>
                        {item.label} <code>{item.key}</code>
                      </span>
                      <small>{item.summary}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <p className="material-config-editor__revision-note">
        保存会携带当前修订版本；若他人已修改同一物料，系统会提示冲突并保留本表单。
      </p>
      {!status.available ? (
        <p className="material-inspector__notice">{status.reason}</p>
      ) : null}
      {error ? (
        <p className="material-inspector__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="material-inspector__form-actions">
        <button type="button" onClick={onCancel} disabled={pending}>
          取消
        </button>
        <button
          type="submit"
          className="is-primary"
          disabled={!valid || pending}
        >
          {pending ? '正在保存…' : '保存修改'}
        </button>
      </div>
    </form>
  )
}
