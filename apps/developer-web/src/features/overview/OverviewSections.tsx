import { cx } from './overviewClassNames'
import { Progress } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { AppIcon } from '../../components/ui/Icon'
import type { TaskRow } from './taskPresentation'
import { taskSecondaryText } from './taskPresentation'

export function OverviewSkeleton() {
  return (
    <div className={cx('overview-skeleton')} role="status" aria-label="正在加载总览">
      <div className={cx('overview-skeleton-summary')}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={cx('overview-skeleton-metric')} key={index}>
            <span className={cx('overview-skeleton-icon')} />
            <span className={cx('overview-skeleton-metric-copy')}>
              <span className={cx('overview-skeleton-label')} />
              <span className={cx('overview-skeleton-value')} />
            </span>
          </div>
        ))}
      </div>
      <div className={cx('overview-skeleton-columns')}>
        {Array.from({ length: 2 }, (_, columnIndex) => (
          <section className={cx('overview-skeleton-column')} key={columnIndex}>
            <span className={cx('overview-skeleton-heading')} />
            <div className={cx('overview-skeleton-task-list')}>
              {Array.from({ length: 4 }, (_, rowIndex) => (
                <div className={cx('overview-skeleton-task-row')} key={rowIndex}>
                  <span className={cx('overview-skeleton-task-copy')} />
                  <span className={cx('overview-skeleton-task-progress')} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <section className={cx('overview-skeleton-table')}>
        <div className={cx('overview-skeleton-table-toolbar')}>
          <span className={cx('overview-skeleton-table-title')} />
          <span className={cx('overview-skeleton-filter', 'overview-skeleton-filter--wide')} />
          <span className={cx('overview-skeleton-filter')} />
        </div>
        <div className={cx('overview-skeleton-table-head')}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, rowIndex) => (
          <div className={cx('overview-skeleton-table-row')} key={rowIndex}>
            {Array.from({ length: 6 }, (_, cellIndex) => (
              <span className={cx(cellIndex === 0 ? 'is-primary' : '')} key={cellIndex} />
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}

export function SummaryStrip({ rows }: { rows: readonly TaskRow[] }) {
  const values = [
    { label: '全部', value: rows.length, icon: 'layout/grid-01', tone: 'neutral' },
    {
      label: '等待中',
      value: rows.filter((row) => row.status === 'waiting').length,
      icon: 'time/clock',
      tone: 'amber',
    },
    {
      label: '执行中',
      value: rows.filter((row) => row.status === 'running').length,
      icon: 'media/play',
      tone: 'blue',
    },
    {
      label: '异常',
      value: rows.filter((row) => ['attention', 'failed'].includes(row.status)).length,
      icon: 'alerts-feedback/alert-circle',
      tone: 'red',
    },
  ] as const
  return (
    <div className={cx('summary-strip')}>
      {values.map((item) => (
        <div className={cx(`summary-metric summary-metric--${item.tone}`)} key={item.label}>
          <AppIcon
            name={item.icon}
            size={20}
            color={item.tone === 'red' ? 'error' : item.tone === 'blue' ? 'primary' : 'context'}
          />
          <div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        </div>
      ))}
    </div>
  )
}

export function TaskColumn({
  title,
  rows,
  onView,
  attention = false,
  empty,
}: {
  title: string
  note?: string
  rows: readonly TaskRow[]
  onView: (row: TaskRow) => void
  attention?: boolean
  empty: string
}) {
  return (
    <section className={cx(`task-column ${attention ? 'task-column--attention' : ''}`)}>
      <div className={cx('section-title')}>
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          className={cx('task-column-empty')}
          scene={attention ? 'no-data' : 'no-task'}
          size="compact"
          title={empty}
        />
      ) : (
        <div className={cx('task-column-list')}>
          {rows.map((row) => {
            const secondaryText = taskSecondaryText(row)
            return (
              <button
                type="button"
                className={cx('task-row')}
                key={row.task.taskUuid}
                onClick={() => onView(row)}
              >
                <div className={cx('task-row-copy')}>
                  <strong>{row.name}</strong>
                  {secondaryText ? <span>{secondaryText}</span> : null}
                </div>
                <div className={cx('task-row-progress')}>
                  {row.progress == null ? (
                    <div className={cx('task-row-progress-line task-row-progress-line--empty')}>
                      <span className={cx('muted-cell')}>无进度</span>
                      <TaskStatusText status={row.status} />
                    </div>
                  ) : (
                    <>
                      <div className={cx('task-row-progress-line')}>
                        <Progress
                          percent={row.progress}
                          showInfo={false}
                          size="small"
                          strokeColor={
                            attention
                              ? 'var(--bh-color-error-default)'
                              : row.status === 'waiting'
                                ? 'var(--bh-color-warning-default)'
                                : 'var(--bh-color-primary)'
                          }
                        />
                        <span>{row.progress}%</span>
                      </div>
                      <TaskStatusText status={row.status} />
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function TaskStatusText({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const labels: Record<string, string> = {
    running: '执行中',
    waiting: '等待中',
    attention: '异常',
    failed: '失败',
  }
  const tone = normalized === 'attention' || normalized === 'failed' ? 'error' : normalized
  return (
    <span className={cx(`task-row-status task-row-status--${tone}`)}>
      {labels[normalized] ?? status}
    </span>
  )
}
