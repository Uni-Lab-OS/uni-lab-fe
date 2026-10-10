import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import { readManualConfirmation, type TimelineEvent } from './taskDetailModel'
import type { WorkflowNodeJobDetail } from '@unilab-fe/core'

export function IssuesTab({
  event,
  job = null,
}: {
  event: TimelineEvent
  job?: WorkflowNodeJobDetail | null
}) {
  const intervention =
    event.status === 'manual' || readManualConfirmation(job)?.status === 'pending'
  const unknown = event.status === 'unknown'
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-intervention-card'],
          intervention
            ? 'debug-intervention-manual'
            : unknown
              ? taskDetailInspectorStyles['debug-intervention-unknown']
              : taskDetailInspectorStyles['debug-intervention-waiting'],
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-intervention-title'])}>
          <DebugIcon
            name={intervention ? 'user-check' : unknown ? 'help-circle' : 'info'}
            size={18}
          />
          <div>
            <strong>
              {intervention
                ? '需要人工确认'
                : unknown
                  ? '结果待核对'
                  : event.status === 'waiting'
                    ? '等待资源'
                    : '没有待处理异常'}
            </strong>
          </div>
        </div>
        {event.description && (
          <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
            <span>状态</span>
            <strong>{event.description}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
