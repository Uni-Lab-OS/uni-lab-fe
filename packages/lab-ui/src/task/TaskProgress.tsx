import { clsx } from 'clsx'
import taskStyles from '../task.module.scss'
import type { HTMLAttributes } from 'react'

export interface TaskProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  readonly percent: number | null | undefined
  readonly completed: number
  readonly total: number
  readonly variant?: 'inline' | 'bar'
  readonly metaClassName?: string
}

/** 任务进度的纯呈现组件；percent 为空时明确显示 OS 未提供，而不是伪造 0%。 */
export function TaskProgress({
  percent,
  completed,
  total,
  variant = 'inline',
  className,
  metaClassName,
  ...props
}: TaskProgressProps) {
  const normalizedPercent =
    typeof percent === 'number' && Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : null
  const meta = `${completed}/${total} 节点`
  return (
    <div
      className={clsx(
        taskStyles['lab-ui-task-progress'],
        taskStyles[`lab-ui-task-progress--${variant}`],
        className,
      )}
      {...props}
    >
      <span className={clsx(taskStyles['lab-ui-task-progress__value'])}>
        {normalizedPercent == null ? '—' : `${normalizedPercent}%`}
      </span>
      <span className={clsx(taskStyles['lab-ui-task-progress__meta'], metaClassName)}>{meta}</span>
      {variant === 'bar' && (
        <div
          className={clsx(
            taskStyles['lab-ui-task-progress__track'],
            normalizedPercent == null && taskStyles['lab-ui-task-progress__track--unavailable'],
          )}
          role="progressbar"
          aria-label={
            normalizedPercent == null ? '任务进度未提供' : `任务进度 ${normalizedPercent}%，${meta}`
          }
          aria-valuemin={0}
          aria-valuemax={100}
          {...(normalizedPercent == null ? {} : { 'aria-valuenow': normalizedPercent })}
        >
          <span
            className={clsx(taskStyles['lab-ui-task-progress__fill'])}
            style={{ width: `${normalizedPercent ?? 0}%` }}
          />
        </div>
      )}
    </div>
  )
}
