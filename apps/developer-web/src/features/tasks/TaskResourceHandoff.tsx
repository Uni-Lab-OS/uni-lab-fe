import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Checkbox, Input, Popconfirm, Tag } from 'antd'
import { TransportError, type TaskExecutionLocks } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import styles from './TaskHumanInteraction.module.scss'

const ABNORMAL_TERMINAL = new Set(['failed', 'canceled', 'timeout'])
const SCOPE_LABELS: Record<string, string> = {
  device: '设备',
  material: '物料',
  material_site: '物料位',
  resource: '资源',
}

export interface ResourceHandoffTask {
  readonly taskUuid: string
  readonly status: string
  readonly cleanupStatus: string
  readonly attentionReason?: string | null
  readonly updatedAt?: string | null
}

/** 异常终态且 OS 标记待人工收尾的任务才需要资源交接。 */
export function needsResourceHandoff(task: ResourceHandoffTask | null): boolean {
  return Boolean(
    task && ABNORMAL_TERMINAL.has(task.status) && task.cleanupStatus === 'requires_attention',
  )
}

/**
 * 资源交接：任务失败、取消或超时后，OS 不会自动放掉它持有的设备/物料锁（避免现场还没清理就被新任务使用），
 * 新任务会因“物料已被其他任务独占”等原因等待。操作员核对现场后，用 OS 任务命令 unlock_resources
 * 整组释放；是否释放成功以命令回执与随后重读的任务状态为准。
 */
export function TaskResourceHandoff({
  task,
  onChanged,
}: {
  task: ResourceHandoffTask | null
  onChanged: () => void
}) {
  const { backend } = useBackend()
  const capability = backend.getCapabilityStatus('workflow.unlockResources')
  const recovery = backend.core.executionRecovery
  const [locks, setLocks] = useState<TaskExecutionLocks | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{
    type: 'success' | 'error' | 'warning'
    message: string
  } | null>(null)
  // 结果不明确时保留原幂等键重发，避免重复命令。
  const pendingKey = useRef<string | null>(null)
  const visible = capability.available && needsResourceHandoff(task)
  const taskUuid = task?.taskUuid ?? null

  useEffect(() => {
    if (!visible || !taskUuid) return
    let live = true
    recovery.listTaskExecutionLocks(taskUuid).then(
      (next) => {
        if (!live) return
        setLocks(next)
        setLoadError(null)
      },
      (cause: unknown) =>
        live && setLoadError(cause instanceof Error ? cause.message : '读取任务执行锁失败'),
    )
    return () => {
      live = false
    }
  }, [recovery, taskUuid, visible, task?.updatedAt, task?.status])

  if (!visible || !task) return null

  const submit = async () => {
    pendingKey.current ??= `${task.taskUuid}:unlock_resources:${crypto.randomUUID()}`
    setBusy(true)
    setOutcome(null)
    try {
      const receipt = await recovery.unlockTaskResources(task.taskUuid, reason, pendingKey.current)
      pendingKey.current = null
      if (receipt.status === 'rejected') {
        setOutcome({ type: 'error', message: `OS 拒绝释放：${receipt.rejectReason}` })
      } else if (receipt.status === 'succeeded') {
        setOutcome({ type: 'success', message: 'OS 已释放该任务的资源占用，等待调度重新放行。' })
        setReason('')
        setConfirmed(false)
      } else {
        setOutcome({
          type: 'warning',
          message: `命令状态：${receipt.status || '未知'}，请以任务状态为准。`,
        })
      }
    } catch (cause) {
      const status = cause instanceof TransportError ? (cause.status ?? 0) : null
      const ambiguous = status !== null && (status === 0 || status === 408 || status >= 500)
      if (!ambiguous) pendingKey.current = null
      setOutcome({
        type: ambiguous ? 'warning' : 'error',
        message: ambiguous
          ? '提交结果不明确，可再次点击，将按原请求身份确认，不会重复释放。'
          : cause instanceof Error
            ? cause.message
            : '释放失败',
      })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const items = locks?.locks ?? []
  return (
    <section className={clsx(styles['panel'])} aria-label="资源交接">
      <div className={clsx(styles['panel-header'])}>
        <strong>资源交接</strong>
        <span className={clsx(styles['hint'])}>任务已结束，但仍占用设备/物料，后续任务会等待</span>
      </div>
      {loadError && (
        <Alert type="warning" showIcon message="读取执行锁失败" description={loadError} />
      )}
      {locks && (
        <p className={clsx(styles['hint'])}>
          当前执行锁 {items.length} 个
          {locks.activeDeviceTenancyCount > 0
            ? `，设备托管 ${locks.activeDeviceTenancyCount} 个`
            : ''}
          {items.length === 0 && locks.activeDeviceTenancyCount === 0
            ? '；其余物料预留由 OS 一并处理。'
            : '。'}
        </p>
      )}
      {items.map((lock) => (
        <div key={lock.uuid} className={clsx(styles['item'])}>
          <Tag>{SCOPE_LABELS[lock.scope] ?? (lock.scope || '资源')}</Tag>
          <code title={lock.lockKey}>{lock.lockKey}</code>
          <span className={clsx(styles['item-meta'])}>
            锁状态 {lock.state} · 作业 {lock.jobStatus}
          </span>
        </div>
      ))}
      <label className={clsx(styles['field'])}>
        <span>现场处置说明（必填，写入 OS）</span>
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={500}
          value={reason}
          disabled={busy}
          placeholder="例如：已人工取下料盒中的板，机械臂已回原点"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Checkbox
        checked={confirmed}
        disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)}
      >
        我已确认相关设备已停止、现场安全，资源可以交给后续任务
      </Checkbox>
      {outcome && <Alert type={outcome.type} showIcon message={outcome.message} />}
      <div className={clsx(styles['actions'])}>
        <Popconfirm
          title="释放后，后续任务可以使用这些设备和物料。请确认现场已清理。"
          okText="确认释放"
          cancelText="再核对"
          disabled={!reason.trim() || !confirmed}
          onConfirm={() => void submit()}
        >
          <Button danger loading={busy} disabled={!reason.trim() || !confirmed}>
            释放该任务的资源
          </Button>
        </Popconfirm>
      </div>
    </section>
  )
}
