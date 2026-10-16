import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Tag } from 'antd'
import type { WorkflowDebugTimelineItem } from '@unilab-fe/core'
import { HumanInteractionDialog } from './HumanInteractionDialog'
import {
  formatDeadline,
  HUMAN_KIND_LABELS,
  HUMAN_STATUS_LABELS,
  summarizeHumanWork,
  timelineSignature,
} from './humanInteractionModel'
import { useTaskHumanInteractions } from './useTaskHumanInteractions'
import styles from './TaskHumanInteraction.module.scss'

/** 任务级“待处理人工交互”：不必先在时间线里找到节点，就能看到并处理 OS 等待的人工输入。 */
export function TaskHumanInteractionPanel({
  taskUuid,
  timeline,
  taskVersion,
  humanNodeIds,
}: {
  taskUuid: string | null
  timeline: readonly WorkflowDebugTimelineItem[]
  /** Task 快照版本（如 updatedAt）；与时间线签名共同决定何时重读。 */
  taskVersion: string
  /** 冻结快照中的人工交互命令节点。 */
  humanNodeIds?: ReadonlySet<string>
}) {
  const refreshKey = `${taskVersion}#${timelineSignature(timeline)}`
  const state = useTaskHumanInteractions(taskUuid, refreshKey)
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  const summary = useMemo(
    () => summarizeHumanWork(timeline, state.items, humanNodeIds),
    [humanNodeIds, state.items, timeline],
  )
  const labels = useMemo(
    () => new Map(timeline.map((job) => [job.jobUuid, job.nodeLabel])),
    [timeline],
  )
  const open = state.items.find((item) => item.interactionUuid === openUuid) ?? null

  if (!taskUuid) return null
  if (!state.available) {
    return summary.awaitingRequest.length > 0 ? (
      <Alert
        className={clsx(styles['panel'])}
        type="warning"
        showIcon
        message="任务在等待人工交互，但当前后端未声明该能力"
        description={state.unavailableReason}
      />
    ) : null
  }
  if (
    summary.pending.length === 0 &&
    summary.awaitingRequest.length === 0 &&
    summary.settled.length === 0 &&
    !state.error
  ) {
    return null
  }

  return (
    <section className={clsx(styles['panel'])} aria-label="人工交互">
      <header className={clsx(styles['panel-header'])}>
        <strong>人工交互</strong>
        {summary.pending.length > 0 && (
          <Tag color="processing">{summary.pending.length} 项待处理</Tag>
        )}
        <Button size="small" loading={state.loading} onClick={() => void state.reload()}>
          刷新
        </Button>
      </header>
      {state.error && (
        <Alert
          type="error"
          showIcon
          message="读取人工交互失败"
          description={`${state.error}。可点“刷新”重试。`}
        />
      )}
      {summary.pending.map((item) => (
        <div key={item.interactionUuid} className={clsx(styles['item'], styles['item-pending'])}>
          <div className={clsx(styles['item-copy'])}>
            <span className={clsx(styles['item-title'])}>
              {HUMAN_KIND_LABELS[item.interactionKind]} · {labels.get(item.jobUuid) ?? '工作流节点'}
            </span>
            <span className={clsx(styles['item-meta'])}>
              {item.prompt.split('\n')[0] || '等待操作员输入'} · {formatDeadline(item)}
            </span>
          </div>
          <Button type="primary" onClick={() => setOpenUuid(item.interactionUuid)}>
            处理
          </Button>
        </div>
      ))}
      {summary.awaitingRequest.map((job) => (
        <div key={job.jobUuid} className={clsx(styles['item'])}>
          <div className={clsx(styles['item-copy'])}>
            <span className={clsx(styles['item-title'])}>{job.nodeLabel}</span>
            <span className={clsx(styles['item-meta'])}>
              工作流命令待执行，OS 尚未返回人工交互请求；轮到该节点后点“刷新”读取。
            </span>
          </div>
        </div>
      ))}
      {summary.settled.length > 0 && (
        <details className={clsx(styles['history'])}>
          <summary>已结束 {summary.settled.length} 项</summary>
          {summary.settled.map((item) => (
            <div key={item.interactionUuid} className={clsx(styles['item'])}>
              <div className={clsx(styles['item-copy'])}>
                <span className={clsx(styles['item-title'])}>
                  {HUMAN_KIND_LABELS[item.interactionKind]} ·{' '}
                  {labels.get(item.jobUuid) ?? '工作流节点'}
                </span>
                <span className={clsx(styles['item-meta'])}>
                  {HUMAN_STATUS_LABELS[item.status]}
                  {item.result && typeof item.result.choice === 'string'
                    ? ` · 选择：${item.options.find((option) => option.value === item.result?.choice)?.label ?? item.result.choice}`
                    : ''}
                  {item.decidedAt ? ` · ${new Date(item.decidedAt).toLocaleString('zh-CN')}` : ''}
                </span>
              </div>
            </div>
          ))}
        </details>
      )}
      {open && (
        <HumanInteractionDialog
          key={open.interactionUuid}
          interaction={open}
          nodeLabel={labels.get(open.jobUuid) ?? null}
          imageUrl={state.resolveImageUrl(open.image)}
          onSubmit={(body) => state.reply(open, body)}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </section>
  )
}
