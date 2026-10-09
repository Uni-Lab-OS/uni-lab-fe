import { clsx } from 'clsx'
import type { CSSProperties, ReactNode } from 'react'

import { Icon } from '@unilab/design-v2/icons'
import { StatusBadge } from '@unilab/lab-ui'

import styles from './TaskExecutionTimeline.module.scss'

export type TaskExecutionStatus =
  | 'success'
  | 'running'
  | 'waiting'
  | 'manual'
  | 'unknown'
  | 'pending'
  | 'failed'
  | 'skipped'

export interface TaskExecutionTimelineItem {
  readonly id: string
  readonly time: string
  readonly title: string
  readonly status: TaskExecutionStatus
  readonly device?: string
  readonly duration: string
  readonly progress?: number
}

export interface TaskExecutionTimelineProps {
  readonly items: readonly TaskExecutionTimelineItem[]
  readonly selectedId?: string | null
  readonly onSelect?: (item: TaskExecutionTimelineItem) => void
  readonly loading?: boolean
  readonly empty?: ReactNode
  readonly isLast?: (item: TaskExecutionTimelineItem, index: number) => boolean
  readonly renderMarker?: (item: TaskExecutionTimelineItem) => ReactNode
}

const markerGlyph: Record<TaskExecutionStatus, string> = {
  success: 'general/check',
  running: 'media/play',
  waiting: 'time/clock',
  manual: 'users/user-check-01',
  unknown: 'general/help',
  pending: 'general/minus',
  failed: 'alerts-feedback/alert-triangle',
  skipped: 'media/skip-forward',
}

export function TaskExecutionTimeline({
  items,
  selectedId = null,
  onSelect,
  loading = false,
  empty,
  isLast,
  renderMarker,
}: TaskExecutionTimelineProps) {
  if (loading) return <TimelineSkeleton />

  return (
    <div className={styles.root}>
      {items.length === 0
        ? empty
        : items.map((item, index) => {
            const last = Boolean(isLast?.(item, index))
            const progressStyle = {
              '--progress-width': `${Math.max(0, Math.min(100, item.progress ?? 0))}%`,
            } as CSSProperties

            return (
              <button
                type="button"
                key={item.id}
                className={clsx(styles.row, selectedId === item.id && styles.isSelected)}
                data-status={item.status}
                data-last={last ? 'true' : undefined}
                onClick={() => onSelect?.(item)}
                disabled={!onSelect}
              >
                <span className={styles.time}>{item.time}</span>
                <span className={styles.marker} data-status={item.status} aria-hidden="true">
                  {renderMarker?.(item) ?? (
                    <Icon name={markerGlyph[item.status] as never} size={14} color="inherit" />
                  )}
                </span>
                <span className={styles.content}>
                  <span className={styles.head}>
                    <span className={styles.title}>{item.title}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  <span className={styles.meta}>
                    <span>执行设备：{item.device ?? 'OS 未提供'}</span>
                    <span>持续时间：{item.duration}</span>
                  </span>
                  {item.status === 'running' && (
                    <span className={styles.progress} style={progressStyle}>
                      <span />
                    </span>
                  )}
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  <Icon name="arrows/chevron-right" size={16} color="inherit" />
                </span>
              </button>
            )
          })}
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="正在加载执行时间线">
      {Array.from({ length: 5 }, (_, index) => (
        <div className={styles.skeletonRow} key={index}>
          <span className={styles.skeletonTime} />
          <span className={styles.skeletonMarker} />
          <span className={styles.skeletonContent}>
            <span className={styles.skeletonTitle} />
            <span className={styles.skeletonMeta} />
          </span>
        </div>
      ))}
    </div>
  )
}
