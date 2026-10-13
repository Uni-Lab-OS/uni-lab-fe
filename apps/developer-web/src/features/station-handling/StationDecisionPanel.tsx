import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Button } from 'antd'
import stationStyles from './stationHandling.module.scss'
import type { StationErrorFact } from '@unilab-fe/core'
import { useStationHandling } from './StationHandlingProvider'
import {
  decisionAvailability,
  isTaskTerminal,
  terminalTaskErrorCopy,
} from './stationHandlingPresentation'

/**
 * 一条错误事实的处置决定。作用域是**节点级**（这条错误挂在哪个 Job 上），
 * 所以它就在节点抽屉的「异常处置」标签页里，路径最短。
 *
 * 「恢复工站调度」不在这里 —— 那是工站级动作，归属在总览的异常任务区。
 * 这里只提供一个「同时恢复调度」的勾选，把工站级后果显式写在节点级界面上。
 */
export function StationDecisionPanel({
  error,
  taskStatus,
}: {
  error: StationErrorFact
  /** 所属任务的状态：终态任务的错误事实只能被关闭。 */
  taskStatus?: string | null
}) {
  const {
    snapshot,
    readError,
    pending,
    submitError,
    decide,
    enterManualHandling,
    completeSession,
    returnSession,
  } = useStationHandling()
  const [reason, setReason] = useState('')
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [completionSummary, setCompletionSummary] = useState('')
  const availability = decisionAvailability(snapshot, error, readError)

  useEffect(() => {
    setConfirmingCancel(false)
  }, [error.decisionId])

  if (availability.kind === 'none') return null

  if (availability.kind === 'applying') {
    return (
      <div className={clsx(stationStyles['decision'])}>
        <strong className={clsx(stationStyles['decision-title'])}>已受理，正在应用</strong>
        <p className={clsx(stationStyles['decision-detail'])}>
          当前选择已经被 OS
          受理，正在应用。请等待处理结果，不要重复提交；生效与否以工站最新状态为准。
        </p>
      </div>
    )
  }

  if (availability.kind === 'manual') {
    // 进入手动处理后不能是死路：会话身份以错误事实为准，只有当前活跃会话
    // 和它对得上时才能完成会话，否则先重新读取，避免顶掉别人的现场核对。
    const sessionId = error.sessionId ?? snapshot?.activeSession?.sessionId ?? null
    const active = snapshot?.activeSession
    const sessionMatches = Boolean(sessionId && active && active.sessionId === sessionId)
    return (
      <div className={clsx(stationStyles['decision'])}>
        <strong className={clsx(stationStyles['decision-title'])}>人工处置中</strong>
        <p className={clsx(stationStyles['decision-detail'])}>{availability.reason}</p>
        {active && (
          <p className={clsx(stationStyles['decision-hint'])}>
            处置会话 {active.sessionId.slice(0, 8)}（版本 {active.version}）
            {active.summary ? `：${active.summary}` : ''}
          </p>
        )}

        {sessionId && sessionMatches && (
          <label className={clsx(stationStyles['decision-field'])}>
            <span>处理记录（选填）</span>
            <textarea
              rows={2}
              value={completionSummary}
              disabled={pending}
              placeholder="记录这次现场处理做了什么"
              onChange={(event) => setCompletionSummary(event.currentTarget.value)}
            />
          </label>
        )}

        {sessionId && sessionMatches && (
          <div className={clsx(stationStyles['decision-actions'])}>
            <Button
              type="primary"
              size="small"
              loading={pending}
              onClick={() => void completeSession(sessionId, completionSummary)}
            >
              完成手动处理
            </Button>
          </div>
        )}

        {sessionId && !sessionMatches && (
          <p className={clsx(stationStyles['decision-hint'], stationStyles['decision-hint--warn'])}>
            本页读到的会话与这条错误对不上（可能已被别人推进）。请先重新读取工站处置状态，再完成会话。
          </p>
        )}

        {submitError && (
          <p className={clsx(stationStyles['problem'])} role="alert">
            {submitError}
          </p>
        )}

        <p className={clsx(stationStyles['decision-hint'])}>
          手动执行设备动作、上下料登记与逻辑占用释放仍在 Uni-Lab OS
          控制台完成；这里只结束会话，让这个节点重新可以取消或重试。
        </p>
      </div>
    )
  }

  if (availability.kind === 'blocked') {
    return (
      <div className={clsx(stationStyles['decision'])}>
        <strong className={clsx(stationStyles['decision-title'])}>暂时不能处置这条错误</strong>
        <p className={clsx(stationStyles['decision-detail'])}>{availability.reason}</p>
      </div>
    )
  }

  // 节点决定只决定这个节点：恢复调度是工站级事实，由 StationResumeCard 单独表达。
  // 把两者捆进同一个勾选框，用户要同时判断两级事实，且被全局门禁拦住时无处解释。
  const submit = (action: 'cancel_task' | 'retry_current_node') => {
    void decide({ error, action, reason, resumeRequested: false, operatorConfirmed: false })
  }
  // 是否提供手动处理只认 OS 声明的选项（id），按钮文案按本页的短标签统一。
  const manualOption = error.options.find((item) => item.id === 'enter_manual_handling')
  // 会话一旦建立就不会随「完成」消失：此时再 enter 必然被 OS 回
  // active_session_conflict，正确动作是「返回手动处理」回到同一个会话。
  const boundSessionId = error.sessionId
  const boundSession = snapshot?.activeSession
  const canReturnToManual = Boolean(
    boundSessionId && boundSession && boundSession.sessionId === boundSessionId,
  )

  // 任务已经终态：重试不会再派发、手动处理也没有意义，只剩「关闭这条错误事实」。
  if (isTaskTerminal(taskStatus)) {
    const copy = terminalTaskErrorCopy(taskStatus)
    return (
      <div className={clsx(stationStyles['decision'])}>
        <strong className={clsx(stationStyles['decision-title'])}>{copy.title}</strong>
        <p className={clsx(stationStyles['decision-detail'])}>{copy.detail}</p>
        <div className={clsx(stationStyles['decision-actions'])}>
          <Button
            type="primary"
            size="small"
            loading={pending}
            onClick={() =>
              void decide({
                error,
                action: 'cancel_task',
                reason,
                resumeRequested: false,
                operatorConfirmed: false,
              })
            }
          >
            关闭异常事实
          </Button>
        </div>
        {submitError && (
          <p className={clsx(stationStyles['problem'])} role="alert">
            {submitError}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={clsx(stationStyles['decision'])}>
      <strong className={clsx(stationStyles['decision-title'])}>异常处理</strong>
      <p className={clsx(stationStyles['decision-detail'])}>
        决定提交后不可撤销，重试会原样复用旧参数；需要现场动手时用手动处理。
      </p>

      <label className={clsx(stationStyles['decision-field'])}>
        <span>处理说明（选填）</span>
        <textarea
          rows={2}
          value={reason}
          disabled={pending}
          placeholder="记录现场检查情况，会进入操作记录"
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </label>

      <div className={clsx(stationStyles['decision-actions'])}>
        {/* 三个选项是同级选择：破坏性的用 danger，其余一律 default；
            不使用 primary，避免「哪个是推荐动作」看起来是随机的。 */}
        <Button danger size="small" disabled={pending} onClick={() => setConfirmingCancel(true)}>
          取消任务
        </Button>
        <Button size="small" disabled={pending} onClick={() => submit('retry_current_node')}>
          重试节点
        </Button>
        {manualOption && !boundSessionId && (
          <Button
            size="small"
            disabled={pending}
            onClick={() => void enterManualHandling({ error, reason })}
          >
            手动处理
          </Button>
        )}
        {boundSessionId && canReturnToManual && (
          <Button
            size="small"
            disabled={pending}
            onClick={() => void returnSession(boundSessionId)}
          >
            返回手动处理
          </Button>
        )}
      </div>

      {boundSessionId && !canReturnToManual && (
        <p className={clsx(stationStyles['decision-hint'], stationStyles['decision-hint--warn'])}>
          这个节点已经有一条人工处置会话，但本页读到的会话与它对不上。请先重新读取工站处置状态。
        </p>
      )}

      {confirmingCancel && (
        <div className={clsx(stationStyles['confirm'])}>
          <p>
            取消后这个任务不会继续，节点错误随任务一起结束，<strong>无法撤销</strong>。确认取消？
          </p>
          <div className={clsx(stationStyles['confirm-actions'])}>
            <Button danger size="small" loading={pending} onClick={() => submit('cancel_task')}>
              确认取消任务
            </Button>
            <Button
              size="small"
              type="text"
              disabled={pending}
              onClick={() => setConfirmingCancel(false)}
            >
              返回
            </Button>
          </div>
        </div>
      )}

      {submitError && (
        <p className={clsx(stationStyles['problem'])} role="alert">
          {submitError}
        </p>
      )}
    </div>
  )
}
