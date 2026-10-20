import { useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Checkbox, Input, Popconfirm } from 'antd'
import type { StationError, WorkflowNodeJobDetail } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useStationHandling, type StationHandlingState } from '../station/useStationHandling'
import { RETRYABLE_JOB_STATUSES, retryBlockReason } from './actionRetryGuard'
import styles from './TaskHumanInteraction.module.scss'

const TERMINAL_TASK_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'timeout'])

/** 已被后续尝试替代的历史 attempt（OS current_attempt=0）。 */
function isReplacedAttempt(job: WorkflowNodeJobDetail): boolean {
  const flag = job.raw.current_attempt
  return flag === 0 || flag === false
}

/** 只有失败、超时、结果未知或已取消（可能是结果未知收尾后）的作业才可能有待处理的 OS 错误决定。 */
function isRetryCandidate(job: WorkflowNodeJobDetail | null): job is WorkflowNodeJobDetail {
  return Boolean(
    job &&
      !isReplacedAttempt(job) &&
      (job.uncertaintyReason || RETRYABLE_JOB_STATUSES.has(job.status)),
  )
}

/**
 * 任务详情中“重新执行该动作”：设备动作出错后 OS 为该作业打开工站错误决定并暂停调度，
 * 这里对同一决定提交 OS 的 retry_current_node 选项（按原参数新建一次尝试，原失败记录保留），
 * 与页面顶部工站错误处置对话框中的选项是同一 OS 操作。状态以提交后重读的 OS 快照为准。
 */
export function FailedActionRetry({
  job,
  actionLabel,
  device,
  taskStatus,
  onChanged,
}: {
  job: WorkflowNodeJobDetail | null
  actionLabel: string
  device?: string | null
  taskStatus?: string | null
  onChanged?: () => void
}) {
  if (!isRetryCandidate(job)) return null
  return (
    <FailedActionRetryPanel
      key={job.jobUuid}
      job={job}
      actionLabel={actionLabel}
      device={device ?? null}
      taskStatus={taskStatus ?? null}
      onChanged={onChanged}
    />
  )
}

function FailedActionRetryPanel({
  job,
  actionLabel,
  device,
  taskStatus,
  onChanged,
}: {
  job: WorkflowNodeJobDetail
  actionLabel: string
  device: string | null
  taskStatus: string | null
  onChanged?: () => void
}) {
  const state = useStationHandling()
  const [reason, setReason] = useState('')
  const [resume, setResume] = useState(false)
  if (!state.available) return null
  const snapshot = state.snapshot
  if (!snapshot) {
    return state.readError ? (
      <section className={clsx(styles['retry'])} aria-label="重新执行该动作">
        <Alert
          type="warning"
          showIcon
          message="读取工站错误处置状态失败，暂不能重新执行"
          description={state.readError}
        />
      </section>
    ) : null
  }
  const decision = snapshot.errors.find((error) => error.sourceJobUuid === job.jobUuid) ?? null
  if (!decision) {
    // 结果未知或已取消的作业没有待处理决定时，不需要提示；失败作业说明为何不能在此重新执行。
    if (job.uncertaintyReason || job.status === 'canceled') return null
    return (
      <section className={clsx(styles['retry'])} aria-label="重新执行该动作">
        <p className={clsx(styles['hint'])}>
          {taskStatus && TERMINAL_TASK_STATUSES.has(taskStatus)
            ? '任务已结束，OS 不支持对已结束任务重新执行单个动作；如需重做请重新提交任务。'
            : 'OS 没有为该作业保留待处理的错误决定（可能已处理），不能在此重新执行。'}
        </p>
      </section>
    )
  }
  return (
    <RetryDecision
      job={job}
      decision={decision}
      actionLabel={actionLabel}
      device={device}
      state={state}
      reason={reason}
      setReason={setReason}
      resume={resume}
      setResume={setResume}
      onChanged={onChanged}
    />
  )
}

function RetryDecision({
  job,
  decision,
  actionLabel,
  device,
  state,
  reason,
  setReason,
  resume,
  setResume,
  onChanged,
}: {
  job: WorkflowNodeJobDetail
  decision: StationError
  actionLabel: string
  device: string | null
  state: StationHandlingState
  reason: string
  setReason: (value: string) => void
  resume: boolean
  setResume: (value: boolean) => void
  onChanged?: () => void
}) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const snapshot = state.snapshot!
  const session = snapshot.activeSession
  const blocked = retryBlockReason(job)
  const offered = decision.options.some((option) => option.id === 'retry_current_node')
  const paused = snapshot.mode === 'PAUSED'
  const writable = !state.readError && !state.submitting && !state.unconfirmed
  const stageNote =
    decision.stage === 'APPLYING'
      ? '该错误的处理选择已受理，正在应用，请等待 OS 更新状态。'
      : decision.stage === 'MANUAL_HANDLING'
        ? '该错误正在人工处置：请在页面顶部“继续手动处理”中完成手动处理，之后才能重新执行。'
        : session && session.decisionId !== decision.decisionId
          ? '另一条错误正在人工处置，请先完成该会话。'
          : !offered
            ? 'OS 未为该错误提供重试选项，请在页面顶部工站错误处置中选择其他处理。'
            : null
  const submit = () =>
    void state
      .submit(
        port.decisionIntent(snapshot, decision, 'retry_current_node', {
          resume: paused && resume,
          reason,
        }),
      )
      .then((ok) => {
        if (ok) {
          setReason('')
          setResume(false)
        }
        onChanged?.()
      })
  const target = `「${actionLabel}」${device ? `（${device}）` : ''}`

  return (
    <section className={clsx(styles['retry'])} aria-label="重新执行该动作">
      <Alert
        type="error"
        showIcon
        message={`动作执行出错，OS 等待处理决定${paused ? '，工站调度已暂停' : ''}`}
        description={decision.message || '节点执行失败，请检查现场。'}
      />
      {state.submitError && <Alert type="error" showIcon message={state.submitError} />}
      {state.unconfirmed && (
        <Alert
          type="warning"
          showIcon
          message={`${state.unconfirmed.label}：结果待确认`}
          description="上次提交没有得到明确结果。将按原请求身份重发，不会创建第二条操作。"
          action={
            <Button
              size="small"
              disabled={state.submitting}
              onClick={() => void state.retryUnconfirmed().then(() => onChanged?.())}
            >
              确认原请求结果
            </Button>
          }
        />
      )}
      {stageNote ? (
        <p className={clsx(styles['hint'])}>{stageNote}</p>
      ) : blocked ? (
        <Alert type="warning" showIcon message="暂不能重新执行该动作" description={blocked} />
      ) : (
        <>
          <p className={clsx(styles['hint'])}>
            重新执行会按原参数让 OS 为该节点新建一次尝试并重新调度，原失败记录保留为历史尝试。
          </p>
          <label className={clsx(styles['field'])}>
            <span>处理说明（选填，会记入 OS）</span>
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 4 }}
              maxLength={2000}
              value={reason}
              disabled={!writable}
              placeholder="例如：已复位工位并取下残留的板"
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {paused && (
            <>
              <Checkbox
                checked={resume}
                disabled={!writable}
                onChange={(event) => setResume(event.target.checked)}
              >
                我已核对现场，重新执行时同时恢复工站工作流调度
              </Checkbox>
              {!resume && (
                <p className={clsx(styles['hint'])}>
                  未勾选时工站保持暂停，新的尝试要等页面顶部“恢复工站调度”后才会派发。
                </p>
              )}
            </>
          )}
          <div className={clsx(styles['actions'])}>
            <Popconfirm
              title={`将按原参数重新执行${target}，OS 新建一次尝试并重新调度。确认现场已复位、具备重新执行的条件？`}
              okText="确认重新执行"
              cancelText="再核对"
              disabled={!writable}
              onConfirm={submit}
            >
              <Button type="primary" loading={state.submitting} disabled={!writable}>
                重新执行该动作
              </Button>
            </Popconfirm>
          </div>
        </>
      )}
    </section>
  )
}
