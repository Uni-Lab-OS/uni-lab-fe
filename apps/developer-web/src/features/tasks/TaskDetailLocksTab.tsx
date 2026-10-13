import { clsx } from 'clsx'
import { useState } from 'react'
import { Button, Checkbox, Input, message } from 'antd'
import type { WorkflowTaskExecutionLock } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import {
  buildTaskResourceUnlockCommand,
  taskResourceUnlockReadiness,
} from './taskLockPresentation'

const PHYSICAL_SAFETY_CONFIRMATION =
  '我已现场确认此 Task 涉及的设备均已停止，物理现场安全，物料状态已核实，且不存在未上报的在途动作。'

type Outcome =
  | { kind: 'none' }
  /** 命令已接受但尚未确认生效 —— 不能当成成功。 */
  | { kind: 'pending' }
  | { kind: 'rejected' }
  | { kind: 'done'; released: number }

/**
 * 任务级整组解锁（对齐 Uni-Lab OS 内置前端的执行锁面板）。
 *
 * 它和任务详情投影里的锁事实**不是同一份数据**：那份常常是空的，而整组解锁必须看
 * 任务真正持有的锁与设备占用，所以这里单独读专用端点。
 *
 * `unlock_resources` 是**调试场景**命令：它**不在 AGENTS.md 的生产共享 Runtime 命令
 * 白名单内**（白名单只有 step / pause / resume / cancel）。不要据此扩大生产命令面。
 */
export function LocksTab({ taskUuid }: { taskUuid: string | null }) {
  const { backend } = useBackend()
  const query = useBackendQuery(
    `task-execution-locks:${taskUuid ?? 'none'}`,
    async (client) =>
      taskUuid ? client.core.executionRead.getTaskExecutionLocks(taskUuid) : null,
    { live: true },
  )
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' })
  // 幂等键在"同一次意图"里复用：说明或勾选变化都算新意图，避免重复下发命令。
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const snapshot = query.data ?? null
  const readiness = taskResourceUnlockReadiness({
    taskStatus: snapshot?.taskStatus ?? null,
    lockCount: snapshot?.locks.length ?? 0,
    activeDeviceTenancyCount: snapshot?.activeDeviceTenancyCount ?? 0,
  })
  const canSubmit =
    readiness.kind === 'ready' && reason.trim().length > 0 && confirmed && !pending

  const submit = async () => {
    if (!taskUuid || !canSubmit) return
    setPending(true)
    try {
      const key = idempotencyKey || `studio-${taskUuid}-unlock-${Date.now()}`
      setIdempotencyKey(key)
      const receipt = await backend.core.executionControl.sendTaskCommand(taskUuid, {
        ...buildTaskResourceUnlockCommand({ idempotencyKey: key, description: reason.trim() }),
      })
      if (receipt.lifecycle === 'rejected') {
        setOutcome({ kind: 'rejected' })
        return
      }
      if (receipt.lifecycle !== 'applied') {
        // HTTP 接受 / 命令回执都不等于资源已释放：如实停在"处理中"。
        setOutcome({ kind: 'pending' })
        return
      }
      const released = snapshot?.locks.length ?? 0
      setOutcome({ kind: 'done', released })
      setReason('')
      setConfirmed(false)
      setIdempotencyKey('')
      query.reload()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '整组解锁失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-lock-guard'],
          readiness.kind === 'ready' ? taskDetailInspectorStyles['is-ready'] : '',
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
          <DebugIcon name={readiness.kind === 'ready' ? 'unlock' : 'shield-alert'} size={18} />
          <div>
            <strong>
              {readiness.kind === 'ready' ? '可整组解锁' : '当前不能整组解锁'}
            </strong>
            {/* 门禁不通过时必须说出为什么，不能只把按钮禁用。 */}
            {readiness.kind !== 'ready' && <p>{readiness.reason}</p>}
          </div>
        </div>
      </div>

      <div className={clsx(taskDetailInspectorStyles['debug-lock-group'])}>
        {!snapshot || snapshot.locks.length === 0 ? (
          <div
            className={clsx(
              taskDetailInspectorStyles['debug-empty-state'],
              taskDetailInspectorStyles['debug-lock-empty-state'],
            )}
          >
            这个任务当前没有持有执行锁。
          </div>
        ) : (
          snapshot.locks.map((lock) => <LockRow key={lock.uuid} lock={lock} />)
        )}
      </div>

      {snapshot && snapshot.activeDeviceTenancyCount > 0 && (
        <p className={clsx(taskDetailInspectorStyles['debug-lock-guard'])}>
          另有 {snapshot.activeDeviceTenancyCount} 项设备占用会一并解除。
        </p>
      )}

      {readiness.kind === 'ready' && (
        <div className={clsx(taskDetailInspectorStyles['debug-lock-actions'])}>
          <label>
            <span>
              解锁说明<em>必填</em>
            </span>
            <Input.TextArea
              rows={3}
              value={reason}
              disabled={pending}
              placeholder="说明设备已停止、无在途动作和现场物料核验情况。"
              onChange={(event) => {
                setReason(event.target.value)
                setIdempotencyKey('')
              }}
            />
          </label>
          <Checkbox
            checked={confirmed}
            disabled={pending}
            onChange={(event) => {
              setConfirmed(event.target.checked)
              setIdempotencyKey('')
            }}
          >
            {PHYSICAL_SAFETY_CONFIRMATION}
          </Checkbox>
          <Button
            danger
            size="small"
            loading={pending}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {readiness.label}
          </Button>
        </div>
      )}

      {outcome.kind === 'pending' && (
        <p className={clsx(taskDetailInspectorStyles['debug-lock-guard'])} role="status">
          解锁命令仍在处理中，尚未确认资源释放。可以重新读取锁状态，看资源是否已经释放。
          <Button size="small" type="link" onClick={() => query.reload()}>
            重新读取锁状态
          </Button>
        </p>
      )}
      {outcome.kind === 'rejected' && (
        <p className={clsx(taskDetailInspectorStyles['debug-lock-guard'])} role="alert">
          OS 拒绝了这次整组解锁。常见原因是任务不是异常终态（只有失败 / 已取消 / 超时才能整组解锁）；
          请以刷新后的任务与锁状态为准。
        </p>
      )}
      {outcome.kind === 'done' && (
        <p className={clsx(taskDetailInspectorStyles['debug-lock-guard'])} role="status">
          已解除整组锁{outcome.released > 0 ? `（提交时持有 ${outcome.released} 把）` : ''}
          ；锁状态以刷新后的列表为准。
        </p>
      )}

      <Button size="small" type="text" onClick={() => query.reload()}>
        重新读取锁状态
      </Button>
    </div>
  )
}

function LockRow({ lock }: { lock: WorkflowTaskExecutionLock }) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-lock-row'])}>
      <span>
        <strong>{lock.lockKey || lock.uuid}</strong>
        <small>
          {lock.scope || '未知范围'}
          {lock.workflowNodeJobUuid ? ` · 节点 ${lock.workflowNodeJobUuid.slice(0, 8)}` : ''}
        </small>
        {/* OS 给出的「还差什么才能解锁」，比状态名更能行动。 */}
        {lock.canRelease !== true && lock.releaseBlockReason && (
          <small>{lock.releaseBlockReason}</small>
        )}
      </span>
      <span
        className={clsx(
          lock.canRelease
            ? taskDetailInspectorStyles['lock-ready']
            : taskDetailInspectorStyles['lock-held'],
        )}
      >
        <span className={clsx(taskDetailStyles['debug-state-dot'])} />
        {lock.canRelease ? '可释放' : lock.state || '未知'}
      </span>
    </div>
  )
}
