import { clsx } from 'clsx'
import { StatusBadge } from '@unilab/lab-ui'
import type { WorkflowDebugFacts } from '@unilab-fe/core'
import { DebugIcon } from './TaskDetailIcons'
import type { TimelineEvent } from './taskDetailModel'
import styles from './TaskDetailSummary.module.scss'

export function TaskDetailSummary({
  facts,
  currentTimelineEvent,
  statusTooltip,
}: {
  facts: WorkflowDebugFacts | null | undefined
  currentTimelineEvent: TimelineEvent | null
  statusTooltip: string
}) {
  return (
    <section className={clsx(styles['debug-summary-grid'])} aria-label="任务概览">
      <div className={clsx(styles['debug-summary-card'])}>
        <span className={clsx(styles['debug-summary-icon'])} aria-hidden="true">
          <DebugIcon name="bar-chart" size={17} />
        </span>
        <div className={clsx(styles['debug-summary-body'])}>
          <div className={clsx(styles['debug-summary-head'])}>
            <span className={clsx(styles['debug-summary-metric'])}>
              <span className={clsx(styles['debug-summary-label'])}>进度</span>
              <span className={clsx(styles['debug-summary-value'])}>
                {facts?.progress ? `${facts.progress.percent}%` : '—'}
              </span>
            </span>
            <span className={clsx(styles['debug-summary-meta'])}>
              {facts?.progress
                ? `${facts.progress.completed} / ${facts.progress.total} 节点`
                : 'OS 未提供进度'}
            </span>
          </div>
          <div className={clsx(styles['debug-summary-line'])}>
            <div
              className={clsx(
                styles['debug-summary-progress-track'],
                facts?.progress ? '' : styles['is-unavailable'],
              )}
              role="progressbar"
              aria-label={
                facts?.progress
                  ? `任务进度 ${facts.progress.percent}%，${facts.progress.completed} / ${facts.progress.total} 节点`
                  : '任务进度未提供'
              }
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={facts?.progress?.percent ?? 0}
              title={
                facts?.progress
                  ? `${facts.progress.percent}% · ${facts.progress.completed} / ${facts.progress.total} 节点`
                  : 'OS 未提供进度'
              }
            >
              <span style={{ width: `${facts?.progress?.percent ?? 0}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className={clsx(styles['debug-summary-card'])}>
        <span className={clsx(styles['debug-summary-icon'])} aria-hidden="true">
          <DebugIcon name="activity" size={17} />
        </span>
        <div className={clsx(styles['debug-summary-body'])}>
          <div className={clsx(styles['debug-summary-head'])}>
            <span className={clsx(styles['debug-summary-metric'])}>
              <span className={clsx(styles['debug-summary-label'])}>状态</span>
              <span className={clsx(styles['debug-current-status'])}>
                {currentTimelineEvent ? <StatusBadge status={currentTimelineEvent.status} /> : '—'}
              </span>
            </span>
            <span className={clsx(styles['debug-summary-meta'])}>{statusTooltip}</span>
          </div>
          <div
            className={clsx(styles['debug-summary-line'])}
            title={`当前节点：${currentTimelineEvent?.title ?? '—'}；${statusTooltip}`}
          >
            <span className={clsx(styles['debug-summary-focus'])}>
              <span className={clsx(styles['debug-summary-focus-label'])}>当前节点</span>
              {currentTimelineEvent?.title ?? '—'}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
