import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { Segmented, Switch } from 'antd'
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
} from './taskDetailModel'
import type { useTaskDetailController } from './useTaskDetailController'

type Controller = ReturnType<typeof useTaskDetailController>

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
  const arranged = useMemo(
    () => arrangeTimeline(timelineEvents, { order, showUnexecuted, showHistory }),
    [order, showHistory, showUnexecuted, timelineEvents],
  )
  const collapsedTotal =
    arranged.collapsed.canceled + arranged.collapsed.skipped + arranged.collapsed.pending
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
                title: '取消该任务？未执行的节点不再执行，已开始的设备动作按 OS 规则收尾。',
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
          {collapsedTotal > 0 && (
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
          {order === 'steps' && (
            <span className={clsx(taskDetailTimelineStyles['debug-timeline-hint'])}>
              步骤顺序只反映 DAG 结构，不代表执行先后
            </span>
          )}
        </div>
        <div className={clsx(taskDetailTimelineStyles['debug-timeline-list'])}>
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
          ) : (
            <TaskExecutionTimeline
              items={arranged.items}
              selectedId={selectedId}
              onSelect={(event) => openEvent(event.id)}
              isLast={(_, index) =>
                readyFrontier.length <= 1 && index === arranged.items.length - 1
              }
              renderMarker={(event) => (
                <DebugIcon
                  name={markerGlyph[event.status as EventStatus] ?? markerGlyph.unknown}
                  size={13}
                />
              )}
            />
          )}
          {readyFrontier.length > 1 && (
            <TaskParallelTimelineRow
              candidates={readyFrontier}
              open={parallelOpen}
              onOpen={() => setParallelOpen(true)}
            />
          )}
        </div>
      </div>
    </section>
  )
}
