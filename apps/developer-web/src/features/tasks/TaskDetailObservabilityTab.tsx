import { clsx } from 'clsx'
import type { NodeJobFeedbackPage } from '@unilab-fe/core'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'

export function ObservabilityTab({
  feedback,
}: {
  feedback: NodeJobFeedbackPage | null | undefined
}) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div className={clsx(taskDetailInspectorStyles['debug-trace-banner'])}>
        <span className={clsx(taskDetailInspectorStyles['debug-trace-id'])}>Trace / feedback</span>
        <span>{feedback?.items.length ?? 0} 条反馈</span>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-observe-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>反馈事件</h3>
        </div>
        <div className={clsx(taskDetailInspectorStyles['debug-event-log'])}>
          {feedback?.items.length ? (
            feedback.items.map((item) => (
              <span key={item.feedbackUuid}>
                <b>#{item.sequence}</b>
                <em>{item.feedbackType}</em>
                <small>{item.description ?? JSON.stringify(item.data)}</small>
              </span>
            ))
          ) : (
            <span className={clsx(taskDetailInspectorStyles['debug-event-log-empty'])}>
              <small>暂无反馈事件。</small>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
