import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Button, Popconfirm } from 'antd'
import stationStyles from './stationHandling.module.scss'
import type { StationErrorFact } from '@unilab-fe/core'
import { useStationHandling } from './StationHandlingProvider'
import {
  decisionAvailability,
  isTaskTerminal,
  terminalTaskErrorCopy,
} from './stationHandlingPresentation'
import { ManualHandlingDialog } from './ManualHandlingDialog'

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
  const [manualOpen, setManualOpen] = useState(false)
  const availability = decisionAvailability(snapshot, error, readError)
  const activeSession = snapshot?.activeSession ?? null
  const manualSessionId =
    activeSession && activeSession.decisionId === error.decisionId ? activeSession.sessionId : null
  const manualStage = manualSessionId != null && activeSession?.stage === 'MANUAL_HANDLING'
  // OS 的 enter_manual_handling 会**立刻**建会话，所以「什么都没做」也会是 MANUAL_HANDLING。
  // 界面不能把这种情况说成「人工处置中」——那不是事实。
  const sessionActionCount = (snapshot?.manualActions ?? []).filter(
    (job) => manualSessionId != null && job.sessionId === manualSessionId,
  ).length

  // 刚进入人工处理时自动打开弹窗：点了「手动处理」之后不该什么都不发生。
  // 用 ref 记住已经开过哪个会话，避免每次快照刷新把用户刚关掉的弹窗又顶开。
  const openedSession = useRef<string | null>(null)
  useEffect(() => {
    if (!manualStage || !manualSessionId) {
      openedSession.current = null
      return
    }
    if (openedSession.current !== manualSessionId) {
      openedSession.current = manualSessionId
      setManualOpen(true)
    }
  }, [manualStage, manualSessionId])

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
    // 和它对得上时才能打开处理弹窗，否则先重新读取，避免顶掉别人的现场核对。
    if (!manualStage || !activeSession || !manualSessionId) {
      return (
        <div className={clsx(stationStyles['decision'])}>
          <strong className={clsx(stationStyles['decision-title'])}>人工处置中</strong>
          <p className={clsx(stationStyles['decision-detail'])}>{availability.reason}</p>
          <p className={clsx(stationStyles['decision-hint'], stationStyles['decision-hint--warn'])}>
            本页读到的会话与这条错误对不上（可能已被别人推进）。请先重新读取工站处置状态。
          </p>
        </div>
      )
    }
    return (
      <div className={clsx(stationStyles['decision'])}>
        <strong className={clsx(stationStyles['decision-title'])}>
          {sessionActionCount === 0 ? '已进入现场处理，还没有记录任何操作' : '人工处置中'}
        </strong>
        <p className={clsx(stationStyles['decision-detail'])}>
          {sessionActionCount === 0
            ? '进入现场处理后 OS 就建立了会话，即使你还没做任何操作，这条错误也停在「等待处置决定」之前。不需要现场处理的话，直接结束它就能回到决定。'
            : '手动执行设备动作、登记物料位置与释放逻辑占用都在「人工处理」里；结束现场处理后这条错误会回到「等待处置决定」，还要再选一次重试或取消。'}
        </p>
        {sessionActionCount > 0 && (
          <p className={clsx(stationStyles['decision-hint'])}>
            处置会话 {activeSession.sessionId.slice(0, 8)}（版本 {activeSession.version}）
            {activeSession.summary ? `：${activeSession.summary}` : ''}
          </p>
        )}
        <div className={clsx(stationStyles['decision-actions'])}>
          <Button type="primary" size="small" onClick={() => setManualOpen(true)}>
            打开人工处理
          </Button>
          {/* 误进入的快捷出口：不用打开弹窗、不用做任何操作就能回到决定 */}
          {sessionActionCount === 0 && (
            <Button
              size="small"
              type="text"
              disabled={pending}
              onClick={() => void completeSession(activeSession.sessionId, '')}
            >
              不需要现场处理，直接回到决定
            </Button>
          )}
        </div>
        {manualOpen && (
          <ManualHandlingDialog
            key={manualSessionId}
            error={error}
            session={activeSession}
            onClose={() => setManualOpen(false)}
          />
        )}
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

  // 这条错误已经走过人工处理（OS 会给它记一个会话 id）。此时错误回到「等待处置决定」，
  // 界面上按钮看起来和进门之前一样 —— 不说一句「现场处理已完成」，用户会以为提交没生效。
  const handledBefore = Boolean(error.sessionId)

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
          <Popconfirm
            title="关闭这条异常事实？"
            description="任务已经结束，关闭后这条错误不再阻挡工站恢复调度。无法撤销。"
            okText="确认关闭"
            cancelText="返回"
            okButtonProps={{ danger: true, loading: pending }}
            onConfirm={() =>
              void decide({
                error,
                action: 'cancel_task',
                reason,
                resumeRequested: false,
                operatorConfirmed: false,
              })
            }
            disabled={pending}
          >
            <Button type="primary" size="small" loading={pending}>
              关闭异常事实
            </Button>
          </Popconfirm>
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
      {/* 这条错误走过人工处理之后，错误会回到「等待处置决定」，按钮看起来和进门之前一样。
          不说这句「现场处理已完成」，用户会以为刚才的提交没生效。 */}
      {handledBefore && (
        <p className={clsx(stationStyles['decision-hint'], stationStyles['decision-hint--done'])}>
          现场处理已完成并已记录。但这条错误<strong>还没有处理完</strong> —— 还差一步：选择
          「重试节点」或「取消任务」。工站仍然暂停。
        </p>
      )}
      <p className={clsx(stationStyles['decision-detail'])}>
        决定提交后不可撤销，重试会原样复用旧参数。
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
        {/* 两个终点都用轻量 popover 二次确认：它们都会**消费掉**这条错误，不可撤销。 */}
        <Popconfirm
          title="取消当前任务？"
          description="任务不会继续，这条节点错误随任务一起结束，无法撤销。"
          okText="确认取消"
          cancelText="返回"
          okButtonProps={{ danger: true, loading: pending }}
          onConfirm={() => submit('cancel_task')}
          disabled={pending}
        >
          <Button danger size="small" disabled={pending}>
            取消任务
          </Button>
        </Popconfirm>
        <Popconfirm
          title="重试当前节点？"
          description="会原样复用旧参数重新派发。工站暂停期间重试会停在等待，恢复调度后才真正开始。"
          okText="确认重试"
          cancelText="返回"
          okButtonProps={{ loading: pending }}
          onConfirm={() => submit('retry_current_node')}
          disabled={pending}
        >
          <Button size="small" disabled={pending}>
            重试节点
          </Button>
        </Popconfirm>
      </div>

      {/*
        支路区。这里的两条路都**不消费**这条错误 —— 它们只是把现场变成可信状态，
        然后回到这里再选终点（重试/取消）。所以它们不能和那两个终点并列成按钮：
        那样看起来像"三个解法"，而实际只有两个解法。

        两者互斥：还没进过现场处理时是「人工处理」，已经进过时只能「继续现场处理」
        （重新 enter 会被 OS 以 active_session_conflict 拒绝）。
      */}
      {manualOption && !boundSessionId && (
        <p className={clsx(stationStyles['decision-hint'])}>
          现场需要先处理？
          <Popconfirm
            title="进入现场处理？"
            description="会立刻为这条错误建立处置会话，需要提交后才能回到决定。不需要现场处理的话，进入后可以直接结束。"
            okText="进入现场处理"
            cancelText="返回"
            okButtonProps={{ loading: pending }}
            onConfirm={() => void enterManualHandling({ error, reason })}
            disabled={pending}
          >
            <Button type="link" size="small" disabled={pending}>
              人工处理
            </Button>
          </Popconfirm>
        </p>
      )}

      {boundSessionId && canReturnToManual && (
        <p className={clsx(stationStyles['decision-hint'])}>
          还需要到现场再动手？
          <Button
            type="link"
            size="small"
            disabled={pending}
            onClick={() => void returnSession(boundSessionId)}
          >
            继续现场处理
          </Button>
        </p>
      )}

      {boundSessionId && !canReturnToManual && (
        <p className={clsx(stationStyles['decision-hint'], stationStyles['decision-hint--warn'])}>
          这个节点已经有一条人工处置会话，但本页读到的会话与它对不上。请先重新读取工站处置状态。
        </p>
      )}

      {submitError && (
        <p className={clsx(stationStyles['problem'])} role="alert">
          {submitError}
        </p>
      )}
    </div>
  )
}
