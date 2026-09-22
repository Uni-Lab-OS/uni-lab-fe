import { useRef, useState } from 'react'
import type { WorkflowActionCatalogSnapshot } from '@unilab/services'
import { CatalogDialog } from './WorkflowCatalogDialogs'
import { useExperimentOperationDeviceCatalog, projectExperimentOperationDeviceActions } from './ExperimentOperationDeviceCatalog'

/** 从真实设备声明选择动作；人工确认必须绑定明确设备，不创建虚拟动作。 */
export function ManualConfirmationCreateDialog({ catalog, busy, onClose, onCreate }: {
  catalog: WorkflowActionCatalogSnapshot
  busy: boolean
  onClose: () => void
  onCreate: (templateUuid: string, config: { deviceUuid: string; timeoutSeconds: number }) => void
}) {
  const focusRef = useRef<HTMLSelectElement>(null)
  const state = useExperimentOperationDeviceCatalog()
  const [deviceUuid, setDeviceUuid] = useState('')
  const [templateUuid, setTemplateUuid] = useState('')
  const [timeout, setTimeoutValue] = useState('3600')
  const devices = state?.devices ?? []
  const device = devices.find(item => item.materialUuid === deviceUuid)
  const actions = device ? projectExperimentOperationDeviceActions([device], catalog.actionTemplates, '').devices[0]?.actions.filter(item => item.template) ?? [] : []
  const seconds = Number(timeout)
  const validTimeout = Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400
  const valid = !busy && !state?.loading && !state?.error && Boolean(device && actions.some(item => item.template?.uuid === templateUuid)) && validTimeout
  return <CatalogDialog initialFocusRef={focusRef} title="添加人工确认节点" description="选择需要确认后执行的设备动作。批准后下发动作，拒绝或超时取消任务。" onClose={onClose}>
    <form className="workflow-runtime__catalog-form workflow-manual-confirmation-form" onSubmit={event => {
      event.preventDefault()
      if (valid) onCreate(templateUuid, { deviceUuid, timeoutSeconds: seconds })
    }}>
      <label>设备实例<select ref={focusRef} aria-label="人工确认设备" value={deviceUuid} disabled={busy || state?.loading} onChange={event => { setDeviceUuid(event.target.value); setTemplateUuid('') }}>
        <option value="">请选择设备</option>
        {devices.filter(item => item.materialUuid).map(item => <option key={item.materialUuid} value={item.materialUuid}>{item.machineName}</option>)}
      </select></label>
      <label>设备动作<select aria-label="人工确认动作" value={templateUuid} disabled={busy || !device} onChange={event => setTemplateUuid(event.target.value)}>
        <option value="">请选择动作</option>
        {actions.map(item => <option key={item.template!.uuid} value={item.template!.uuid}>{item.label}</option>)}
      </select></label>
      <label>确认超时（秒）<input aria-label="确认超时（秒）" type="number" min={1} max={86400} step={1} value={timeout} disabled={busy} onChange={event => setTimeoutValue(event.target.value)} /></label>
      {!validTimeout && <p role="alert">确认超时必须为 1 到 86400 的整数秒。</p>}
      {(!state || state.error || (!state.loading && devices.length === 0)) && <p role="alert">{state?.error || '没有可用的设备声明，请刷新设备目录。'}{state && <button type="button" onClick={state.refresh}>刷新设备目录</button>}</p>}
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" className="is-primary" disabled={!valid}>添加到画布</button></footer>
    </form>
  </CatalogDialog>
}
