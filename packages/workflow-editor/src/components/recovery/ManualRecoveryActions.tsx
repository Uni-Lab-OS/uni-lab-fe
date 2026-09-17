import { useState } from 'react'
import { sessionFields, type HandlingSession, type StationSnapshot, type ManualActionJob, type ManualDeviceAction } from '@unilab/services'
import { useRecovery, useRecoveryRead } from './RecoveryContext'
import { ManualActionParameters, parameterDefaults, parseManualParameters } from './ManualActionParameters'
import type { RecoverySubmit } from './StationRecovery'
type Props = { snapshot: StationSnapshot; session: HandlingSession; writable: boolean; submit: RecoverySubmit }
export function ManualRecoveryActions(props: Props) {
  const { port } = useRecovery()
  const [device, setDevice] = useState('')
  const [actionId, setActionId] = useState('')
  const devices = useRecoveryRead('devices', port.loadDevices)
  const deviceAvailable = Boolean(devices.data?.some((item) => item.id === device)) && !devices.error && !devices.loading
  const actions = useRecoveryRead(`actions:${props.session.session_id}:${device}`, () => port.loadActions(props.session.session_id, device), Boolean(device))
  const action = actions.data?.find((item) => item.action_id === actionId)
  return <section>
    <label>设备<select value={device} disabled={!props.writable || devices.loading} onChange={(event) => { setDevice(event.target.value); setActionId('') }}><option value="">选择设备</option>{devices.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>动作<select value={actionId} disabled={!props.writable || actions.loading || !deviceAvailable} onChange={(event) => setActionId(event.target.value)}><option value="">选择动作</option>{actions.data?.map((item) => <option key={item.action_id} value={item.action_id}>{item.display_name || item.name}</option>)}</select></label>
    {(devices.error || actions.error) && <p role="alert">{devices.error || actions.error}<button type="button" onClick={() => { devices.refresh(); actions.refresh() }}>重新读取动作目录</button></p>}
    {action && <ManualActionForm key={`${device}:${action.action_id}:${action.action_version}`} {...props} writable={props.writable && deviceAvailable && !actions.loading && !actions.error} device={device} action={action} />}
  </section>
}
function ManualActionForm({ snapshot, session, writable, submit, device, action }: Props & { device: string; action: ManualDeviceAction }) {
  const [drafts, setDrafts] = useState(() => parameterDefaults(action))
  const [raw, setRaw] = useState(JSON.stringify(action.defaults, null, 2))
  const [asJson, setAsJson] = useState(false)
  const [error, setError] = useState('')
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (!writable) return
    try {
      const parameters = parseManualParameters(action, drafts, raw, asJson)
      setError('')
      void submit(`/sessions/${encodeURIComponent(session.session_id)}/manual-actions`, { ...sessionFields(snapshot, session), device_id: device, action_id: action.action_id, action_version: action.action_version, parameters }, '执行手动动作')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }}>
    <label className="workflow-recovery__check"><input type="checkbox" checked={asJson} disabled={!writable} onChange={(event) => {
      try {
        if (event.target.checked) setRaw(JSON.stringify(parseManualParameters(action, drafts, raw), null, 2))
        else setDrafts(parameterDefaults({ ...action, defaults: parseManualParameters(action, {}, raw, true) }))
        setAsJson(event.target.checked); setError('')
      } catch (cause) { setError(String(cause)) }
    }} />使用完整 JSON 参数</label>
    <ManualActionParameters action={action} drafts={drafts} raw={raw} asJson={asJson} disabled={!writable} onDraft={(key, value) => setDrafts((current) => ({ ...current, [key]: value }))} onRaw={setRaw} />
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={!writable}>执行单点动作</button>
  </form>
}
export function ManualActionHistory({ snapshot, session, writable, submit }: Props) {
  const jobs = snapshot.manual_actions.filter((job) => job.meta_data.session_id === session.session_id)
  return <section><h3>本次手动动作记录</h3>{!jobs.length && <p>尚未执行手动动作。</p>}{jobs.map((job) => <ManualActionRecord key={job.uuid} job={job} snapshot={snapshot} session={session} writable={writable} submit={submit} />)}</section>
}
function ManualActionRecord({ job, ...props }: Props & { job: ManualActionJob }) {
  const { port } = useRecovery()
  const [details, setDetails] = useState(false)
  const result = useRecoveryRead(`manual:${job.edge_command_uuid}:${job.status}`, () => port.loadManualAction(job.edge_command_uuid), details)
  const ended = ['succeeded', 'failed', 'timeout', 'canceled'].includes(job.status)
  const names: Record<string, string> = { pending: '等待派发', dispatched: '已派发', running: '运行中', succeeded: '成功', failed: '失败', canceled: '已取消', timeout: '超时', cancel_requested: '请求停止中' }
  return <article>
    <strong>{job.action_name || job.control_data?.dispatch_payload?.action || '手动动作'} · {names[job.status] || job.status}</strong>
    <p>{job.result_reviewed ? '结果已人工核对' : job.uncertainty_reason ? '结果待核对' : ''}</p>
    <button type="button" onClick={() => setDetails(!details)}>{details ? '收起执行记录' : '查看执行记录'}</button>
    {!ended && <button type="button" disabled={!props.writable || job.status === 'cancel_requested'} onClick={() => void props.submit(`/manual-actions/${encodeURIComponent(job.edge_command_uuid)}/stop`, { reason: '用户从异常处置面板请求停止' }, '停止手动动作')}>停止动作</button>}
    {details && (result.error ? <p role="alert">{result.error}</p> : <pre>{result.data ? JSON.stringify({ parameters: result.data.execution_job.param, result: result.data.execution_job.return_info, error: result.data.execution_job.error_info }, null, 2) : '读取中…'}</pre>)}
    {ended && job.uncertainty_reason && !job.result_reviewed && <ManualResultReview key={`${job.review_version}:${props.snapshot.snapshot_id}:${props.writable}`} job={job} {...props} />}
  </article>
}
function ManualResultReview({ job, snapshot, session, writable, submit }: Props & { job: ManualActionJob }) {
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  return <section><label>核对说明<textarea maxLength={20000} value={reason} disabled={!writable} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)} />我已现场核对动作停止、执行结果及物料状态</label>
    <button type="button" disabled={!writable || !confirmed || !reason.trim() || !job.review_version} onClick={() => void submit(`/manual-actions/${encodeURIComponent(job.edge_command_uuid)}/review`, { ...sessionFields(snapshot, session), session_id: session.session_id, expected_review_version: job.review_version, operator_confirmed: true, reason: reason.trim() }, '保存核对记录')}>保存核对记录</button>
  </section>
}
