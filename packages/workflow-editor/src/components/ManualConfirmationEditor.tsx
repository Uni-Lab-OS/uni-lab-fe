import { useState } from 'react'

/** 编辑现有包装的超时配置，关闭后恢复底层模板节点类型。 */
export function ManualConfirmationEditor({ timeoutSeconds, deviceUuid, editable, onChange }: {
  timeoutSeconds: number; deviceUuid: string; editable: boolean
  onChange: (config: { deviceUuid: string; timeoutSeconds: number } | null) => void
}) {
  const [draft, setDraft] = useState(String(timeoutSeconds))
  const valid = Number.isInteger(Number(draft)) && Number(draft) >= 1 && Number(draft) <= 86400
  return <section className="persistent-authoring__manual-confirmation" aria-label="人工确认配置">
    <strong>执行前需要人工确认</strong>
    <p>批准后下发设备动作；拒绝或超时会取消任务。</p>
    <label>确认超时（秒）<input type="number" min={1} max={86400} step={1} value={draft} disabled={!editable}
      onChange={event => setDraft(event.target.value)} onBlur={() => {
        if (valid) onChange({ deviceUuid, timeoutSeconds: Number(draft) })
      }} /></label>
    {!valid && <p role="alert">请输入 1 到 86400 的整数秒。</p>}
    <button type="button" disabled={!editable} onClick={() => onChange(null)}>取消人工确认，恢复普通动作</button>
  </section>
}
