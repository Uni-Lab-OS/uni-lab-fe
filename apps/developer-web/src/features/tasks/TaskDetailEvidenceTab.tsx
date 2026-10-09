import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { type TimelineEvent, formatJson } from './taskDetailModel'

export function EvidenceTab({
  event,
  job,
}: {
  event: TimelineEvent
  job: {
    readonly param: Readonly<Record<string, unknown>>
    readonly returnInfo: Readonly<Record<string, unknown>>
    readonly attempt: number
  } | null
}) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div className={clsx(taskDetailInspectorStyles['debug-detail-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>运行输入</h3>
        </div>
        <pre className={clsx(taskDetailInspectorStyles['debug-code-block'])}>
          {formatJson(job?.param ?? {})}
        </pre>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-detail-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>当前输出</h3>
        </div>
        <pre
          className={clsx(
            taskDetailInspectorStyles['debug-code-block'],
            taskDetailInspectorStyles['debug-output-block'],
          )}
        >
          {formatJson(job?.returnInfo ?? {})}
        </pre>
        <dl className={clsx(taskDetailInspectorStyles['debug-output-meta'])}>
          <div>
            <dt>反馈</dt>
            <dd>{event.status === 'success' ? '已返回成功状态' : '尚未形成终态回执'}</dd>
          </div>
          <div>
            <dt>尝试次数</dt>
            <dd>{job?.attempt ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
