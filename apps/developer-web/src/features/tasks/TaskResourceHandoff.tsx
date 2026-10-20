import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Checkbox, Input, Modal, Popconfirm, Tag } from 'antd'
import { TransportError, type TaskExecutionLocks } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { attentionLabel } from './taskStatusPresentation'
import styles from './TaskHumanInteraction.module.scss'

const ABNORMAL_TERMINAL = new Set(['failed', 'canceled', 'timeout'])
/** OS 在这些清理阶段会自行结算并释放占用（确定停止且无需交接）。 */
const SETTLING_CLEANUP = new Set(['pending', 'required', 'canceling'])
/** 已派发、执行中或取消待设备确认：OS 在它们结束前拒绝任何人工释放。 */
const IN_FLIGHT_JOB_STATUSES = new Set(['dispatched', 'running', 'cancel_requested'])
/** OS 物理结算策略中的“实际用量待对账”；有它时 unlock_resources 必定被拒绝。 */
const QUANTITY_RECONCILIATION_REQUIRED = 'workflow_quantity_reconciliation_required'
const SCOPE_LABELS: Record<string, string> = {
  device: '设备',
  material: '物料',
  material_site: '库位',
  resource: '资源',
}
const STATUS_LABELS: Record<string, string> = {
  canceled: '已取消',
  failed: '已失败',
  timeout: '已超时',
  succeeded: '已完成',
}

export interface ResourceHandoffTask {
  readonly taskUuid: string
  readonly status: string
  readonly cleanupStatus: string
  readonly attentionReason?: string | null
  readonly updatedAt?: string | null
}

/** OS 作业事实中判断能否释放所需的最小字段（时间线投影即可提供）。 */
export interface ResourceHandoffJob {
  readonly status: string
  readonly uncertaintyReason?: string | null
}

/** 异常终态且 OS 标记待人工收尾的任务才需要资源交接。 */
export function needsResourceHandoff(task: ResourceHandoffTask | null): boolean {
  return Boolean(
    task && ABNORMAL_TERMINAL.has(task.status) && task.cleanupStatus === 'requires_attention',
  )
}

/**
 * 停止任务后的占用阶段，全部来自 OS 事实：
 * - awaiting_terminal：OS 还没确认终态（如“取消中”，设备动作在收尾），不能释放任何资源；
 * - settling：已是终态，OS 正在按 cleanup_status 自行结算；
 * - released：OS 已结算（settled/none）或任务已正常完成，不再阻塞后续任务；
 * - needs_operator：终态但 OS 保留占用（cleanup_status=requires_attention），只能由操作员
 *   核对现场后用 unlock_resources 整组释放。
 *
 * 不存在“前端自动释放”的阶段：OS 只有在无法证明现场安全时才保留占用（取消时物料仍在
 * 交接区间内、设备托管未交还、结果未知或用量待对账），能证明安全的情况它已自行释放；
 * unlock_resources 要求 meta_data.confirmed_physical_safe=true，这是操作员的现场声明，
 * 前端不能代为声明。
 */
export type StoppedTaskResourcePhase =
  | 'awaiting_terminal'
  | 'settling'
  | 'released'
  | 'needs_operator'

export interface StoppedTaskResources {
  readonly phase: StoppedTaskResourcePhase
  /** 已派发、执行中或取消待确认的作业数；大于 0 时 OS 拒绝释放。 */
  readonly inFlightJobs: number
  /** 结果未知的作业数；释放会把它们按操作员的现场确认结算（OS 清除不确定标记）。 */
  readonly uncertainJobs: number
  /** 有实际用量待对账的作业时 OS 拒绝整组释放。 */
  readonly quantityPending: boolean
}

export function assessStoppedTaskResources(
  task: ResourceHandoffTask | null,
  jobs: readonly ResourceHandoffJob[],
): StoppedTaskResources {
  const inFlightJobs = jobs.filter((job) => IN_FLIGHT_JOB_STATUSES.has(job.status)).length
  const uncertainJobs = jobs.filter(
    (job) => Boolean(job.uncertaintyReason) || job.status === 'execution_unknown',
  ).length
  const quantityPending = jobs.some(
    (job) => job.uncertaintyReason === QUANTITY_RECONCILIATION_REQUIRED,
  )
  const facts = { inFlightJobs, uncertainJobs, quantityPending }
  if (task?.status === 'succeeded') return { phase: 'released', ...facts }
  if (!task || !ABNORMAL_TERMINAL.has(task.status)) return { phase: 'awaiting_terminal', ...facts }
  if (task.cleanupStatus === 'requires_attention') return { phase: 'needs_operator', ...facts }
  if (SETTLING_CLEANUP.has(task.cleanupStatus)) return { phase: 'settling', ...facts }
  return { phase: 'released', ...facts }
}

/** 释放确认中列出的内容：执行锁按范围计数、设备托管，以及 OS 一并处理的预留。 */
export function describeResourceRelease(locks: TaskExecutionLocks | null): string {
  const parts: string[] = []
  if (locks) {
    const byScope = new Map<string, number>()
    for (const lock of locks.locks) {
      const label = SCOPE_LABELS[lock.scope] ?? (lock.scope || '资源')
      byScope.set(label, (byScope.get(label) ?? 0) + 1)
    }
    if (locks.locks.length > 0) {
      const scopes = [...byScope].map(([label, count]) => `${label} ${count}`).join('、')
      parts.push(`${locks.locks.length} 个执行锁（${scopes}）`)
    }
    if (locks.activeDeviceTenancyCount > 0)
      parts.push(`${locks.activeDeviceTenancyCount} 个设备托管`)
  }
  parts.push('该任务的物料预留、数量预留与调度许可')
  return parts.join('，')
}

/**
 * 资源交接：任务失败、取消或超时后，OS 不会自动放掉它持有的设备/物料锁（避免现场还没清理就被新任务使用），
 * 新任务会因“物料已被其他任务独占”等原因等待。操作员核对现场后，用 OS 任务命令 unlock_resources
 * 整组释放；是否释放成功以命令回执与随后重读的任务状态为准。
 *
 * 操作员在本页停止任务后（stopRequested），这里跟进停止的收尾：OS 确认终态前只显示进度；
 * 终态后若 OS 仍保留占用，弹出确认框列出将要释放的内容，由操作员核对现场后释放。
 */
export function TaskResourceHandoff({
  task,
  jobs = [],
  stopRequested = false,
  onChanged,
}: {
  task: ResourceHandoffTask | null
  jobs?: readonly ResourceHandoffJob[]
  stopRequested?: boolean
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
  const [promptOpen, setPromptOpen] = useState(false)
  // 每个任务只自动弹出一次；关闭后仍可在页面内处理。
  const prompted = useRef<string | null>(null)
  // 结果不明确时保留原幂等键重发，避免重复命令。
  const pendingKey = useRef<string | null>(null)
  const visible = capability.available && needsResourceHandoff(task)
  const taskUuid = task?.taskUuid ?? null
  const assessment = assessStoppedTaskResources(task, jobs)

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

  useEffect(() => {
    if (!visible || !stopRequested || !taskUuid || prompted.current === taskUuid) return
    prompted.current = taskUuid
    setPromptOpen(true)
  }, [stopRequested, taskUuid, visible])

  if (!task) return null
  if (!visible) {
    return stopRequested ? <StopFollowUp task={task} assessment={assessment} /> : null
  }

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
        setPromptOpen(false)
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
  const blocked =
    assessment.inFlightJobs > 0
      ? `仍有 ${assessment.inFlightJobs} 个设备动作未结束（已派发、执行中或取消待设备确认），OS 在它们结束前不允许释放。`
      : assessment.quantityPending
        ? '该任务仍有实际用量待对账，OS 不允许人工整组释放；请先完成用量对账。'
        : null
  const releaseSummary = describeResourceRelease(locks)
  const ready = !blocked && Boolean(reason.trim()) && confirmed
  const lockList = (
    <>
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
    </>
  )
  const form = (
    <>
      {blocked && <Alert type="warning" showIcon message="暂不能释放" description={blocked} />}
      {assessment.uncertainJobs > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`该任务有 ${assessment.uncertainJobs} 个动作结果未知`}
          description="释放会按你的现场确认结算这些动作（OS 清除“结果未知”标记）。请先到现场核对设备确实已停止、动作未执行或已安全停止。"
        />
      )}
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
        {assessment.uncertainJobs > 0
          ? '我已到现场核对：相关设备已停止、结果未知的动作未执行或已安全停止，现场安全，资源可以交给后续任务'
          : '我已确认相关设备已停止、现场安全，资源可以交给后续任务'}
      </Checkbox>
      {outcome && <Alert type={outcome.type} showIcon message={outcome.message} />}
      <div className={clsx(styles['actions'])}>
        <Popconfirm
          title={`将整组释放：${releaseSummary}。释放后后续任务可以使用这些设备和物料，请确认现场已清理。`}
          okText="确认释放"
          cancelText="再核对"
          disabled={!ready}
          onConfirm={() => void submit()}
        >
          <Button danger loading={busy} disabled={!ready}>
            释放该任务的资源
          </Button>
        </Popconfirm>
      </div>
    </>
  )
  const attention = task.attentionReason ? attentionLabel(task.attentionReason) : null
  return (
    <>
      <section className={clsx(styles['panel'])} aria-label="资源交接">
        <div className={clsx(styles['panel-header'])}>
          <strong>资源交接</strong>
          <span className={clsx(styles['hint'])}>
            任务已结束，但仍占用设备/物料，后续任务会等待
            {attention ? `（OS 原因：${attention}）` : ''}
          </span>
        </div>
        {lockList}
        {promptOpen ? (
          <p className={clsx(styles['hint'])}>请在弹出的确认框中核对现场并释放。</p>
        ) : (
          form
        )}
      </section>
      <Modal
        open={promptOpen}
        title="任务已停止，但仍占用设备/物料"
        footer={null}
        maskClosable={false}
        onCancel={() => !busy && setPromptOpen(false)}
      >
        <div className={clsx(styles['dialog-form'])}>
          <p className={clsx(styles['hint'])}>
            OS 已确认任务{STATUS_LABELS[task.status] ?? task.status}，但保留了它的占用
            {attention ? `（${attention}）` : ''}，避免现场未清理就被新任务使用；不释放的话，
            后续提交会一直等待这些设备和物料。核对现场后将整组释放：{releaseSummary}。
          </p>
          {lockList}
          {form}
        </div>
      </Modal>
    </>
  )
}

/** 操作员停止任务后、OS 未保留需人工交接的占用时，如实显示收尾进度。 */
function StopFollowUp({
  task,
  assessment,
}: {
  task: ResourceHandoffTask
  assessment: StoppedTaskResources
}) {
  const statusLabel = STATUS_LABELS[task.status] ?? task.status
  const [type, message] =
    assessment.phase === 'awaiting_terminal'
      ? ([
          'info',
          `已请求停止，等待 OS 确认任务终态（当前：${task.status || '未知'}）。确认前不会释放任何资源${
            assessment.inFlightJobs > 0 ? `；${assessment.inFlightJobs} 个设备动作仍在收尾` : ''
          }。`,
        ] as const)
      : assessment.phase === 'settling'
        ? (['info', `任务${statusLabel}，OS 正在结算该任务的占用。`] as const)
        : assessment.phase === 'needs_operator'
          ? ([
              'warning',
              `任务${statusLabel}，但 OS 仍保留它的设备/物料占用${
                task.attentionReason ? `（${attentionLabel(task.attentionReason)}）` : ''
              }，后续任务会等待。当前后端未声明 workflow.unlockResources 能力，请按现场流程处理。`,
            ] as const)
          : ([
              'success',
              task.status === 'succeeded'
                ? '任务在停止生效前已正常完成，OS 已按正常流程释放占用。'
                : `任务${statusLabel}，OS 已释放该任务的全部占用，后续任务不会被它阻塞。`,
            ] as const)
  return (
    <section className={clsx(styles['panel'])} aria-label="停止后的资源状态">
      <Alert type={type} showIcon role="status" message={message} />
    </section>
  )
}
