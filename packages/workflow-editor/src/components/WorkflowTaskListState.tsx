import type { JSX } from 'react'

export type TaskListStateKind = 'loading' | 'error' | 'empty' | 'filtered'

export interface TaskListStateProps {
  kind: TaskListStateKind
  title: string
  detail?: string
  hint?: string
  actionLabel?: string
  onAction?: () => void
}

/** 渲染任务列表的加载、错误、首次使用或筛选无结果状态。 */
export function TaskListState({
  kind,
  title,
  detail,
  hint,
  actionLabel,
  onAction
}: TaskListStateProps): JSX.Element {
  const error = kind === 'error'
  return (
    <div
      className={`workflow-task-list__state is-${kind}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
    >
      <TaskListStateVisual kind={kind} />
      <div className="workflow-task-list__state-copy">
        <strong>{title}</strong>
        {detail ? <span>{detail}</span> : null}
        {hint ? (
          <span className="workflow-task-list__state-hint">{hint}</span>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  )
}

/** 渲染不依赖外部图标库的任务状态示意图。 */
function TaskListStateVisual({
  kind
}: {
  kind: TaskListStateKind
}): JSX.Element {
  if (kind === 'loading') {
    return (
      <span
        className="workflow-task-list__state-visual"
        aria-hidden="true"
      >
        <i className="workflow-task-list__state-spinner" />
      </span>
    )
  }

  return (
    <span
      className="workflow-task-list__state-visual"
      aria-hidden="true"
    >
      {kind === 'empty' ? (
        <svg viewBox="0 0 56 56" fill="none" focusable="false">
          <rect x="9" y="11" width="38" height="34" rx="7" />
          <path d="M18 21h14M18 28h10M18 35h8" />
          <path d="m35 30 8 5-8 5V30Z" />
        </svg>
      ) : kind === 'filtered' ? (
        <svg viewBox="0 0 56 56" fill="none" focusable="false">
          <circle cx="25" cy="25" r="12" />
          <path d="m34 34 10 10M19 21h12M19 27h8" />
        </svg>
      ) : (
        <svg viewBox="0 0 56 56" fill="none" focusable="false">
          <path d="M28 9 48 45H8L28 9Z" />
          <path d="M28 21v11M28 38v1" />
        </svg>
      )}
    </span>
  )
}
