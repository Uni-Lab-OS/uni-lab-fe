import { clsx } from 'clsx'
import { useDeferredValue, useMemo, useState } from 'react'
import { Input, Segmented, Switch } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import taskDetailTimelineStyles from './TaskDetailTimelinePanel.module.scss'
import { TaskExecutionTimeline } from './TaskExecutionTimeline'
import { TaskParallelTimelineRow } from './TaskParallelTimelineRow'
import { DebugActionButton, DebugIcon } from './TaskDetailIcons'
import {
  arrangeTimeline,
  type EventStatus,
  markerGlyph,
  type TimelineOrder,
  type TimelineSection,
} from './taskDetailModel'
import type { useTaskDetailController } from './useTaskDetailController'

type Controller = ReturnType<typeof useTaskDetailController>

const SECTION_LABELS: Record<TimelineSection['kind'], string> = {
  active: '进行中',
  history: '已发生 · 最近在前',
  unstarted: '未开始 · 按步骤顺序',
}

export function TaskDetailTimelinePanel({ controller }: { controller: Controller }) {
  const {
    viewModel,
    storeCommand,
    storeError,
    storeStatus,
    controlStatus,
    commandResultMessage,
    timelineLoading,
    timelineEvents,
    selectedId,
    readyFrontier,
    parallelOpen,
    setParallelOpen,
    openEvent,
  } = controller
  const [order, setOrder] = useState<TimelineOrder>('time')
  const [showUnexecuted, setShowUnexecuted] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [query, setQuery] = useState('')
  // 节点可能有几千个：输入框立即响应，过滤与重绘列表延后到空闲时进行。
  const deferredQuery = useDeferredValue(query)
  const searching = deferredQuery.trim() !== ''
  const arranged = useMemo(
    () =>
      arrangeTimeline(timelineEvents, { order, showUnexecuted, showHistory, query: deferredQuery }),
    [deferredQuery, order, showHistory, showUnexecuted, timelineEvents],
  )
  const collapsedTotal =
    arranged.collapsed.canceled + arranged.collapsed.skipped + arranged.collapsed.pending
  const sections = useMemo(
    () =>
      arranged.sections.map((section) => ({
        start: section.start,
        label: `${SECTION_LABELS[section.kind]}（${section.count}）`,
      })),
    [arranged.sections],
  )
  // 时间视图把“正在发生”放在最上方，并行候选（等待选择下一步）也随之置顶；步骤视图保持在末尾。
  // 搜索时只列匹配的节点，不显示并行候选行。
  const frontierOnTop = order === 'time'
  const frontierRow =
    readyFrontier.length > 1 && !searching ? (
      <TaskParallelTimelineRow
        candidates={readyFrontier}
        open={parallelOpen}
        onOpen={() => setParallelOpen(true)}
      />
    ) : null
  const commandFeedbackTone =
    storeError || storeCommand?.lifecycle === 'rejected'
      ? taskDetailTimelineStyles['is-error']
      : storeStatus === 'commanding'
        ? taskDetailTimelineStyles['is-pending']
        : taskDetailTimelineStyles['is-success']
  const commandFeedbackIcon =
    storeError || storeCommand?.lifecycle === 'rejected'
      ? 'alert-circle'
      : storeStatus === 'commanding'
        ? 'activity'
        : 'check-circle'

  return (
    <section className={clsx(taskDetailTimelineStyles['debug-workspace'])}>
      <div className={clsx(taskDetailTimelineStyles['debug-timeline-panel'])}>
        <div className={clsx(taskDetailTimelineStyles['debug-panel-heading'])}>
          <div>
            <h2>执行时间线</h2>
          </div>
          <div
            className={clsx(taskDetailTimelineStyles['debug-timeline-actions'])}
            aria-label="任务调试操作"
          >
            {controlStatus === 'active' ? (
              <DebugActionButton
                label="暂停任务"
                disabled={!viewModel?.controls.canPause || storeStatus === 'commanding'}
                onClick={() => controller.submitCommand('pause')}
              >
                <DebugIcon name="pause" size={17} />
              </DebugActionButton>
            ) : (
              <DebugActionButton
                label="继续任务"
                className={taskDetailTimelineStyles['debug-timeline-action-primary']}
                disabled={!viewModel?.controls.canResume || storeStatus === 'commanding'}
                onClick={() => controller.submitCommand('resume')}
              >
                <DebugIcon name="play" size={17} />
              </DebugActionButton>
            )}
            <DebugActionButton
              label="执行下一步"
              tooltip={storeStatus === 'commanding' ? '命令提交中，请等待 Core 回执' : '执行下一步'}
              disabled={!viewModel?.controls.canStep || storeStatus === 'commanding'}
              onClick={() => controller.submitCommand('step')}
            >
              <DebugIcon name="skip-forward" size={17} />
            </DebugActionButton>
            <DebugActionButton
              label="取消任务"
              className={taskDetailTimelineStyles['debug-timeline-action-danger']}
              disabled={!viewModel?.controls.canCancel || storeStatus === 'commanding'}
              confirm={{
                title:
                  '取消该任务？未执行的节点不再执行，已开始的设备动作按 OS 规则收尾。停止后若 OS 仍保留设备/物料占用，会提示你核对现场后释放。',
                okText: '确认取消',
              }}
              onClick={() => controller.submitCommand('cancel')}
            >
              <DebugIcon name="square" size={16} />
            </DebugActionButton>
          </div>
        </div>
        {commandResultMessage && (
          <div
            className={clsx(
              taskDetailTimelineStyles['debug-command-feedback'],
              commandFeedbackTone,
            )}
            role="status"
          >
            <DebugIcon name={commandFeedbackIcon} size={15} />
            <span>{commandResultMessage}</span>
          </div>
        )}
        <div className={clsx(taskDetailTimelineStyles['debug-timeline-filters'])}>
          <Segmented
            size="small"
            value={order}
            onChange={(value) => setOrder(value as TimelineOrder)}
            options={[
              { label: '按发生时间', value: 'time' },
              { label: '按步骤顺序', value: 'steps' },
            ]}
          />
          <Input
            allowClear
            size="small"
            className={clsx(taskDetailTimelineStyles['debug-timeline-search'])}
            prefix={<DebugIcon name="search" size={14} />}
            placeholder="搜索节点、动作或设备"
            aria-label="搜索时间线节点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {collapsedTotal > 0 && !searching && (
            <label className={clsx(taskDetailTimelineStyles['debug-timeline-toggle'])}>
              <Switch size="small" checked={showUnexecuted} onChange={setShowUnexecuted} />
              显示未执行节点（取消 {arranged.collapsed.canceled} · 跳过 {arranged.collapsed.skipped}{' '}
              · 未到达 {arranged.collapsed.pending}）
            </label>
          )}
          {arranged.historical > 0 && (
            <label className={clsx(taskDetailTimelineStyles['debug-timeline-toggle'])}>
              <Switch size="small" checked={showHistory} onChange={setShowHistory} />
              显示历史重试（{arranged.historical}）
            </label>
          )}
          <span className={clsx(taskDetailTimelineStyles['debug-timeline-hint'])}>
            {searching
              ? `匹配 ${arranged.items.length} 个节点（含未执行节点）`
              : order === 'steps'
                ? '步骤顺序只反映 DAG 结构，不代表执行先后'
                : '进行中的节点置顶，其余按发生时间倒序（最近在前）'}
          </span>
        </div>
        <div className={clsx(taskDetailTimelineStyles['debug-timeline-list'])}>
          {frontierOnTop && !timelineLoading && frontierRow}
          {timelineLoading ? (
            <TaskExecutionTimeline items={[]} loading />
          ) : storeError ? (
            <div className={clsx(taskDetailTimelineStyles['debug-error-line'])} role="alert">
              <DebugIcon name="alert-circle" size={15} />
              <span>{storeError.message}</span>
            </div>
          ) : timelineEvents.length === 0 ? (
            <EmptyState
              className={clsx(taskDetailTimelineStyles['debug-timeline-empty'])}
              scene="no-data"
              size="compact"
              title="暂无可展示的 NodeJob"
            />
          ) : searching && arranged.items.length === 0 ? (
            <EmptyState
              className={clsx(taskDetailTimelineStyles['debug-timeline-empty'])}
              scene="no-data"
              size="compact"
              title="没有匹配的节点"
            />
          ) : (
            <TaskExecutionTimeline
              items={arranged.items}
              sections={sections}
              selectedId={selectedId}
              onSelect={(event) => openEvent(event.id)}
              isLast={(_, index) =>
                (frontierOnTop || !frontierRow) && index === arranged.items.length - 1
              }
              renderMarker={(event) => (
                <DebugIcon
                  name={markerGlyph[event.status as EventStatus] ?? markerGlyph.unknown}
                  size={13}
                />
              )}
            />
          )}
          {!frontierOnTop && frontierRow}
        </div>
      </div>
    </section>
  )
}
