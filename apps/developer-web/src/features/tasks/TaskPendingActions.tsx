import { clsx } from 'clsx'
import { Button, Tag } from 'antd'
import { statusLabels, type TimelineEvent } from './taskDetailModel'
import styles from './TaskHumanInteraction.module.scss'

/** 需要操作员处理的节点：待人工确认，或设备动作结果未知需现场核对。只看当前 attempt。 */
export function pendingOperatorEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter(
    (event) =>
      event.currentAttempt !== false && (event.status === 'manual' || event.status === 'unknown'),
  )
}

/**
 * 任务详情顶部的待处理入口。大工作流有数千个节点，等待人工确认的节点往往埋在时间线中段，
 * 这里直接列出并可一键打开详情处理；状态来自 OS 作业投影，处理结果以 OS 重读为准。
 */
export function TaskPendingActions({
  events,
  onOpen,
}: {
  events: readonly TimelineEvent[]
  onOpen: (eventId: string) => void
}) {
  const pending = pendingOperatorEvents(events)
  if (pending.length === 0) return null
  return (
    <section className={clsx(styles['panel'])} aria-label="待处理节点">
      <div className={clsx(styles['panel-header'])}>
        <strong>待处理 {pending.length}</strong>
        <span className={clsx(styles['hint'])}>
          这些节点在等待操作员，处理前任务不会继续推进相关分支
        </span>
      </div>
      {pending.map((event) => (
        <div key={event.id} className={clsx(styles['item'], styles['item-pending'])}>
          <Tag color={event.status === 'manual' ? 'gold' : 'orange'}>
            {statusLabels[event.status]}
          </Tag>
          <div className={clsx(styles['item-copy'])}>
            <span className={clsx(styles['item-title'])}>{event.title}</span>
            {event.description && (
              <span className={clsx(styles['item-meta'])}>{event.description}</span>
            )}
          </div>
          <Button size="small" type="primary" onClick={() => onOpen(event.id)}>
            {event.status === 'manual' ? '去确认' : '去核对'}
          </Button>
        </div>
      ))}
    </section>
  )
}
