import { useEffect, useState } from 'react'
import { ServiceError } from '@unilab/services'
import type { ExecutionLockSnapshot, WorkflowNodeJob, WorkflowTask, WorkflowRuntimePort } from '@unilab/services'
import { useRecovery, useRecoveryRead } from './RecoveryContext'
import { useRecoveryWrite } from './useRecoveryWrite'

export function TaskRecovery({ task, jobs, runtime, writable, refresh }: { task: WorkflowTask; jobs: readonly WorkflowNodeJob[]; runtime: WorkflowRuntimePort; writable: boolean; refresh: () => Promise<void> }) {
  return <details><summary>任务异常与资源恢复</summary>
    {['failed', 'canceled', 'timeout'].includes(task.status) && <TaskUnlock key={task.uuid} task={task} writable={writable} refresh={refresh} />}
    {jobs.filter((job) => job.uncertainty_reason === 'material_transfer_inventory_reconciliation_required').map((job) => <TransferSettlement key={job.uuid} job={job} runtime={runtime} writable={writable} refresh={refresh} />)}
    {jobs.filter((job) => job.execution_source === 'error_manual' && job.uncertainty_reason && !job.result_reviewed && ['succeeded', 'failed', 'canceled', 'timeout'].includes(job.status)).map((job) => <HistoricalReview key={job.uuid} job={job} writable={writable} refresh={refresh} />)}
    {!['failed', 'canceled', 'timeout'].includes(task.status) && <p>任务结束为失败、取消或超时后，才可申请解除任务资源。</p>}
  </details>
}
function TaskUnlock({ task, writable, refresh }: { task: WorkflowTask; writable: boolean; refresh: () => Promise<void> }) {
  const { port } = useRecovery()
  const locks = useRecoveryRead(`locks:${task.uuid}`, () => port.loadLocks(task.uuid))
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [locks.data, writable])
  const write = useRecoveryWrite(`unlock:${task.uuid}`, async ({ key, body }) => {
    const result = await port.unlockTask(task.uuid, String(body.reason), key)
    if (result.status === 'rejected') throw new ServiceError({ code: 'UNLOCK_REJECTED', status: 409, message: `解锁被拒绝：${result.result?.reason || '请核对任务和锁状态'}` })
    return result.status === 'succeeded'
  }, refresh)
  return <section><h3>解除任务资源</h3>
    <p>仅解除调度逻辑占用，不会停止设备或移动物料。请先完成现场核对。</p>
    {locks.error ? <p role="alert">{locks.error}</p> : <p>{locks.data?.locks.length ?? '…'} 个执行锁；{locks.data?.active_device_tenancy_count ?? '…'} 个设备占用。</p>}
    {locks.data?.locks.map((lock) => <LockRelease key={lock.uuid} task={task.uuid} lock={lock} loading={locks.loading} writable={writable && !locks.error && !write.pending && !write.intent} refresh={async () => { locks.refresh(); await refresh() }} />)}
    <label>释放原因<textarea value={reason} disabled={!writable || write.pending || Boolean(write.intent)} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} disabled={!writable || write.pending || Boolean(write.intent)} onChange={(event) => setConfirmed(event.target.checked)} />我已核对设备停止、物料实际位置，确认可以释放资源</label>
    <button type="button" disabled={!writable || write.pending || (!write.intent && (!confirmed || !reason.trim() || !locks.data || locks.loading || Boolean(locks.error)))} onClick={() => void write.submit({ reason: reason.trim() })}>{write.intent ? '确认原解锁请求' : '解除任务资源'}</button>
    <button type="button" onClick={() => { setConfirmed(false); locks.refresh() }}>刷新资源状态</button>
    {write.error && <p role="alert">{write.error}</p>}
  </section>
}
function HistoricalReview({ job, writable, refresh }: { job: WorkflowNodeJob; writable: boolean; refresh: () => Promise<void> }) {
  const { port } = useRecovery()
  const context = useRecoveryRead(`review:${job.uuid}`, () => port.loadReview(job.uuid))
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [context.data?.review_version, writable])
  const write = useRecoveryWrite(`review:${job.uuid}`, async ({ body, key }) => {
    const result = await port.recoverJob(job.uuid, 'review', body, key) as { status: string; result?: { error?: string } }
    if (result.status === 'FAILED') throw new ServiceError({ code: 'REVIEW_REJECTED', status: 409, message: result.result?.error || '核对被拒绝' })
    return result.status === 'APPLIED'
  }, refresh)
  return <section><h3>历史人工动作结果核对 · {job.workflow_node_uuid}</h3>
    {context.error && <p role="alert">{context.error}</p>}
    {context.data?.result_reviewed ? <p>结果已核对</p> : <>
      <pre>{JSON.stringify({ result: context.data?.job.return_info, error: context.data?.job.error_info }, null, 2)}</pre>
      <label>核对说明<textarea value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
      <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />已现场核对动作停止及执行结果</label>
      <button type="button" disabled={!writable || write.pending || (!write.intent && (!confirmed || !reason.trim() || !context.data || context.loading || Boolean(context.error)))} onClick={() => void write.submit({ expected_review_version: context.data?.review_version, reason: reason.trim(), operator_confirmed: true })}>{write.intent ? '确认原核对请求' : '保存历史核对记录'}</button>
    </>}{write.error && <p role="alert">{write.error}</p>}
  </section>
}
function TransferSettlement({ job, runtime, writable, refresh }: { job: WorkflowNodeJob; runtime: WorkflowRuntimePort; writable: boolean; refresh: () => Promise<void> }) {
  const { port } = useRecovery()
  const catalog = useRecoveryRead(`settlement-sites:${job.uuid}`, () => runtime.getWorkflowMaterialSourceCatalog())
  const [siteId, setSiteId] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [catalog.data, writable])
  const expected = job.expected_change_set
  const sites = catalog.data?.sites.filter((site) => site.uuid === expected?.source_site_uuid || site.uuid === expected?.target_site_uuid) || []
  const site = sites.find((item) => item.uuid === siteId)
  const write = useRecoveryWrite(`settlement:${job.uuid}`, async ({ body, key }) => {
    await port.recoverJob(job.uuid, 'settle-material-transfer', body, key); return true
  }, refresh)
  return <section><h3>失败转运物料位置核验 · {job.workflow_node_uuid}</h3>
    <p>物料：{String(expected?.material_uuid || '缺少结算信息')}</p>
    {catalog.error && <p role="alert">{catalog.error}</p>}
    <label>现场实际库位<select value={siteId} onChange={(event) => { setSiteId(event.target.value); setConfirmed(false) }}><option value="">选择已核验的来源或目标库位</option>{sites.map((item) => <option key={item.uuid} value={item.uuid}>{item.name} · {item.uuid}</option>)}</select></label>
    <label>核验说明<textarea value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label className="workflow-recovery__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已现场核验该物料的实际位置</label>
    <button type="button" disabled={!writable || write.pending || (!write.intent && (!confirmed || !site || !reason.trim() || expected?.kind !== 'material_transfer' || !expected.material_uuid || catalog.loading || Boolean(catalog.error)))} onClick={() => void write.submit({ actual_change_set: { kind: 'material_transfer', material_uuid: expected?.material_uuid, target_owner_material_uuid: site?.mountMaterialUuid, target_site_uuid: site?.uuid }, reason: reason.trim() })}>{write.intent ? '确认原结算请求' : '保存实际位置并结算'}</button>
    {write.error && <p role="alert">{write.error}</p>}
  </section>
}

export function LockRelease({ task, lock, writable, loading, refresh }: { loading: boolean; task: string; lock: ExecutionLockSnapshot['locks'][number]; writable: boolean; refresh: () => Promise<void> }) {
  const { port } = useRecovery()
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [lock.claim_uuid, lock.fencing_token, lock.state, lock.can_release, writable])
  const write = useRecoveryWrite(`force-release:${task}:${lock.uuid}`, async ({ body }) => {
    // 该 OS 接口没有幂等键协议；重放原 Claim/Fence，后端识别 already_released。
    await port.forceReleaseLock(task, lock.uuid, body)
    return true
  }, refresh)
  return <fieldset><legend>{lock.lock_key} · {lock.state}</legend>
    {lock.release_block_reason && <p>{lock.release_block_reason}</p>}
    <p>从该锁发起释放会解除所属作业的整组执行占用；连续区间锁需使用任务级解锁。</p>
    <label>单锁释放原因<input value={reason} disabled={!writable || write.pending || Boolean(write.intent)} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
    <label><input type="checkbox" checked={confirmed} disabled={!writable || write.pending || Boolean(write.intent)} onChange={(event) => setConfirmed(event.target.checked)} />已确认设备停止且物理现场安全</label>
    <button type="button" disabled={!writable || loading || write.pending || (!write.intent && (!lock.can_release || !confirmed || !reason.trim()))} onClick={() => void write.submit({ expected_claim_uuid: lock.claim_uuid, expected_fencing_token: lock.fencing_token, reason: reason.trim(), physical_settlement_confirmed: true })}>{write.intent ? '确认原执行锁释放请求' : '释放此执行锁'}</button>
    {write.error && <p role="alert">{write.error}</p>}
  </fieldset>
}
