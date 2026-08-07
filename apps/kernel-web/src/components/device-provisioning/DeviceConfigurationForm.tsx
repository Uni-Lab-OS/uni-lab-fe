import { useEffect, useMemo, useState } from 'react'
import type { LocalDeviceProvisioning } from '@unilab/device-provisioning'

import {
  configurationFields,
  initialConfigurationDraft,
  parseConfigurationDraft,
  suggestedInstanceId,
  type DeviceProvisioningApi,
  uiErrorMessage
} from './deviceProvisioningUi'
import styles from './DeviceSquarePanel.module.scss'

interface DeviceConfigurationFormProps {
  api: DeviceProvisioningApi
  record: LocalDeviceProvisioning
  disabled: boolean
  onWorking: (working: boolean) => void
  onCompleted: (record: LocalDeviceProvisioning) => void
}

/**
 * 按 OS PackageCatalog Schema 生成严格类型的驱动初始化表单。
 *
 * @param api 只暴露稳定意图的 Electron 预加载接口。
 * @param record 当前候选本地设备接入（LocalDeviceProvisioning）事实。
 * @param disabled Main 正在执行写入时的交互门禁。
 * @param onWorking 通知父视图更新工作状态的回调。
 * @param onCompleted 写图成功后提交最新记录的回调。
 * @returns 包含实例身份、显式遗留接管和驱动参数的 React 表单。
 */
export default function DeviceConfigurationForm({
  api,
  record,
  disabled,
  onWorking,
  onCompleted
}: DeviceConfigurationFormProps): React.JSX.Element {
  const fields = useMemo(
    () => configurationFields(record.configurationSchema),
    [record.configurationSchema]
  )
  const [instanceId, setInstanceId] = useState(record.instanceId || suggestedInstanceId(record))
  const [displayName, setDisplayName] = useState(record.displayName || record.cloudDisplayName)
  // 接管意图只来自当前复选框，不根据失败消息或同名节点自动推断。
  const [adoptExisting, setAdoptExisting] = useState(false)
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => (
    initialConfigurationDraft(fields, record.configuration)
  ))
  const [error, setError] = useState<string | null>(null)

  // 切换接入记录时清除上一个记录的显式接管选择，避免意图跨设备泄漏。
  useEffect(() => {
    setInstanceId(record.instanceId || suggestedInstanceId(record))
    setDisplayName(record.displayName || record.cloudDisplayName)
    setAdoptExisting(false)
    setDraft(initialConfigurationDraft(fields, record.configuration))
    setError(null)
  }, [fields, record])

  /** 更新单个 Schema 字段草稿，不在 Renderer 做隐式类型猜测。 */
  const updateField = (name: string, value: string | boolean): void => {
    setDraft((current) => ({ ...current, [name]: value }))
  }

  /**
   * 校验表单并要求 OS CLI 原子写入当前设备图。
   *
   * @param event 当前表单提交事件，用于阻止浏览器默认导航。
   * @returns 异步完成，不直接返回设备事实；成功结果经 `onCompleted` 上报。
   */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    if (!instanceId.trim()) {
      setError('设备实例 ID 不能为空')
      return
    }
    if (!displayName.trim()) {
      setError('设备显示名称不能为空')
      return
    }
    try {
      const configuration = parseConfigurationDraft(fields, draft)
      onWorking(true)
      const updated = await api.configure({
        provisioningId: record.provisioningId,
        instanceId: instanceId.trim(),
        displayName: displayName.trim(),
        adoptExisting,
        configuration
      })
      if (updated.status === 'failed') {
        throw new Error(updated.diagnostic?.message || '设备图写入失败')
      }
      onCompleted(updated)
    } catch (reason) {
      setError(uiErrorMessage(reason))
    } finally {
      onWorking(false)
    }
  }

  return (
    <form className={styles.configurationForm} onSubmit={(event) => void handleSubmit(event)}>
      <div className={styles.formIntro}>
        <h3>配置本地设备实例</h3>
        <p>参数由已校验设备包的初始化合同生成，静态默认值会由 OS 再次复核。</p>
      </div>
      <div className={styles.formGrid}>
        <label>
          <span>设备实例 ID <b>必填</b></span>
          <input
            value={instanceId}
            disabled={disabled}
            pattern="[A-Za-z0-9_]+"
            maxLength={128}
            title="设备实例 ID 只能包含字母、数字和下划线"
            onChange={(event) => setInstanceId(event.target.value)}
            placeholder="local_pump_1"
          />
          <small>仅使用字母、数字和下划线，且在同一设备图内不可重复；遗留节点需在下方显式确认接管。</small>
        </label>
        <label>
          <span>显示名称 <b>必填</b></span>
          <input
            value={displayName}
            disabled={disabled}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className={styles.wideField}>
          <span>接管同名旧设备 <em>可选</em></span>
          <span className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={adoptExisting}
              disabled={disabled}
              onChange={(event) => setAdoptExisting(event.target.checked)}
            />
            为设备图中同 ID、同 definition 且尚无 UUID 的旧节点补齐稳定身份
          </span>
          <small>
            接管会保留旧节点的位置、父子关系、连接、运行数据和扩展字段；已有不同
            UUID 的节点仍不会被覆盖。
          </small>
        </label>
        {fields.map((field) => (
          <label key={field.name} className={field.type === 'object' || field.type === 'array' ? styles.wideField : undefined}>
            <span>
              {field.name}
              {field.required ? <b>必填</b> : <em>可选</em>}
              <code>{field.type}</code>
            </span>
            {field.type === 'boolean' ? (
              <span className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={draft[field.name] === true}
                  disabled={disabled}
                  onChange={(event) => updateField(field.name, event.target.checked)}
                />
                启用
              </span>
            ) : field.type === 'object' || field.type === 'array' ? (
              <textarea
                value={String(draft[field.name] ?? '')}
                disabled={disabled}
                rows={5}
                onChange={(event) => updateField(field.name, event.target.value)}
                placeholder={field.type === 'array' ? '[]' : '{}'}
              />
            ) : (
              <input
                type={field.secret
                  ? 'password'
                  : field.type === 'integer' || field.type === 'number'
                    ? 'number'
                    : 'text'}
                step={field.type === 'number' ? 'any' : undefined}
                autoComplete={field.secret ? 'new-password' : undefined}
                value={String(draft[field.name] ?? '')}
                disabled={disabled}
                onChange={(event) => updateField(field.name, event.target.value)}
              />
            )}
            {field.secret ? (
              <small>秘密仅用于本次写入；设备图和本地接入记录只保存安全引用。</small>
            ) : null}
            {field.annotation ? <small>驱动注解：{field.annotation}</small> : null}
          </label>
        ))}
      </div>
      {fields.length === 0 ? (
        <div className={styles.infoBanner}>该驱动没有初始化参数，只需确认本地实例身份。</div>
      ) : null}
      {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.primaryButton} disabled={disabled}>
          {disabled ? '正在写入…' : '校验配置并写入设备图'}
        </button>
      </div>
    </form>
  )
}
