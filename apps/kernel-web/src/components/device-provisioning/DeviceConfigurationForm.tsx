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

/** 按 OS PackageCatalog Schema 生成严格类型的驱动初始化表单。 */
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
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() => (
    initialConfigurationDraft(fields, record.configuration)
  ))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInstanceId(record.instanceId || suggestedInstanceId(record))
    setDisplayName(record.displayName || record.cloudDisplayName)
    setDraft(initialConfigurationDraft(fields, record.configuration))
    setError(null)
  }, [fields, record])

  /** 更新单个 Schema 字段草稿，不在 Renderer 做隐式类型猜测。 */
  const updateField = (name: string, value: string | boolean): void => {
    setDraft((current) => ({ ...current, [name]: value }))
  }

  /** 校验表单并要求 OS CLI 原子写入当前设备图。 */
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
            onChange={(event) => setInstanceId(event.target.value)}
            placeholder="local-pump-1"
          />
          <small>写入设备图的稳定身份，同一设备图内不可重复。</small>
        </label>
        <label>
          <span>显示名称 <b>必填</b></span>
          <input
            value={displayName}
            disabled={disabled}
            onChange={(event) => setDisplayName(event.target.value)}
          />
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
