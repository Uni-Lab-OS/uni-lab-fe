import { clsx } from 'clsx'
import { StatusBadge } from '@unilab/lab-ui'
import type { TaskRuntimeDetail, WorkflowDebugFacts } from '@unilab-fe/core'
import { normalizeStatus } from '../overview/taskPresentation'
import { DebugIcon } from './TaskDetailIcons'
import type { TimelineEvent } from './taskDetailModel'
import { jobCountParts, taskAttention } from './taskStatusPresentation'
import styles from './TaskDetailSummary.module.scss'

/**
 * 任务概览。任务状态以 OS Task 为准，不用某个节点的状态代替；节点只按当前 attempt
 * 如实计数（取消、跳过分开），OS 未提供业务进度时不估算百分比。
 */
export function TaskDetailSummary({
  task,
  facts,
  currentTimelineEvent,
  statusTooltip,
}: {
  task: TaskRuntimeDetail | null
  facts: WorkflowDebugFacts | null | undefined
  currentTimelineEvent: TimelineEvent | null
  statusTooltip: string
}) {
  const status = task
    ? normalizeStatus(task.status, task.attentionReason ?? null, task.controlStatus, task.cleanupStatus)
    : null
  const attention = task ? taskAttention(task) : null
  const counts = facts?.jobCounts
  const parts = counts ? jobCountParts(counts) : []
  return (
    <section className={clsx(styles['debug-summary-grid'])} aria-label="任务概览">
      <div className={clsx(styles['debug-summary-card'])}>
        <span className={clsx(styles['debug-summary-icon'])} aria-hidden="true">
          <DebugIcon name="activity" size={17} />
        </span>
        <div className={clsx(styles['debug-summary-body'])}>
          <div className={clsx(styles['debug-summary-head'])}>
            <span className={clsx(styles['debug-summary-metric'])}>
              <span className={clsx(styles['debug-summary-label'])}>任务状态</span>
              <span className={clsx(styles['debug-current-status'])}>
                {status ? <StatusBadge status={status} /> : '—'}
              </span>
            </span>
            <span className={clsx(styles['debug-summary-meta'])}>以 OS 任务状态为准</span>
          </div>
          <div className={clsx(styles['debug-summary-line'])}>
            {attention ? (
              <span className={clsx(styles['debug-summary-attention'])} role="status">
                {attention}
              </span>
            ) : (
              <span className={clsx(styles['debug-summary-focus'])}>
                <span className={clsx(styles['debug-summary-focus-label'])}>当前节点</span>
                {currentTimelineEvent?.title ?? '—'}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className={clsx(styles['debug-summary-card'])}>
        <span className={clsx(styles['debug-summary-icon'])} aria-hidden="true">
          <DebugIcon name="bar-chart" size={17} />
        </span>
        <div className={clsx(styles['debug-summary-body'])}>
          <div className={clsx(styles['debug-summary-head'])}>
            <span className={clsx(styles['debug-summary-metric'])}>
              <span className={clsx(styles['debug-summary-label'])}>节点概况</span>
              <span className={clsx(styles['debug-summary-value'])}>
                {facts?.progress ? `${facts.progress.percent}%` : (counts?.total ?? '—')}
              </span>
            </span>
            <span className={clsx(styles['debug-summary-meta'])} title={statusTooltip}>
              {facts?.progress
                ? `OS 进度 ${facts.progress.completed} / ${facts.progress.total}`
                : '当前 attempt 节点数（OS 未提供业务进度）'}
            </span>
          </div>
          <div className={clsx(styles['debug-summary-line'])} aria-label="节点状态计数">
            {parts.length === 0 ? (
              <span className={clsx(styles['debug-summary-meta'])}>暂无节点</span>
            ) : (
              <span className={clsx(styles['debug-summary-counts'])}>
                {parts.map((part) => (
                  <span key={part.key} className={clsx(styles['debug-summary-count'], styles[`is-${part.key}`])}>
                    {part.label} {part.value}
                  </span>
                ))}
                {counts && counts.historicalAttempts > 0 && (
                  <span className={clsx(styles['debug-summary-count'])}>
                    历史重试 {counts.historicalAttempts}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
