import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { decisionIntent, sessionFields, versionFields, type StationSnapshot, type StationError } from '@unilab/services'
import type { WorkflowRecoveryController, RecoveryState } from '../../runtime/WorkflowRecoveryController'
import { ManualRecovery } from './ManualRecovery'
import { RecoveryButton } from './RecoveryButton'
import { useRecovery, useRecoveryRead } from './RecoveryContext'
import { ManualActionHistory } from './ManualRecoveryActions'

export type RecoverySubmit = WorkflowRecoveryController['submit']

const LOADING_READ_ERROR = '正在核对工站状态，请稍候'

/** 新出现的工站错误必须自动打开处置弹窗；用户关掉后，同一错误阶段不再强开。 */
export function stationRecoveryDialogUpdate(
  seen: ReadonlySet<string>,
  errors: readonly Pick<StationError, 'decision_id' | 'stage'>[],
  activeSessionDecisionId?: string
): { open: boolean; selectedId: string; nextSeen: Set<string> } {
  const nextSeen = new Set(seen)
  const fresh = errors.filter((item) => !nextSeen.has(`${item.decision_id}:${item.stage}`))
  for (const item of errors) nextSeen.add(`${item.decision_id}:${item.stage}`)
  return {
    open: fresh.length > 0,
    selectedId: activeSessionDecisionId || fresh[0]?.decision_id || '',
    nextSeen
  }
}

/** 工站已有待处理错误或暂停时，第一次挂载就要直接打开弹窗。 */
export function shouldOpenStationRecoveryDialog(state: Pick<RecoveryState, 'unconfirmed' | 'station'>): boolean {
  const snapshot = state.station
  return Boolean(
    state.unconfirmed ||
    snapshot?.errors.length ||
    snapshot?.mode === 'PAUSED' ||
    snapshot?.control_commands.some((item) => item.needs_apply)
  )
}

/** 加载中的占位错误不应当弹出处置面，避免空白弹窗抢焦点。 */
export function stationRecoveryNeedsAttention(state: RecoveryState): boolean {
  return shouldOpenStationRecoveryDialog(state) || Boolean(state.readError && state.readError !== LOADING_READ_ERROR)
}

export function StationRecovery({
  controller,
  state,
  writable,
  workflowName,
  nodeNames = {}
}: {
  controller: WorkflowRecoveryController
  state: RecoveryState
  writable: boolean
  workflowName?: string
  nodeNames?: Record<string, string>
}) {
  const [open, setOpen] = useState(() => shouldOpenStationRecoveryDialog(state))
  const [selectedId, setSelectedId] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const seenErrors = useRef(new Set<string>())
  const pendingRef = useRef(state.pending)
  pendingRef.current = state.pending
  const snapshot = state.station
  const errors = snapshot?.errors || []
  const attention = shouldOpenStationRecoveryDialog(state)
  const close = () => { if (!pendingRef.current) setOpen(false) }
  useEffect(() => {
    if (!snapshot) return
    const update = stationRecoveryDialogUpdate(
      seenErrors.current,
      snapshot.errors,
      snapshot.active_session?.decision_id
    )
    seenErrors.current = update.nextSeen
    if (update.open) {
      if (update.selectedId) setSelectedId(update.selectedId)
      setOpen(true)
      return
    }
    if (state.unconfirmed) setOpen(true)
  }, [snapshot, state.revision, state.unconfirmed])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key !== 'Tab') return
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')
      const first = elements?.[0]; const last = elements?.[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [open])
  const selected = snapshot?.errors.find((item) => item.decision_id === selectedId) || snapshot?.errors.find((item) => item.decision_id === snapshot.active_session?.decision_id) || snapshot?.errors[0]
  const session = snapshot?.active_session
  const applyingSession = session?.decision_id === selected?.decision_id && selected?.stage === 'APPLYING'
  const manual = session?.stage === 'MANUAL_HANDLING' && session.decision_id === selected?.decision_id && !applyingSession
  const commands = snapshot?.control_commands.filter((item) => item.needs_apply) || []
  const sourceNodeId = selected?.meta_data.source_node_id
  const nodeLabel = (sourceNodeId && nodeNames[sourceNodeId]) || sourceNodeId || '错误节点'
  const title = manual ? '人工处置' : errors.length ? '节点执行出错' : attention ? '确认恢复调度' : '错误处置已完成'
  return <>
    <div className="workflow-recovery__banner" role="status">
      <span className="workflow-recovery__banner-icon" aria-hidden="true">⏸</span>
      <div>
        <strong>{state.readError ? '错误处置状态暂不可用' : snapshot?.mode === 'PAUSED' ? '工站调度已暂停' : '还有节点错误待处理'}</strong>
        <span>{state.readError ? '请刷新状态后操作。' : snapshot?.mode === 'PAUSED' ? `${errors.length} 条错误待处理；等待节点暂停派发，已开始的动作继续运行。` : `${errors.length} 条错误待处理；工站已由人工恢复调度，错误任务仍等待决定。`}</span>
      </div>
      <RecoveryButton tone="primary" onClick={() => setOpen(true)}>{session?.stage === 'MANUAL_HANDLING' ? '继续手动处理' : '处理节点错误'}</RecoveryButton>
    </div>
    {open && createPortal(<div className="workflow-recovery__backdrop">
      <div className="workflow-recovery__dialog" role="dialog" aria-modal="true" aria-labelledby="station-handling-title" tabIndex={-1} ref={dialog}>
        <header>
          <div>
            <span>工站错误处置</span>
            <h2 id="station-handling-title">{title}</h2>
            <p>{snapshot?.mode === 'RUNNING' && !errors.length ? '工站已恢复调度。' : '暂停范围：当前工站全部工作流 Task。'}</p>
          </div>
          <button type="button" className="workflow-recovery__close" disabled={state.pending} onClick={close} aria-label="关闭错误处置弹窗">
            <CloseIcon />
          </button>
        </header>
        <div className="workflow-recovery__body">
          {state.readError && <div className="workflow-recovery__alert" role="alert">错误处置状态读取失败，写操作已暂停。{state.readError}<RecoveryButton onClick={() => void controller.refresh()}>重新读取状态</RecoveryButton></div>}
          {state.error && <div className="workflow-recovery__alert" role="alert">{state.error}</div>}
          {state.unconfirmed && <div className="workflow-recovery__alert" role="alert"><div><strong>{state.unconfirmed.label}：结果待确认</strong><p>将按原请求身份继续确认，不会创建第二条操作。</p></div><RecoveryButton disabled={state.pending || Boolean(state.readError)} onClick={() => void controller.retry()}>确认原请求结果</RecoveryButton></div>}
          {!snapshot ? <p>正在读取工站状态…</p> : <>
            {errors.length > 1 && <label className="workflow-recovery__field"><span>待处理错误（{errors.length}）</span><select value={selected?.decision_id || ''} onChange={(event) => setSelectedId(event.target.value)}>{errors.map((item) => <option key={item.decision_id} value={item.decision_id}>{workflowName || '任务'} · {item.source_task_uuid.slice(0, 8)} · {item.source_job_uuid.slice(0, 8)}</option>)}</select></label>}
            {selected && <div className="workflow-recovery__error-context">
              <strong>{workflowName || '工作流任务'} · {nodeLabel}</strong>
              <p>{selected.meta_data.message || '节点执行失败，请检查现场。'}</p>
              <details>
                <summary>任务与执行记录</summary>
                <code>Task：{selected.source_task_uuid}</code>
                <code>Job：{selected.source_job_uuid}</code>
              </details>
            </div>}
            {commands.map((command) => <CommandDetails key={command.command_uuid} command={command} writable={writable} submit={controller.submit} />)}
            {applyingSession && session ? <>
              <p className="workflow-recovery__note">当前选择已受理，正在应用。请核对手动动作结果后继续应用原操作。</p>
              <ManualActionHistory snapshot={snapshot} session={session} writable={writable} submit={controller.submit} />
            </> : null}
            {manual && session
              ? <ManualRecovery key={session.session_id} snapshot={snapshot} session={session} writable={writable} submit={controller.submit} />
              : attention && !applyingSession
                ? <RecoveryDecision key={`${snapshot.snapshot_id}:${selected?.decision_id}:${selected?.decision_version}:${session?.version}:${writable}`} snapshot={snapshot} error={selected} writable={writable} submit={controller.submit} />
                : !attention ? <p className="workflow-recovery__success">处理完成。可返回任务列表查看节点和任务的最新执行结果。</p> : null}
            {session && !manual && session.decision_id !== selected?.decision_id && <RecoveryButton onClick={() => setSelectedId(session.decision_id)}>打开当前人工处置会话</RecoveryButton>}
          </>}
        </div>
        <footer>
          <span>{state.pending ? '正在提交，请等待…' : snapshot?.mode === 'PAUSED' ? '关闭弹窗后工站仍保持暂停，可从页面顶部重新打开。' : '以 OS 返回的最新执行状态为准。'}</span>
          <RecoveryButton disabled={state.pending} onClick={close}>{attention ? '稍后处理' : '关闭'}</RecoveryButton>
        </footer>
      </div>
    </div>, document.body)}
  </>
}

export function RecoveryDecision({ snapshot, error, writable, submit }: { snapshot: StationSnapshot; error?: StationError; writable: boolean; submit: RecoverySubmit }) {
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const session = snapshot.active_session
  const anotherSession = Boolean(session && session.decision_id !== error?.decision_id)
  const deciding = error?.stage === 'DECISION_REQUIRED' && !anotherSession
  if (!error && snapshot.mode === 'RUNNING' && !session) return <p>工站正在正常调度，当前没有待处理错误。</p>
  if (error?.stage === 'APPLYING') return <p>当前选择已受理，正在应用。请等待处理结果。</p>
  if (anotherSession) return <p>另一条错误正在人工处置，请先完成该会话。</p>
  if (error && error.stage !== 'DECISION_REQUIRED') return <p>当前错误暂不可操作，请刷新状态。</p>
  const decide = (action: 'cancel_task' | 'retry_current_node' | 'enter_manual_handling') => {
    if (!writable || !error) return
    const intent = decisionIntent(snapshot, error, action, confirmed, reason)
    void submit(intent.path, intent.body, { cancel_task: '取消当前任务', retry_current_node: '重试当前节点', enter_manual_handling: '进入手动处理' }[action])
  }
  return <section className="workflow-recovery__decision">
    {deciding || !error ? <>
      {session?.decision_id === error?.decision_id && session ? <p className="workflow-recovery__note">现场处理已完成，调度继续暂停。请选择重试当前节点或取消当前任务。</p> : null}
      {error
        ? <label className="workflow-recovery__field"><span>处理说明（选填）</span><textarea rows={2} maxLength={20000} disabled={!writable} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        : <p>当前错误已处理。确认现场状态后，可恢复工作流调度。</p>}
      <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)} />我已核对现场，确认可以恢复工站工作流调度</label>
      <p className="workflow-recovery__hint">{confirmed ? '本次处理应用后恢复调度；其他待处理任务仍等待人工决定，新错误会再次暂停工站。' : snapshot.mode === 'PAUSED' ? '未勾选时，重试或取消的选择会保留，工站继续暂停，可稍后确认恢复。' : '工站当前正在调度，其他错误任务仍等待各自的人工决定。'}</p>
      <div className="workflow-recovery__actions">{error ? <>
        <RecoveryButton tone="danger" disabled={!writable} onClick={() => decide('cancel_task')}>取消当前任务</RecoveryButton>
        <RecoveryButton tone="primary" disabled={!writable} onClick={() => decide('retry_current_node')}><RefreshIcon />重试当前节点</RecoveryButton>
        {session
          ? <RecoveryButton disabled={!writable} onClick={() => void submit(`/sessions/${encodeURIComponent(session.session_id)}/return`, sessionFields(snapshot, session), '返回手动处理')}>返回手动处理</RecoveryButton>
          : <RecoveryButton disabled={!writable} onClick={() => decide('enter_manual_handling')}>进入手动处理</RecoveryButton>}
      </> : <RecoveryButton tone="primary" disabled={!writable || !confirmed || snapshot.mode !== 'PAUSED'} onClick={() => void submit('/resume', { ...versionFields(snapshot), observed_error_epoch: snapshot.error_epoch, operator_confirmed: true, confirm_snapshot_id: snapshot.snapshot_id }, '恢复工站调度')}>恢复工站调度</RecoveryButton>}</div>
    </> : null}
  </section>
}

function CommandDetails({ command, writable, submit }: { command: StationSnapshot['control_commands'][number]; writable: boolean; submit: RecoverySubmit }) {
  const { port } = useRecovery()
  const query = useRecoveryRead(`command:${command.command_uuid}`, () => port.loadCommand(command.command_uuid), true, 2000)
  return <div className="workflow-recovery__pending-command">
    <div>
      <strong>操作已受理，等待应用</strong>
      <small>{query.data?.result.error || '尚未确认应用完成，可以继续应用同一条命令。'}</small>
      <code>{command.command_uuid}</code>
      {query.error ? <small role="alert">{query.error}</small> : null}
    </div>
    <RecoveryButton disabled={!writable || !query.data || Boolean(query.error)} onClick={() => void submit(`/control-commands/${encodeURIComponent(command.command_uuid)}/apply`, {}, '继续应用原操作')}>继续应用</RecoveryButton>
  </div>
}

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
}

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" /><path d="M21 3v6h-6" /><path d="M3 21v-6h6" /></svg>
}
