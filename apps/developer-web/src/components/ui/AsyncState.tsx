import { clsx } from 'clsx'
import styles from './AsyncState.module.scss'
import { Alert, Skeleton } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import type { ReactNode } from 'react'

export function AsyncState({
  loading,
  error,
  onRetry,
  children,
  empty = false,
  emptyDescription = '暂无数据',
  variant = 'default',
  tableColumns = 5,
  loadingContent,
}: {
  loading: boolean
  error?: Error
  onRetry: () => void
  children: ReactNode
  empty?: boolean
  emptyDescription?: string
  variant?: 'default' | 'table'
  tableColumns?: number
  loadingContent?: ReactNode
}) {
  if (loading)
    return (
      <div
        className={clsx(
          styles['async-state'],
          variant === 'table' ? styles['async-state--table'] : '',
        )}
      >
        {loadingContent ??
          (variant === 'table' ? (
            <TableSkeleton columns={tableColumns} />
          ) : (
            <Skeleton active paragraph={{ rows: 5 }} />
          ))}
      </div>
    )
  if (error)
    return (
      <Alert
        className={clsx(styles['async-error'])}
        type="error"
        showIcon
        message="数据加载失败"
        description={presentErrorMessage(error)}
        action={
          <button type="button" className={clsx(styles['text-action'])} onClick={onRetry}>
            重试
          </button>
        }
      />
    )
  if (empty) return <EmptyState className={clsx(styles['async-empty'])} title={emptyDescription} />
  return <>{children}</>
}

function presentErrorMessage(error: Error): string {
  const match = error.message.match(/^develop_task_conflict:([^:]+):([^:]+)$/)
  if (!match) return error.message
  const [, taskUuid, status] = match
  const statusLabel =
    status === 'pending'
      ? '等待中'
      : status === 'running'
        ? '执行中'
        : status === 'canceling'
          ? '取消中'
          : status
  return `开发模式已有未结束的任务（${statusLabel}，任务 ID：${taskUuid}），请先在任务列表中结束或取消该任务后再重试。`
}

function TableSkeleton({ columns }: { columns: number }) {
  const safeColumns = Math.max(2, Math.floor(columns))
  return (
    <div className={clsx(styles['table-skeleton'])} role="status" aria-label="正在加载表格">
      {Array.from({ length: 6 }, (_, rowIndex) => (
        <div
          className={clsx(styles['table-skeleton-row'])}
          key={rowIndex}
          style={{
            gridTemplateColumns: `minmax(220px, 2fr) repeat(${safeColumns - 1}, minmax(76px, 1fr))`,
          }}
        >
          {Array.from({ length: safeColumns }, (_, columnIndex) => (
            <span
              className={clsx(
                styles['table-skeleton-cell'],
                columnIndex === 0 ? styles['table-skeleton-cell--primary'] : '',
              )}
              key={columnIndex}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
