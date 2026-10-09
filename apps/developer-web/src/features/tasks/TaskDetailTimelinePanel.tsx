import { clsx } from 'clsx'
import { EmptyState } from '@unilab/design-v2'
import taskDetailPageStyles from './TaskDetailPage.module.scss'
import { TaskExecutionTimeline } from './TaskExecutionTimeline'
import { TaskParallelTimelineRow } from './TaskParallelTimelineRow'
import { DebugActionButton, DebugIcon } from './TaskDetailIcons'
import { type EventStatus, markerGlyph } from './taskDetailModel'
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
  const commandFeedbackTone =
    storeError || storeCommand?.lifecycle === 'rejected'
      ? taskDetailPageStyles['is-error']
      : storeStatus === 'commanding'
        ? taskDetailPageStyles['is-pending']
        : taskDetailPageStyles['is-success']
  const commandFeedbackIcon =
    storeError || storeCommand?.lifecycle === 'rejected'
      ? 'alert-circle'
      : storeStatus === 'commanding'
        ? 'activity'
        : 'check-circle'

  return (
    <section className={clsx(taskDetailPageStyles['debug-workspace'])}>
      <div className={clsx(taskDetailPageStyles['debug-timeline-panel'])}>
        <div className={clsx(taskDetailPageStyles['debug-panel-heading'])}>
          <div>
            <h2>执行时间线</h2>
          </div>
          <div
            className={clsx(taskDetailPageStyles['debug-timeline-actions'])}
            aria-label="任务调试操作"
          >
            {controlStatus === 'active' ? (
              <DebugActionButton
                label="暂停任务"
                className="debug-timeline-action-pause"
                disabled={!viewModel?.controls.canPause || storeStatus === 'commanding'}
                onClick={() => controller.submitCommand('pause')}
              >
                <DebugIcon name="pause" size={17} />
              </DebugActionButton>
            ) : (
              <DebugActionButton
                label="继续任务"
                className="debug-timeline-action-primary"
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
              className="debug-timeline-action-danger"
              disabled={!viewModel?.controls.canCancel || storeStatus === 'commanding'}
              onClick={() => controller.submitCommand('cancel')}
            >
              <DebugIcon name="square" size={16} />
            </DebugActionButton>
          </div>
        </div>
        {commandResultMessage && (
          <div
            className={clsx(taskDetailPageStyles['debug-command-feedback'], commandFeedbackTone)}
            role="status"
          >
            <DebugIcon name={commandFeedbackIcon} size={15} />
            <span>{commandResultMessage}</span>
          </div>
        )}
        <div className={clsx(taskDetailPageStyles['debug-timeline-list'])}>
          {timelineLoading ? (
            <TaskExecutionTimeline items={[]} loading />
          ) : storeError ? (
            <div className={clsx(taskDetailPageStyles['debug-error-line'])} role="alert">
              <DebugIcon name="alert-circle" size={15} />
              <span>{storeError.message}</span>
            </div>
          ) : timelineEvents.length === 0 ? (
            <EmptyState
              className={clsx(taskDetailPageStyles['debug-timeline-empty'])}
              scene="no-data"
              size="compact"
              title="暂无可展示的 NodeJob"
            />
          ) : (
            <TaskExecutionTimeline
              items={timelineEvents}
              selectedId={selectedId}
              onSelect={(event) => openEvent(event.id)}
              isLast={(_, index) =>
                readyFrontier.length <= 1 && index === timelineEvents.length - 1
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
