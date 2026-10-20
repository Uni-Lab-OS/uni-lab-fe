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
  const failed = event.status === 'failed'
  const failure = failed ? readJobErrorText(job) : null
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-intervention-card'],
          intervention
            ? 'debug-intervention-manual'
            : unknown || failed
              ? taskDetailInspectorStyles['debug-intervention-unknown']
              : taskDetailInspectorStyles['debug-intervention-waiting'],
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-intervention-title'])}>
          <DebugIcon
            name={
              intervention
                ? 'user-check'
                : unknown
                  ? 'help-circle'
                  : failed
                    ? 'alert-triangle'
                    : 'info'
            }
            size={18}
          />
          <div>
            <strong>
              {intervention
                ? '需要人工确认'
                : unknown
                  ? '结果待核对'
                  : failed
                    ? '动作执行失败'
                    : event.status === 'waiting'
                      ? '等待资源'
                      : '没有待处理异常'}
            </strong>
            {failed && (
              <span>
                处理入口（重新执行该动作、取消任务、人工处置）见详情顶部与页面顶部的工站错误处置。
              </span>
            )}
          </div>
        </div>
        {failure && (
          <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
            <span>OS 错误</span>
            <strong>{failure}</strong>
          </div>
        )}
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

/** OS error_info 的可读文本：优先取各条的 message，其余原样序列化；没有时为 null。 */
function readJobErrorText(job: WorkflowNodeJobDetail | null): string | null {
  const items = job?.errorInfo ?? []
  if (items.length === 0) return null
  return items
    .map((item) => {
      if (typeof item === 'string') return item
      const message =
        item && typeof item === 'object' ? (item as Record<string, unknown>).message : undefined
      return typeof message === 'string' ? message : JSON.stringify(item)
    })
    .join('；')
}
