import { cx } from './overviewClassNames'
import { Button, Input, Select, Space, Table, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { AppIcon } from '../../components/ui/Icon'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatDateTime, type TaskRow } from './taskPresentation'
import { TableText } from '../../components/ui/TableText'

interface TaskTableProps {
  rows: readonly TaskRow[]
  keyword: string
  status: string
  onKeywordChange: (value: string) => void
  onStatusChange: (value: string) => void
  onView: (row: TaskRow) => void
  onAbort: (row: TaskRow) => void
}

export function TaskTable({
  rows,
  keyword,
  status,
  onKeywordChange,
  onStatusChange,
  onView,
  onAbort,
}: TaskTableProps) {
  const hasTableFilter = Boolean(keyword.trim()) || status !== 'all'
  const columns: TableColumnsType<TaskRow> = [
    {
      title: '任务',
      key: 'name',
      width: 250,
      render: (_, row) => (
        <div className={cx('primary-cell')}>
          <button
            type="button"
            className={cx('primary-cell-link')}
            aria-label={`查看任务 ${row.name}`}
            onClick={() => onView(row)}
          >
            <TableText text={row.name} />
          </button>
        </div>
      ),
    },
    {
      title: '工作流',
      key: 'workflowName',
      width: 220,
      render: (_, row) => (
        <div className={cx('overview-table-text-cell')}>
          <TableText text={row.workflowName} />
        </div>
      ),
    },
    {
      title: '优先级',
      dataIndex: ['task', 'priority'],
      width: 90,
      render: (value: string | null) => <PriorityLabel value={value} />,
    },
    {
      title: '进度',
      key: 'progress',
      align: 'center',
      width: 150,
      render: (_, row) => (
        <div className={cx('progress-cell')}>
          <span>{row.progress == null ? '—' : `${row.progress}%`}</span>
          <StatusBadge status={row.status} />
        </div>
      ),
    },
    {
      title: '时间',
      key: 'time',
      align: 'center',
      width: 175,
      render: (_, row) => (
        <time className={cx('muted-cell')} dateTime={row.createdAt}>
          {row.createdAt ? formatDateTime(row.createdAt) : '未提供'}
        </time>
      ),
    },
    {
      title: '操作',
      key: 'operation',
      align: 'center',
      width: 120,
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title="查看任务">
            <Button
              className={cx('icon-button')}
              type="text"
              icon={<AppIcon name="general/eye" size={18} />}
              aria-label={`查看任务 ${row.name}`}
              onClick={() => onView(row)}
            />
          </Tooltip>
          <Tooltip title="中止任务">
            <Button
              className={cx('icon-button')}
              type="text"
              danger
              disabled={!['running', 'waiting', 'attention'].includes(row.status)}
              icon={<AppIcon name="media/stop-circle" size={16} />}
              aria-label={`中止任务 ${row.name}`}
              onClick={() => onAbort(row)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <section className={cx('data-section')}>
      <div className={cx('data-section-toolbar')}>
        <div className={cx('section-title')}>
          <h2>所有任务</h2>
        </div>
        <Space>
          <Input
            className={cx('search-input')}
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索任务"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
          <Select
            className={cx('status-select')}
            value={status}
            onChange={onStatusChange}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'waiting', label: '等待中' },
              { value: 'running', label: '执行中' },
              { value: 'attention', label: '异常' },
              { value: 'completed', label: '已完成' },
            ]}
          />
        </Space>
      </div>
      <Table<TaskRow>
        rowKey={(row) => row.task.taskUuid}
        columns={columns}
        dataSource={[...rows]}
        tableLayout="fixed"
        locale={{
          emptyText: (
            <EmptyState
              scene={hasTableFilter ? 'no-results' : 'no-data'}
              size="compact"
              title={hasTableFilter ? '没有匹配的任务' : '暂无任务'}
            />
          ),
        }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </section>
  )
}

function PriorityLabel({ value }: { value: string | null | undefined }) {
  const normalized = value?.toLowerCase() ?? 'normal'
  const label =
    normalized === 'urgent' || normalized === 'critical'
      ? '紧急'
      : normalized === 'high'
        ? '高'
        : normalized === 'low'
          ? '低'
          : normalized === 'normal'
            ? '普通'
            : (value ?? '普通')
  const tone =
    normalized === 'urgent' || normalized === 'critical'
      ? 'urgent'
      : normalized === 'high'
        ? 'high'
        : normalized === 'low'
          ? 'low'
          : 'normal'
  return (
    <span className={cx(`priority-label priority-label--${tone}`)}>
      <span className={cx('priority-dot')} aria-hidden="true" />
      {label}
    </span>
  )
}
