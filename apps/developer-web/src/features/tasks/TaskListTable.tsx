import { clsx } from 'clsx'
import { Button, Modal, Space, Table, Tooltip, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { useState } from 'react'
import { StatusBadge, TaskProgress } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { AppIcon } from '../../components/ui/Icon'
import { TableText } from '../../components/ui/TableText'
import { displayTime, type TaskListRow } from './taskDomain'
import taskListStyles from './TaskList.module.scss'

export function TaskListTable({
  rows,
  onOpen,
  onDone,
}: {
  rows: readonly TaskListRow[]
  onOpen: (row: TaskListRow) => void
  onDone: () => void
}) {
  const columns: TableColumnsType<TaskListRow> = [
    {
      title: '任务',
      key: 'name',
      width: 300,
      render: (_, row) => (
        <div className={clsx(appShellStyles['primary-cell'], sharedStyles['primary-cell'])}>
          <button
            type="button"
            className={clsx(taskListStyles['task-name-link'])}
            onClick={() => onOpen(row)}
            aria-label={`查看任务 ${row.name}`}
          >
            <TableText text={row.name} />
          </button>
          <div className={clsx(taskListStyles['task-uuid-cell'])}>
            <TableText
              className={clsx(sharedStyles['table-secondary-text'])}
              text={row.task.taskUuid}
            />
            <CopyTaskUuidButton task={row} />
          </div>
        </div>
      ),
    },
    {
      title: '工作流',
      key: 'workflowName',
      width: 220,
      render: (_, row) => <TableText text={row.workflowName} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 125,
      render: (value) => <StatusBadge status={value} />,
    },
    {
      title: '进度',
      key: 'progress',
      width: 150,
      render: (_, row) => (
        <TaskProgress
          className={clsx(sharedStyles['progress-cell'])}
          metaClassName={clsx(sharedStyles['muted-cell'])}
          percent={row.progress}
          completed={row.completedJobs}
          total={row.totalJobs}
        />
      ),
    },
    {
      title: '时间',
      key: 'time',
      width: 190,
      render: (_, row) => (
        <span className={clsx(sharedStyles['muted-cell'])}>{displayTime(row.task.createdAt)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title="查看">
            <Button
              type="text"
              className={clsx(sharedStyles['icon-button'])}
              aria-label={`查看任务 ${row.name}`}
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => onOpen(row)}
            />
          </Tooltip>
          <AbortTaskButton taskUuid={row.task.taskUuid} status={row.status} onDone={onDone} />
        </Space>
      ),
    },
  ]

  return (
    <Table
      className={clsx(sharedStyles['task-list-table'], taskListStyles['task-table'])}
      tableLayout="fixed"
      rowKey={(row) => row.task.taskUuid}
      columns={columns}
      dataSource={[...rows]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无任务" /> }}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
    />
  )
}

function CopyTaskUuidButton({ task }: { task: TaskListRow }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task.task.taskUuid)
      message.success('UUID 已复制')
    } catch {
      message.error('复制失败，请检查浏览器剪贴板权限')
    }
  }

  return (
    <Tooltip title="复制 UUID">
      <Button
        type="text"
        className={clsx(taskListStyles['task-uuid-copy'], sharedStyles['icon-button'])}
        aria-label={`复制任务 ${task.name} 的 UUID`}
        icon={<AppIcon name="general/copy-01" size={14} />}
        onClick={copy}
      />
    </Tooltip>
  )
}

function AbortTaskButton({
  taskUuid,
  status,
  onDone,
}: {
  taskUuid: string
  status: string
  onDone: () => void
}) {
  const { backend } = useBackend()
  const [busy, setBusy] = useState(false)
  const available = ['running', 'waiting', 'attention'].includes(status)
  const abort = () =>
    Modal.confirm({
      title: '中止任务？',
      content: '将向后端发送 cancel 命令，最终状态以运行时回传为准。',
      okText: '中止',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBusy(true)
        try {
          const receipt = await backend.core.executionControl.sendTaskCommand(taskUuid, {
            type: 'cancel',
            idempotencyKey: `studio-${taskUuid}-cancel-${Date.now()}`,
          })
          message.success(receipt.accepted ? '中止命令已接受，等待 OS 生效' : '中止命令未被接受')
          onDone()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '中止失败')
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <Tooltip title={available ? '中止' : '当前任务不可中止'}>
      <Button
        type="text"
        danger
        disabled={!available}
        loading={busy}
        className={clsx(sharedStyles['icon-button'])}
        aria-label="中止任务"
        icon={<AppIcon name="media/stop-circle" size={18} />}
        onClick={abort}
      />
    </Tooltip>
  )
}
