import { useState } from 'react'
import type { DeviceExecutionOccupancy, ExecutionLockSnapshot, WorkflowRecoveryPort } from '@unilab/services'
import { deviceClass } from './deviceStyles'

type ExecutionLock = ExecutionLockSnapshot['locks'][number]

/** 从权威快照确认设备占用仍属于原任务和租约，不猜测其他锁。 */
export async function loadDeviceExecutionLock(
  port: WorkflowRecoveryPort,
  occupancy: DeviceExecutionOccupancy
): Promise<ExecutionLock> {
  if (!occupancy.workflowTaskUuid || !occupancy.leaseUuid) {
    throw new Error('设备占用缺少任务或锁标识，请刷新设备状态')
  }
  const snapshot = await port.loadLocks(occupancy.workflowTaskUuid)
  if (snapshot.workflow_task_uuid !== occupancy.workflowTaskUuid) {
    throw new Error('锁所属任务已变化，请刷新设备状态')
  }
  const lock = snapshot.locks.find(item => item.uuid === occupancy.leaseUuid)
  if (!lock) throw new Error('此锁已释放或已变化，请刷新设备状态')
  return lock
}

/** 提交用户核对过的持有者与版本，后端负责拒绝过期或不可释放的锁。 */
export async function releaseDeviceExecutionLock(
  port: WorkflowRecoveryPort,
  taskUuid: string,
  lock: ExecutionLock,
  reason: string,
  confirmed: boolean
): Promise<void> {
  if (!confirmed || !reason.trim()) throw new Error('请填写解锁原因并确认现场状态')
  if (!lock.can_release) throw new Error(lock.release_block_reason || '当前锁暂不可释放')
  await port.forceReleaseLock(taskUuid, lock.uuid, {
    expected_claim_uuid: lock.claim_uuid,
    expected_fencing_token: lock.fencing_token,
    reason: reason.trim(),
    physical_settlement_confirmed: true
  })
}

/** 设备页直接处置调度执行锁；保留后端的释放资格和并发校验。 */
export function DeviceExecutionUnlock({ occupancy, port, onRefresh }: {
  occupancy: DeviceExecutionOccupancy
  port: WorkflowRecoveryPort
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [lock, setLock] = useState<ExecutionLock | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inspect = async (): Promise<void> => {
    setOpen(true)
    setBusy(true)
    setLock(null)
    setConfirmed(false)
    setReason('')
    setError('')
    try { setLock(await loadDeviceExecutionLock(port, occupancy)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取设备锁失败') }
    finally { setBusy(false) }
  }
  const release = async (): Promise<void> => {
    if (!lock || !occupancy.workflowTaskUuid || busy) return
    setBusy(true)
    setError('')
    try {
      await releaseDeviceExecutionLock(port, occupancy.workflowTaskUuid, lock, reason, confirmed)
      setOpen(false)
      setMessage('后端已确认释放执行锁，正在刷新设备状态')
      try { await onRefresh() }
      catch { setError('执行锁已释放，但设备状态刷新失败，请重新刷新') }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设备解锁失败')
      // 失败后重新核对，不能用旧的持有者信息再次发起释放。
      setLock(null)
      setConfirmed(false)
    } finally { setBusy(false) }
  }
  return <>
    <button type="button" className={deviceClass('edge-device__unlock-button')}
      disabled={busy} onClick={() => void inspect()}>解锁设备</button>
    {message && <p role="status">{message}</p>}
    {!open && error && <p role="alert">{error}</p>}
    {open && <div className={deviceClass('edge-device__unlock-layer')}>
      <section className={deviceClass('edge-device__unlock-dialog')} role="dialog"
        aria-modal="true" aria-label="解锁设备执行占用">
        <header><h2>解锁设备执行占用</h2></header>
        <div className={deviceClass('edge-device__unlock-dialog-body')}>
          <p>此操作释放该作业持有的设备、物料和库位执行锁，不会停止正在运行的设备。</p>
          <p>作业：<code>{occupancy.workflowNodeJobUuid}</code></p>
          {busy && <p role="status">正在处理…</p>}
          {lock && !lock.can_release && <p role="alert">{lock.release_block_reason || '当前锁暂不可释放，请先处理关联任务'}</p>}
          {error && <p role="alert">{error}</p>}
          {lock?.can_release && <>
            <label>解锁原因<textarea value={reason} maxLength={500} disabled={busy}
              onChange={event => setReason(event.target.value)} /></label>
            <label className={deviceClass('edge-device__unlock-confirmation')}>
              <input type="checkbox" checked={confirmed} disabled={busy}
                onChange={event => setConfirmed(event.target.checked)} />
              我已确认设备停止，相关物料与库位的现场状态已核对完成。
            </label>
          </>}
        </div>
        <footer>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>关闭</button>
          <button type="button" disabled={busy} onClick={() => void inspect()}>刷新锁状态</button>
          <button type="button" disabled={busy || !lock?.can_release || !confirmed || !reason.trim()}
            onClick={() => void release()}>确认解锁</button>
        </footer>
      </section>
    </div>}
  </>
}
