import { useEffect, useRef, useState } from 'react'
import {
  selectEnvironmentReset,
  type WorkflowEnvironmentResetPlan,
  type WorkflowEnvironmentResetPort,
  type WorkflowEnvironmentResetResult,
  type WorkflowEnvironmentResetSelection
} from '../utils/workflowEnvironmentReset'
import styles from './WorkflowEnvironmentResetDialog.module.scss'

/** 先预览并冻结范围，随后确认；API 失败不隐式重新取版本或退回重建数据库。 */
export function WorkflowEnvironmentResetDialog({ port, onClose }: {
  port: WorkflowEnvironmentResetPort
  onClose: () => void
}): React.JSX.Element {
  const element = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const lifetime = useRef(new AbortController())
  const [selection, setSelection] = useState<WorkflowEnvironmentResetSelection>({
    rebuild: false, materials: port.available.materials, locks: false
  })
  const [plan, setPlan] = useState<WorkflowEnvironmentResetPlan | null>(null)
  const [results, setResults] = useState<WorkflowEnvironmentResetResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setResults(null)
    setError(null)
    setPlan(null)
    setConfirmed(false)
    return () => controller.abort()
  }, [port])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = element.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])
  const preview = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setPlan(null)
    setResults(null)
    setConfirmed(false)
    setError(null)
    const signal = lifetime.current.signal
    try {
      const nextPlan = await port.preview(selection)
      if (!signal.aborted) setPlan(nextPlan)
    }
    catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : '预览失败') }
    finally { submitting.current = false; setBusy(false) }
  }
  const execute = async () => {
    if (submitting.current || !plan || !confirmed || !reason.trim()) return
    submitting.current = true
    setBusy(true)
    setError(null)
    const signal = lifetime.current.signal
    try {
      const nextResults = await plan.execute(reason.trim(), signal)
      if (!signal.aborted) setResults(nextResults)
    }
    catch (failure) { if (!signal.aborted) setError(failure instanceof Error ? failure.message : '复位结果未知，请重新核对') }
    finally { submitting.current = false; setBusy(false); setPlan(null); setConfirmed(false) }
  }
  const choices: Array<[keyof WorkflowEnvironmentResetSelection, string, string]> = [
    ['rebuild', '重建本地数据', '停止服务并重建本地库存、设备状态和工作流历史，随后恢复服务；包含以下两项。'],
    ['materials', '复位物料', '按启动设备图恢复原有物料位置，新建物料保留并移到未放置；不重启服务，不改变数量或内容，也不移动实物。'],
    ['locks', '复位设备锁', '释放符合条件的异常终态任务资源锁；运行中的任务不会被强行解锁。']
  ]
  return <dialog ref={element} className={styles.dialog} aria-labelledby="environment-reset-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><h2 id="environment-reset-title">复位运行环境</h2>
      <button type="button" disabled={busy} onClick={onClose} aria-label="关闭复位窗口">×</button></header>
    <div className={styles.body}>
      {choices.map(([key, label, description]) => <label key={key} className={styles.option}>
        <input type="checkbox" checked={selection[key]}
          disabled={busy || (key !== 'rebuild' && selection.rebuild) || !port.available[key]}
          onChange={event => {
            setSelection(selectEnvironmentReset(selection, key, event.target.checked))
            setPlan(null); setResults(null); setConfirmed(false); setError(null)
          }} />
        <span><strong>{label}</strong><small>{description}</small>
          {!port.available[key] && !selection.rebuild && <small>当前连接不支持单独执行此项。</small>}</span>
      </label>)}
      {error ? <p role="alert">{error}</p> : null}
      {plan ? <section aria-label="复位预览">
        <h3>本次复位范围</h3><ul>{plan.summary.map((line, index) => <li key={index}>{line}</li>)}</ul>
        <label className={styles.reason}>现场处置说明
          <textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} rows={2} />
        </label>
        <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={event => setConfirmed(event.target.checked)} />
          我已核对上述范围，确认设备已停止、实物位置与预览目标一致，可以执行所选复位。
        </label>
      </section> : null}
      {results ? <ul aria-live="polite">{results.map(result => <li key={result.operation}
        role={result.status === 'failed' ? 'alert' : 'status'}>
        <strong>{result.operation}：{result.status === 'completed' ? '已完成' : result.status === 'failed' ? '需核对' : '未执行'}</strong>
        <p>{result.message}</p>
      </li>)}</ul> : null}
    </div>
    <footer><button type="button" disabled={busy} onClick={onClose}>关闭</button>
      <button type="button" disabled={busy || !Object.values(selection).some(Boolean)} onClick={() => void preview()}>
        {busy ? '处理中…' : results || plan ? '重新预览' : '预览复位范围'}
      </button>
      {plan ? <button type="button" disabled={busy || !confirmed || !reason.trim()} onClick={() => void execute()}>确认执行</button> : null}
    </footer>
  </dialog>
}
