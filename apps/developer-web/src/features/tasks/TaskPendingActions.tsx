import { clsx } from 'clsx'
import { Button, Tag } from 'antd'
import { statusLabels, type TimelineEvent } from './taskDetailModel'
import styles from './TaskHumanInteraction.module.scss'

/**
 * 需要操作员关注的节点：待人工确认、结果未知需现场核对、或已就绪但在等资源（OS 给出等待原因，
 * 如库位被占用；常见于取消后现场物料未清理）。只看当前 attempt。
 */
export function pendingOperatorEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter(
    (event) =>
      event.currentAttempt !== false &&
      (event.status === 'manual' || event.status === 'unknown' || event.status === 'waiting'),
  )
}

/**
 * 任务详情顶部的待处理入口。大工作流有数千个节点，等待人工确认的节点往往埋在时间线中段，
 * 这里直接列出并可一键打开详情处理；状态来自 OS 作业投影，处理结果以 OS 重读为准。
 */
export interface PlanStallItem {
  readonly nodeId: string
  readonly reason: string
  /** 对应的时间线事件（作业）；找不到时显示“待执行节点”，节点身份放在提示里。 */
  readonly event: TimelineEvent | null
}

export function TaskPendingActions({
  events,
  stalls = [],
  onOpen,
}: {
  events: readonly TimelineEvent[]
  /** OS 无法排程的节点（不会被派发，任务会停住）。 */
  stalls?: readonly PlanStallItem[]
  onOpen: (eventId: string) => void
}) {
  const pending = pendingOperatorEvents(events)
  if (pending.length === 0 && stalls.length === 0) return null
  return (
    <section className={clsx(styles['panel'])} aria-label="待处理节点">
      <div className={clsx(styles['panel-header'])}>
        <strong>待处理 {pending.length + stalls.length}</strong>
        <span className={clsx(styles['hint'])}>
          这些节点在等待操作员，处理前任务不会继续推进相关分支
        </span>
      </div>
      {stalls.map((stall) => (
        <div key={`stall:${stall.nodeId}`} className={clsx(styles['item'], styles['item-pending'])}>
          <Tag color="red">无法排程</Tag>
          <div className={clsx(styles['item-copy'])}>
            <span
              className={clsx(styles['item-title'])}
              title={stall.event?.titleHint ?? `节点 ID：${stall.nodeId}`}
            >
              {stall.event?.title ?? '待执行节点'}
            </span>
            <span className={clsx(styles['item-meta'])}>
              OS 时间排程：{stall.reason}。该节点不会被派发，任务会停在这里；请检查估时规则或联系 OS
              维护者。
            </span>
          </div>
          {stall.event && (
            <Button size="small" onClick={() => onOpen(stall.event!.id)}>
              查看节点
            </Button>
          )}
        </div>
      ))}
      {pending.map((event) => (
        <div key={event.id} className={clsx(styles['item'], styles['item-pending'])}>
          <Tag
            color={
              event.status === 'manual' ? 'gold' : event.status === 'waiting' ? 'default' : 'orange'
            }
          >
            {statusLabels[event.status]}
          </Tag>
          <div className={clsx(styles['item-copy'])}>
            <span className={clsx(styles['item-title'])}>{event.title}</span>
            {event.description && (
              <span className={clsx(styles['item-meta'])}>{event.description}</span>
            )}
          </div>
          <Button size="small" type="primary" onClick={() => onOpen(event.id)}>
            {event.status === 'manual' ? '去确认' : event.status === 'waiting' ? '查看' : '去核对'}
          </Button>
        </div>
      ))}
    </section>
  )
}
