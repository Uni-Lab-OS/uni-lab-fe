import { clsx } from 'clsx'
import overviewPageStyles from './OverviewPage.module.scss'
import overviewSkeletonStyles from './OverviewSkeleton.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Progress } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { AppIcon } from '../../components/ui/Icon'
import type { TaskRow } from './taskPresentation'
import { taskSecondaryText } from './taskPresentation'

export function OverviewSkeleton() {
  return (
    <div
      className={clsx(overviewSkeletonStyles['overview-skeleton'])}
      role="status"
      aria-label="正在加载总览"
    >
      <div className={clsx(overviewSkeletonStyles['overview-skeleton-summary'])}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={clsx(overviewSkeletonStyles['overview-skeleton-metric'])} key={index}>
            <span className={clsx(overviewSkeletonStyles['overview-skeleton-icon'])} />
            <span className={clsx(overviewSkeletonStyles['overview-skeleton-metric-copy'])}>
              <span className={clsx(overviewSkeletonStyles['overview-skeleton-label'])} />
              <span className={clsx(overviewSkeletonStyles['overview-skeleton-value'])} />
            </span>
          </div>
        ))}
      </div>
      <div className={clsx(overviewSkeletonStyles['overview-skeleton-columns'])}>
        {Array.from({ length: 2 }, (_, columnIndex) => (
          <section
            className={clsx(overviewSkeletonStyles['overview-skeleton-column'])}
            key={columnIndex}
          >
            <span className={clsx(overviewSkeletonStyles['overview-skeleton-heading'])} />
            <div className={clsx(overviewSkeletonStyles['overview-skeleton-task-list'])}>
              {Array.from({ length: 4 }, (_, rowIndex) => (
                <div
                  className={clsx(overviewSkeletonStyles['overview-skeleton-task-row'])}
                  key={rowIndex}
                >
                  <span className={clsx(overviewSkeletonStyles['overview-skeleton-task-copy'])} />
                  <span
                    className={clsx(overviewSkeletonStyles['overview-skeleton-task-progress'])}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <section className={clsx(overviewSkeletonStyles['overview-skeleton-table'])}>
        <div className={clsx(overviewSkeletonStyles['overview-skeleton-table-toolbar'])}>
          <span className={clsx(overviewSkeletonStyles['overview-skeleton-table-title'])} />
          <span
            className={clsx(
              overviewSkeletonStyles['overview-skeleton-filter'],
              overviewSkeletonStyles['overview-skeleton-filter--wide'],
            )}
          />
          <span className={clsx(overviewSkeletonStyles['overview-skeleton-filter'])} />
        </div>
        <div className={clsx(overviewSkeletonStyles['overview-skeleton-table-head'])}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        {Array.from({ length: 5 }, (_, rowIndex) => (
          <div
            className={clsx(overviewSkeletonStyles['overview-skeleton-table-row'])}
            key={rowIndex}
          >
            {Array.from({ length: 6 }, (_, cellIndex) => (
              <span
                className={clsx(cellIndex === 0 ? overviewSkeletonStyles['is-primary'] : '')}
                key={cellIndex}
              />
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}

/**
 * 工站级异常的入口。首页不再放醒目的暂停横幅或工站卡片，
 * 「异常」指标卡自己承担发现与去处置，避免同一件事在首屏出现三次。
 */
export interface SummaryStationAlert {
  readonly hint: string
  readonly primary: { readonly label: string; readonly onClick: () => void }
  readonly secondary?: { readonly label: string; readonly onClick: () => void }
}

export function SummaryStrip({
  rows,
  total,
  stationAlert,
}: {
  /** 看板窗口内的任务；「等待中/执行中/异常」都按它统计。 */
  rows: readonly TaskRow[]
  /**
   * 后端返回的任务总数。看板窗口只覆盖活动/需关注任务加最近终态，
   * 所以「全部」必须用权威总数，否则窗口一小它就不是「全部」了。
   * 缺省时退回窗口条数，供只有一份投影的调用方使用。
   */
  total?: number
  stationAlert?: SummaryStationAlert
}) {
  const values = [
    { label: '全部', value: total ?? rows.length, icon: 'layout/grid-01', tone: 'neutral' },
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
    <div className={clsx(overviewPageStyles['summary-strip'])}>
      {values.map((item) => {
        const alert = item.label === '异常' ? stationAlert : undefined
        return (
          <div
            className={clsx(
              overviewPageStyles['summary-metric'],
              appShellStyles['summary-metric'],
              overviewPageStyles[`summary-metric--${item.tone}`],
              alert && overviewPageStyles['summary-metric--alert'],
            )}
            key={item.label}
          >
            <AppIcon
              name={item.icon}
              size={20}
              color={item.tone === 'red' ? 'error' : item.tone === 'blue' ? 'primary' : 'context'}
            />
            {alert ? (
              <div className={clsx(overviewPageStyles['summary-alert-layout'])}>
                <div className={clsx(overviewPageStyles['summary-alert-metric'])}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <div className={clsx(overviewPageStyles['summary-alert-action'])}>
                  <span className={clsx(overviewPageStyles['summary-hint'])}>{alert.hint}</span>
                  <div className={clsx(overviewPageStyles['summary-metric-actions'])}>
                    <Button type="primary" danger size="small" onClick={alert.primary.onClick}>
                      {alert.primary.label}
                    </Button>
                    {alert.secondary && (
                      <Button size="small" onClick={alert.secondary.onClick}>
                        {alert.secondary.label}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            )}
          </div>
        )
      })}
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
    <section
      className={clsx(
        overviewPageStyles['task-column'],
        appShellStyles['task-column'],
        sharedStyles['task-column'],
        attention
          ? clsx(
              overviewPageStyles['task-column--attention'],
              appShellStyles['task-column--attention'],
              sharedStyles['task-column--attention'],
            )
          : '',
      )}
    >
      <div className={clsx(sharedStyles['section-title'])}>
        <div>
          <h2>{title}</h2>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          className={clsx(overviewPageStyles['task-column-empty'])}
          scene={attention ? 'no-data' : 'no-task'}
          size="compact"
          title={empty}
        />
      ) : (
        <div
          className={clsx(
            overviewPageStyles['task-column-list'],
            appShellStyles['task-column-list'],
            sharedStyles['task-column-list'],
          )}
        >
          {rows.map((row) => {
            const secondaryText = taskSecondaryText(row)
            return (
              <button
                type="button"
                className={clsx(overviewPageStyles['task-row'], sharedStyles['task-row'])}
                key={row.task.taskUuid}
                onClick={() => onView(row)}
              >
                <div className={clsx(sharedStyles['task-row-copy'])}>
                  <strong>{row.name}</strong>
                  {secondaryText ? <span>{secondaryText}</span> : null}
                </div>
                <div
                  className={clsx(
                    overviewPageStyles['task-row-progress'],
                    sharedStyles['task-row-progress'],
                  )}
                >
                  {row.progress == null ? (
                    <div
                      className={clsx(
                        overviewPageStyles['task-row-progress-line'],
                        overviewPageStyles['task-row-progress-line--empty'],
                      )}
                    >
                      <span className={clsx(sharedStyles['muted-cell'])}>无进度</span>
                      <TaskStatusText status={row.status} />
                    </div>
                  ) : (
                    <>
                      <div className={clsx(overviewPageStyles['task-row-progress-line'])}>
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
    <span
      className={clsx(
        overviewPageStyles['task-row-status'],
        overviewPageStyles[`task-row-status--${tone}`],
      )}
    >
      {labels[normalized] ?? status}
    </span>
  )
}
