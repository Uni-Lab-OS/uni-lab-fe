import { useEffect, useRef, useState } from 'react'
import type { WorkflowExecutionLockPort } from '@unilab/services'
import type { ManagedDevice } from './deviceCatalog'
import type { DeviceTaskLockOwner } from './deviceTaskLocks'
import { deviceClass } from './deviceStyles'
import styles from './DeviceTaskUnlockDialog.module.scss'

export interface TaskUnlockResult {
  taskUuid: string
  state: 'success' | 'pending' | 'error'
  message: string
}

/** 每个任务一条幂等命令；成功仍需读取权威锁事实，部分失败保留逐任务结果。 */
export async function unlockSelectedTasks(
  port: WorkflowExecutionLockPort,
  owners: readonly DeviceTaskLockOwner[],
  reason: string,
  keys: ReadonlyMap<string, string>
): Promise<TaskUnlockResult[]> {
  const results: TaskUnlockResult[] = []
  for (const owner of owners) {
    try {
      if (!owner.canUnlock) throw new Error('任务尚未进入失败、取消或超时终态')
      const command = await port.unlockResources(owner.taskUuid, {
        idempotency_key: keys.get(owner.taskUuid)!,
        reason,
        physical_safe_confirmed: true
      })
      if (command.status === 'rejected') {
        const reason = typeof command.result?.reason === 'string'
          ? command.result.reason
          : '请核对任务与现场状态'
        throw new Error('服务端拒绝解锁：' + reason)
      }
      const current = await port.list(owner.taskUuid)
      const released = command.status === 'succeeded'
        && current.locks.length === 0
        && current.active_device_tenancy_count === 0
      results.push({
        taskUuid: owner.taskUuid,
        state: released ? 'success' : 'pending',
        message: released
          ? '已确认该任务资源锁全部释放'
          : '请求已受理，资源锁尚未确认全部释放，请刷新核对'
      })
    } catch (error) {
      results.push({
        taskUuid: owner.taskUuid,
        state: 'error',
        message: error instanceof Error ? error.message : '解锁结果未知，请刷新核对'
      })
    }
  }
  return results
}

const TASK_STATUS: Record<string, string> = {
  pending: '等待中', running: '运行中', canceling: '取消中',
  succeeded: '已成功', failed: '已失败', canceled: '已取消', timeout: '已超时'
}

/** 原生模态框提供焦点限制、Escape 和关闭后焦点恢复；命令期间禁止重复提交。 */
export function DeviceTaskUnlockDialog({
  owners,
  devices,
  port,
  onClose,
  onRefresh
}: {
  owners: readonly DeviceTaskLockOwner[]
  devices: readonly ManagedDevice[]
  port: WorkflowExecutionLockPort
  onClose: () => void
  onRefresh: () => Promise<void>
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [results, setResults] = useState<TaskUnlockResult[] | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const keys = useRef(new Map<string, string>())
  // 冻结确认范围，后台刷新不能在用户确认后静默换成另一组任务。
  const [scope] = useState(owners)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      previous?.focus()
    }
  }, [])

  const eligible = scope.filter(owner => owner.canUnlock)
  const chosen = scope.filter(owner => selected.has(owner.taskUuid))
  const frozen = pending || results !== null
  const toggle = (owner: DeviceTaskLockOwner) => {
    setConfirmed(false)
    setSelected(current => {
      const next = new Set(current)
      if (next.has(owner.taskUuid)) next.delete(owner.taskUuid)
      else next.add(owner.taskUuid)
      return next
    })
  }
  const submit = async () => {
    if (submitting.current || !confirmed || !reason.trim() || !chosen.length) return
    submitting.current = true
    setPending(true)
    for (const owner of chosen) {
      if (!keys.current.has(owner.taskUuid)) {
        keys.current.set(owner.taskUuid, crypto.randomUUID())
      }
    }
    try {
      setResults(await unlockSelectedTasks(port, chosen, reason.trim(), keys.current))
      await onRefresh()
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '刷新失败，请重新读取锁状态')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="task-unlock-title"
      aria-describedby="task-unlock-scope"
      onCancel={event => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <header>
        <h2 id="task-unlock-title">解锁仪器</h2>
        <button type="button" disabled={pending} onClick={onClose} aria-label="关闭解锁对话框">×</button>
      </header>
      <div className={styles.body}>
        <p id="task-unlock-scope">
          选择仪器会同时选择其所属任务。确认后释放这些任务的全部设备、物料及库位资源锁，
          不改变任务结果或物料位置。
        </p>
        <div className={styles.selectActions}>
          <button
            type="button"
            disabled={frozen || !eligible.length}
            onClick={() => {
              setSelected(new Set(eligible.map(owner => owner.taskUuid)))
              setConfirmed(false)
            }}
          >全选</button>
          <button
            type="button"
            disabled={frozen || !selected.size}
            onClick={() => { setSelected(new Set()); setConfirmed(false) }}
          >取消全选</button>
        </div>
        {!scope.length ? <p>当前没有任务资源锁。</p> : null}
        {scope.map(owner => (
          <fieldset
            key={owner.taskUuid}
            disabled={frozen || !owner.canUnlock}
            className={styles.owner}
          >
            <legend>{owner.description}</legend>
            <p>任务 <code>{owner.taskUuid}</code> · {TASK_STATUS[owner.status] ?? '状态待核对'}</p>
            {owner.deviceIds.length ? owner.deviceIds.map(id => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={selected.has(owner.taskUuid)}
                  onChange={() => toggle(owner)}
                />
                {devices.find(device => device.id === id)?.displayName ?? id}
              </label>
            )) : (
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(owner.taskUuid)}
                  onChange={() => toggle(owner)}
                />
                选择此任务（设备身份未提供）
              </label>
            )}
            <small>
              {owner.locks.locks.length} 项执行锁 · {owner.locks.active_device_tenancy_count} 项设备托管。
              整组释放此任务的所有资源。
            </small>
            {!owner.canUnlock ? <p>任务仍在运行或未进入可解锁的异常终态，请先处理任务。</p> : null}
          </fieldset>
        ))}
        <label className={styles.reason}>
          现场处置说明
          <textarea
            value={reason}
            disabled={frozen}
            onChange={event => setReason(event.target.value)}
            rows={2}
          />
        </label>
        <label className={styles.confirmation}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={frozen || !chosen.length}
            onChange={event => setConfirmed(event.target.checked)}
          />
          我已确认所选任务涉及的全部设备已停止，物料与现场安全，并同意整组释放资源锁。
        </label>
        <p>已选择 {chosen.length} 个任务，涉及 {new Set(chosen.flatMap(owner => owner.deviceIds)).size} 台已知仪器。</p>
        {results ? (
          <ul aria-live="polite">
            {results.map(result => (
              <li key={result.taskUuid} role={result.state === 'error' ? 'alert' : 'status'}>
                <code>{result.taskUuid}</code>：{result.message}
              </li>
            ))}
          </ul>
        ) : null}
        {refreshError ? <p role="alert">锁状态刷新失败：{refreshError}</p> : null}
      </div>
      <footer>
        <button type="button" disabled={pending} onClick={onClose}>{results ? '关闭' : '取消'}</button>
        {!results ? (
          <button
            type="button"
            className={deviceClass('edge-device__unlock-confirm')}
            disabled={pending || !confirmed || !reason.trim() || !chosen.length}
            onClick={() => void submit()}
          >{pending ? '正在解锁…' : '确认解锁所选任务'}</button>
        ) : null}
      </footer>
    </dialog>
  )
}
