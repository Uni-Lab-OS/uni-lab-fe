import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Button, Collapse } from 'antd'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import {
  formatErrorInfoEntries,
  readManualConfirmation,
  summarizeErrorText,
  type TimelineEvent,
} from './taskDetailModel'
import type { StationManualActionJob, WorkflowNodeJobDetail } from '@unilab-fe/core'
import { useStationHandling } from '../station-handling/StationHandlingProvider'
import { stationErrorForJob } from '../station-handling/stationHandlingPresentation'
import { StationDecisionPanel } from '../station-handling/StationDecisionPanel'
import { StationResumeCard } from '../station-handling/StationResumeCard'

/**
 * 节点级异常视图。
 *
 * 这里只做两件事：说清这个节点出了什么事，以及把**这条错误事实**的处置入口
 * 放在最短路径上。工站级的「恢复调度」不在这里 —— 它归属总览的异常任务区。
 *
 * 没有工站级错误事实时也必须如实说明节点状态，不能因为「没有可处置的错误」
 * 就把一个已经 failed 的节点显示成「没有待处理异常」。
 *
 * 展示契约：摘要区只放一句可读结论（OS 错误事实的 message，或 traceback 的最后
 * 一行异常）；完整原文折叠在可滚动的等宽块里。多行堆栈绝不能直接铺进摘要区域，
 * 否则既读不出重点，也会把抽屉布局撑破。
 */
/**
 * 重新读取工站处置状态。
 *
 * 原来这里是一个裸按钮：点了会真的重新读快照，但快照没变时界面毫无变化，
 * 用户只会认为按钮坏了。所以补上进行中状态和一句「已重新读取」。
 */
function StationRereadButton({ onReread }: { onReread: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-refresh-row'])}>
      <Button
        size="small"
        loading={busy}
        onClick={() => {
          setBusy(true)
          setDone(false)
          void onReread().finally(() => {
            setBusy(false)
            setDone(true)
          })
        }}
      >
        重新读取工站处置状态
      </Button>
      {done && !busy && (
        <span className={clsx(taskDetailInspectorStyles['debug-refresh-note'])}>已重新读取</span>
      )}
    </div>
  )
}

function manualActionAbsenceReason(action: StationManualActionJob): string {
  const status =
    action.status === 'succeeded'
      ? '已成功'
      : action.status === 'canceled'
        ? '已停止'
        : action.status === 'timeout'
          ? '超时'
          : '失败'
  const review = action.resultReviewed
    ? '结果已人工核对'
    : action.uncertaintyReason
      ? '结果待现场核对'
      : 'OS 未标记为需要核对'
  return `这是一次人工处置动作（${status}，${review}），不是工作流节点错误：它的结果记在这次处置会话的手动动作记录里，不会新建工站级错误事实，所以这里没有重试／取消的决定入口。结果核对的入口尚未接入本前端，需要核对时请到 Uni-Lab OS 控制台。`
}

export function IssuesTab({
  event,
  job = null,
  taskStatus = null,
}: {
  event: TimelineEvent
  job?: WorkflowNodeJobDetail | null
  /** 所属任务状态：终态任务不再提供重试/手动处理。 */
  taskStatus?: string | null
}) {
  const { snapshot, loading, readError, refresh } = useStationHandling()
  const stationError = stationErrorForJob(snapshot, event.id)
  const manualConfirmation = readManualConfirmation(job)
  const errorEntries = formatErrorInfoEntries(job?.errorInfo ?? [])
  const pendingManualConfirmation = manualConfirmation?.status === 'pending'
  const summary =
    stationError?.message?.trim() ||
    summarizeErrorText(errorEntries[0] ?? '') ||
    event.description ||
    'OS 未返回进一步说明'
  // ``missingStationError`` 是「节点已失败、但当前快照里没有它的错误事实」这个
  // 可疑组合：它既可能是真没有进入工站处置，也可能是本页读到的快照早于失败。
  const missingStationError = event.status === 'failed' && !stationError
  // 这个节点的 job 出现在工站的手动动作记录里 → 它是一次**人工处置动作的执行任务**，
  // 不是工作流节点错误。它按设计不会新建工站级错误事实，所以再怎么读快照也不会有
  // 处置入口 —— 必须换一套文案，而不是继续劝用户「重新读取」。
  const manualAction = snapshot?.manualActions.find((item) => item.jobUuid === event.id) ?? null

  // 工站快照在 RUNNING 期间不轮询，页面又可能早于失败就读过它；这里对每个失败
  // 节点只补读一次，既不掩盖「真的没有错误事实」，也不会反复请求。
  const refreshedForEvent = useRef<string | null>(null)
  useEffect(() => {
    if (!missingStationError || loading) return
    if (refreshedForEvent.current === event.id) return
    refreshedForEvent.current = event.id
    void refresh()
  }, [missingStationError, loading, event.id, refresh])

  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-intervention-card'],
          stationError || event.status === 'failed'
            ? taskDetailInspectorStyles['debug-intervention-manual']
            : event.status === 'unknown'
              ? taskDetailInspectorStyles['debug-intervention-unknown']
              : taskDetailInspectorStyles['debug-intervention-waiting'],
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-intervention-title'])}>
          <DebugIcon
            name={stationError || event.status === 'failed' ? 'alert-triangle' : 'info'}
            size={18}
          />
          <div>
            <strong>
              {nodeIssueTitle(event, Boolean(stationError), pendingManualConfirmation)}
            </strong>
          </div>
        </div>
        <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
          <span>节点状态</span>
          <strong>{summary}</strong>
        </div>
      </div>

      {errorEntries.length > 0 && (
        <div className={clsx(taskDetailInspectorStyles['debug-error-block'])}>
          {/* ghost：边框、分割线由外层容器统一负责，避免和 antd 默认卡片样式叠加。 */}
          <Collapse
            ghost
            size="small"
            items={[
              {
                key: 'raw-error',
                label: `OS 返回的完整错误信息（${errorEntries.length} 条）`,
                children: (
                  <pre
                    className={clsx(
                      taskDetailInspectorStyles['debug-code-block'],
                      taskDetailInspectorStyles['debug-error-detail'],
                    )}
                  >
                    {errorEntries.join('\n\n')}
                  </pre>
                ),
              },
            ]}
          />
        </div>
      )}

      {pendingManualConfirmation && (
        <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
          <span>人工确认</span>
          <strong>这个节点在等待人工确认，请用节点详情上方的人工确认操作处理。</strong>
        </div>
      )}

      {readError && (
        <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
          <span>工站处置状态</span>
          <strong>读取失败：{readError.message}。读不到快照时不能提交任何处置动作。</strong>
          <StationRereadButton onReread={refresh} />
        </div>
      )}

      {!readError && loading && !snapshot && (
        <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
          <span>工站处置状态</span>
          <strong>正在读取工站处置状态…</strong>
        </div>
      )}

      {stationError ? (
        <StationDecisionPanel error={stationError} taskStatus={taskStatus} />
      ) : (
        !readError &&
        !loading && (
          <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
            <span>可做的处置</span>
            <strong>
              {manualAction ? manualActionAbsenceReason(manualAction) : stationAbsenceReason(event)}
            </strong>
            {/* 人工处置动作按设计不会有工站级错误事实，再读快照永远读不出处置入口，
                所以这种情况不给「重新读取」——那是个骗人的按钮。 */}
            {!manualAction && <StationRereadButton onReread={refresh} />}
          </div>
        )
      )}
      {/* 工站级事实与节点无关：这个节点没有错误、或错误刚被处置完时，
          工站仍可能处于暂停，恢复入口必须留在这里，而不是挂在某个节点的决定上。 */}
      <StationResumeCard />
    </div>
  )
}

/**
 * 标题按「最需要人注意的事实」排序：工站级错误事实 > 待人工确认 > 节点运行状态。
 * 待人工确认比时间线状态更紧急 —— 节点可能还在 running，但它在等人。
 */
function nodeIssueTitle(
  event: TimelineEvent,
  hasStationError: boolean,
  pendingManualConfirmation: boolean,
): string {
  if (hasStationError) return '异常信息'
  if (pendingManualConfirmation) return '需要人工确认'
  if (event.status === 'failed') return '节点执行失败'
  if (event.status === 'unknown') return '结果待核对'
  if (event.status === 'manual') return '需要人工确认'
  if (event.status === 'waiting') return '等待资源'
  if (event.status === 'running') return '节点正在执行'
  return '这个节点没有异常'
}

/**
 * 有错误事实才有处置入口。没有时要把「为什么没有」说清楚，
 * 否则一个 failed 的节点会让人以为系统把它漏了。
 */
function stationAbsenceReason(event: TimelineEvent): string {
  if (event.status === 'failed') {
    return 'OS 没有为这个节点建立工站级错误事实：可能这次失败没有进入工站处置流程，也可能是本页读到的工站快照早于失败发生。先点下面的「重新读取工站处置状态」；补读后仍没有处置入口时，请以节点执行记录和 OS 日志为准。'
  }
  if (event.status === 'unknown') {
    return '节点结果未知，但 OS 没有建立工站级错误事实。请核对现场后再回去决定是否恢复调度。'
  }
  if (event.status === 'waiting') {
    return '节点在等待运行时条件，不是异常，没有需要处置的内容。'
  }
  if (event.status === 'manual') {
    return '这个节点等待的是人工确认，不属于工站级节点错误处置。'
  }
  if (event.status === 'success') {
    return '这个节点已经成功，没有需要处置的内容。'
  }
  return '当前没有与这个节点关联的工站级异常事实。'
}
