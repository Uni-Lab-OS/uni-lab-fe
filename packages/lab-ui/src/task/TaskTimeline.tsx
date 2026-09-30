import type { ReactNode } from 'react'

import { Icon } from '@unilab/design-v2/icons'

import { cx } from '../classNames'
import { StatusBadge } from '../shared/StatusBadge'

export interface TaskTimelineItem {
  readonly id: string
  readonly time: string
  readonly title: string
  readonly status: string
  readonly device?: string
  readonly duration: string
  readonly progress?: number
}

export interface TaskTimelineClassNames {
  readonly list?: string
  readonly row?: string
  readonly time?: string
  readonly marker?: string
  readonly content?: string
  readonly head?: string
  readonly title?: string
  readonly meta?: string
  readonly chevron?: string
  readonly progress?: string
}

export interface TaskTimelineProps {
  readonly items: readonly TaskTimelineItem[]
  readonly selectedId?: string | null
  readonly onSelect?: (item: TaskTimelineItem) => void
  readonly loading?: boolean
  readonly empty?: ReactNode
  readonly classNames?: TaskTimelineClassNames
  readonly isLast?: (item: TaskTimelineItem, index: number) => boolean
  readonly renderMarker?: (item: TaskTimelineItem) => ReactNode
}

const statusMarker: Record<string, string> = {
  success: 'general/check',
  running: 'media/play',
  waiting: 'time/clock',
  manual: 'users/user-check-01',
  unknown: 'general/help',
  pending: 'general/minus',
  failed: 'alerts-feedback/alert-triangle',
  skipped: 'media/skip-forward',
}

/** 任务节点时间线的纯呈现层；节点事实和状态映射由调用方完成。 */
export function TaskTimeline({
  items,
  selectedId = null,
  onSelect,
  loading = false,
  empty,
  classNames,
  isLast,
  renderMarker,
}: TaskTimelineProps) {
  const names = {
    list: classNames?.list ?? 'lab-ui-task-timeline',
    row: classNames?.row ?? 'lab-ui-task-timeline__row',
    time: classNames?.time ?? 'lab-ui-task-timeline__time',
    marker: classNames?.marker ?? 'lab-ui-task-timeline__marker',
    content: classNames?.content ?? 'lab-ui-task-timeline__content',
    head: classNames?.head ?? 'lab-ui-task-timeline__head',
    title: classNames?.title ?? 'lab-ui-task-timeline__title',
    meta: classNames?.meta ?? 'lab-ui-task-timeline__meta',
    chevron: classNames?.chevron ?? 'lab-ui-task-timeline__chevron',
    progress: classNames?.progress ?? 'lab-ui-task-timeline__progress',
  }
  if (loading) return <TimelineSkeleton className={names.list} />
  return (
    <div className={cx(names.list)}>
      {items.length === 0 ? empty : items.map((item, index) => {
        const last = Boolean(isLast?.(item, index))
        const row = (
          <button
            type="button"
            key={item.id}
            className={cx(names.row, selectedId === item.id && 'is-selected')}
            data-status={item.status}
            data-last={last ? 'true' : undefined}
            onClick={() => onSelect?.(item)}
            disabled={!onSelect}
          >
            <span className={cx(names.time)}>{item.time}</span>
            <span className={cx(names.marker)} data-status={item.status} aria-hidden="true">
              {renderMarker?.(item) ?? <Icon name={(statusMarker[item.status] ?? 'general/info-circle') as never} size={14} color="inherit" />}
            </span>
            <span className={cx(names.content)}>
              <span className={cx(names.head)}>
                <span className={cx(names.title)}>{item.title}</span>
                <StatusBadge status={item.status} />
              </span>
              <span className={cx(names.meta)}>
                <span>执行设备：{item.device ?? 'OS 未提供'}</span>
                <span>持续时间：{item.duration}</span>
              </span>
              {item.status === 'running' && <span className={cx(names.progress)}><span style={{ width: `${item.progress ?? 0}%` }} /></span>}
            </span>
            <span className={cx(names.chevron)} aria-hidden="true"><Icon name="arrows/chevron-right" size={16} color="inherit" /></span>
          </button>
        )
        return row
      })}
    </div>
  )
}

function TimelineSkeleton({ className }: { readonly className: string }) {
  return (
    <div className={cx(className, 'lab-ui-task-timeline__skeleton')} role="status" aria-label="正在加载执行时间线">
      {Array.from({ length: 5 }, (_, index) => (
        <div className={cx('lab-ui-task-timeline__skeleton-row')} key={index}>
          <span className={cx('lab-ui-task-timeline__skeleton-time')} />
          <span className={cx('lab-ui-task-timeline__skeleton-marker')} />
          <span>
            <span className={cx('lab-ui-task-timeline__skeleton-title')} />
            <span className={cx('lab-ui-task-timeline__skeleton-meta')} />
          </span>
        </div>
      ))}
    </div>
  )
}
