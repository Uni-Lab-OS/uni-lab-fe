import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decisionIntent, sessionFields, versionFields, type StationSnapshot, type StationError } from '@unilab/services'
import type { WorkflowRecoveryController, RecoveryState } from '../../runtime/WorkflowRecoveryController'
import { ManualRecovery } from './ManualRecovery'
import { useRecovery, useRecoveryRead } from './RecoveryContext'
import { ManualActionHistory } from './ManualRecoveryActions'

export type RecoverySubmit = WorkflowRecoveryController['submit']
export function StationRecovery({ controller, state, writable }: { controller: WorkflowRecoveryController; state: RecoveryState; writable: boolean }) {
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const snapshot = state.station
  const attention = Boolean(snapshot?.errors.length || snapshot?.mode === 'PAUSED' || state.unconfirmed || snapshot?.control_commands.some((item) => item.needs_apply))
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !state.pending) setOpen(false)
      if (event.key !== 'Tab') return
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')
      const first = elements?.[0]; const last = elements?.[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [open, state.pending])
  const selected = snapshot?.errors.find((item) => item.decision_id === selectedId) || snapshot?.errors.find((item) => item.decision_id === snapshot.active_session?.decision_id) || snapshot?.errors[0]
  const session = snapshot?.active_session
  return <>
    <div className="workflow-recovery__banner" role="status">
      <span>{state.readError ? '异常处置状态不可用，写操作已暂停' : attention ? `工站${snapshot?.mode === 'PAUSED' ? '调度已暂停' : '存在待处理异常'} · ${snapshot?.errors.length ?? 0} 条错误` : '工站异常处置'}</span>
      <button type="button" onClick={() => setOpen(true)}>{attention ? '处理异常' : '查看工站状态'}</button>
    </div>
    {open && createPortal(<div className="workflow-recovery workflow-recovery__backdrop">
      <div className="workflow-recovery__dialog" role="dialog" aria-modal="true" aria-label="工站异常处置" tabIndex={-1} ref={dialog}>
        <header><h2>工站异常处置</h2><button type="button" disabled={state.pending} onClick={() => setOpen(false)} aria-label="关闭异常处置">关闭</button></header>
        <p>调度控制范围为当前工站全部工作流任务。已开始的设备动作可能仍在执行。</p>
        <button type="button" onClick={() => void controller.refresh()}>刷新工站状态</button>
        {state.readError && <p role="alert">{state.readError}</p>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.unconfirmed && <section role="alert"><p>{state.unconfirmed.label}：结果待确认。将使用原请求身份继续确认。</p><button type="button" disabled={state.pending || Boolean(state.readError)} onClick={() => void controller.retry()}>确认原请求结果</button></section>}
        {!snapshot ? <p>正在读取工站状态…</p> : <>
          {snapshot.errors.length > 1 && <label>待处理错误<select value={selected?.decision_id} onChange={(event) => setSelectedId(event.target.value)}>{snapshot.errors.map((item) => <option key={item.decision_id} value={item.decision_id}>{item.meta_data.source_node_id || item.source_job_uuid} · {item.source_task_uuid}</option>)}</select></label>}
          {selected && <section><h3>{selected.meta_data.message || '节点执行失败'}</h3><small>任务：{selected.source_task_uuid}<br />节点作业：{selected.source_job_uuid}</small></section>}
          {snapshot.control_commands.map((command) => <CommandDetails key={command.command_uuid} command={command} writable={writable} submit={controller.submit} />)}
          {session?.stage === 'MANUAL_HANDLING' && session.decision_id === selected?.decision_id && selected.stage !== 'APPLYING'
            ? <ManualRecovery key={session.session_id} snapshot={snapshot} session={session} writable={writable} submit={controller.submit} />
            : <>
              {selected?.stage === 'APPLYING' && session && <ManualActionHistory snapshot={snapshot} session={session} writable={writable} submit={controller.submit} />}
              <RecoveryDecision key={`${snapshot.snapshot_id}:${selected?.decision_id}:${selected?.decision_version}:${session?.version}:${writable}`} snapshot={snapshot} error={selected} writable={writable} submit={controller.submit} />
            </>}
          {session && session.decision_id !== selected?.decision_id && <button type="button" onClick={() => setSelectedId(session.decision_id)}>打开当前人工处置会话</button>}
        </>}
        <footer>{state.pending ? '正在提交…' : snapshot?.mode === 'PAUSED' ? '关闭窗口后工站仍保持暂停。' : '以 OS 返回的运行状态为准。'}</footer>
      </div>
    </div>, document.body)}
  </>
}

export function RecoveryDecision({ snapshot, error, writable, submit }: { snapshot: StationSnapshot; error?: StationError; writable: boolean; submit: RecoverySubmit }) {
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const session = snapshot.active_session
  if (!error && snapshot.mode === 'RUNNING' && !session) return <p>工站正在正常调度，当前没有待处理错误。</p>
  if (error?.stage === 'APPLYING') return <p>处理选择已受理，正在应用。请核对手动动作结果后继续应用原操作。</p>
  if (session && session.decision_id !== error?.decision_id) return <p>请先完成当前人工处置会话。</p>
  if (error && error.stage !== 'DECISION_REQUIRED') return <p>当前错误暂不可操作，请刷新状态。</p>
  const decide = (action: 'cancel_task' | 'retry_current_node' | 'enter_manual_handling') => {
    if (!writable || !error) return
    const intent = decisionIntent(snapshot, error, action, confirmed, reason)
    void submit(intent.path, intent.body, { cancel_task: '取消任务', retry_current_node: '重试当前节点', enter_manual_handling: '进入人工处置' }[action])
  }
  return <section>
    {error && <label>处理说明<textarea maxLength={20000} disabled={!writable} value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
    <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)} />我已核对现场，确认可以恢复工站工作流调度</label>
    <p>{confirmed ? '处理应用后请求恢复调度，其他待处理错误仍等待各自决定。' : '未勾选时，仅提交处理选择，工站继续暂停。'}</p>
    <div className="workflow-recovery__actions">{error ? <>
      <button type="button" disabled={!writable} onClick={() => decide('retry_current_node')}>重试当前节点</button>
      <button type="button" disabled={!writable} onClick={() => decide('cancel_task')}>取消当前任务</button>
      {session ? <button type="button" disabled={!writable} onClick={() => void submit(`/sessions/${encodeURIComponent(session.session_id)}/return`, sessionFields(snapshot, session), '返回人工处置')}>返回人工处置</button>
        : <button type="button" disabled={!writable} onClick={() => decide('enter_manual_handling')}>进入人工处置</button>}
    </> : <button type="button" disabled={!writable || !confirmed || snapshot.mode !== 'PAUSED'} onClick={() => void submit('/resume', { ...versionFields(snapshot), observed_error_epoch: snapshot.error_epoch, operator_confirmed: true, confirm_snapshot_id: snapshot.snapshot_id }, '恢复工站调度')}>恢复工站调度</button>}</div>
  </section>
}

function CommandDetails({ command, writable, submit }: { command: StationSnapshot['control_commands'][number]; writable: boolean; submit: RecoverySubmit }) {
  const { port } = useRecovery()
  const [open, setOpen] = useState(command.needs_apply)
  const query = useRecoveryRead(`command:${command.command_uuid}`, () => port.loadCommand(command.command_uuid), open, 2000)
  return <section><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>处置命令 · {command.operation} · {query.data?.status || command.status}</button>
    {open && <><p>命令编号：{command.command_uuid}</p>
      {query.error && <p role="alert">命令读取失败：{query.error}</p>}
      {query.data && <><pre>{JSON.stringify(query.data.result, null, 2)}</pre>
        {query.data.application_error && <p role="alert">应用失败：{query.data.application_error}</p>}
        {query.data.dispatch_error && <p role="alert">下发失败：{query.data.dispatch_error}</p>}</>}
      <button type="button" onClick={query.refresh}>刷新命令详情</button>
      {command.needs_apply && <button type="button" disabled={!writable || !query.data || Boolean(query.error)} onClick={() => void submit(`/control-commands/${encodeURIComponent(command.command_uuid)}/apply`, {}, '继续应用原操作')}>继续应用</button>}
    </>}
  </section>
}
