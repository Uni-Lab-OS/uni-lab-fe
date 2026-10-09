import { clsx } from 'clsx'
import { Button, Modal, Space, Table, Tag, Tooltip, message } from 'antd'
import type { TableColumnsType } from 'antd'
import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'
import { EmptyState } from '@unilab/design-v2'
import { useState } from 'react'
import { useBackend } from '../../app/BackendProvider'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { AppIcon } from '../../components/ui/Icon'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { TableText } from '../../components/ui/TableText'
import workflowListStyles from './WorkflowList.module.scss'
import { workflowStatusLabel } from './workflowPresentation'

export function WorkflowCatalogTable({
  rows,
  onOpen,
  onDebug,
  onDeleted,
}: {
  rows: readonly PublishedWorkflowRevisionSummary[]
  onOpen: (workflowUuid: string) => void
  onDebug: (workflowUuid: string) => void
  onDeleted: () => void
}) {
  const columns: TableColumnsType<PublishedWorkflowRevisionSummary> = [
    {
      title: '名称',
      key: 'name',
      render: (_, row) => (
        <div className={clsx(appShellStyles['primary-cell'], sharedStyles['primary-cell'])}>
          <button
            type="button"
            className={clsx(
              workflowListStyles['workflow-name-link'],
              sharedStyles['workflow-name-link'],
            )}
            onClick={() => onOpen(row.workflowUuid)}
          >
            <TableText text={row.name} />
          </button>
          <div
            className={clsx(
              workflowListStyles['workflow-uuid-cell'],
              sharedStyles['workflow-uuid-cell'],
            )}
          >
            <TableText
              className={clsx(sharedStyles['table-secondary-text'])}
              text={row.workflowUuid}
            />
            <CopyWorkflowUuidButton workflow={row} />
          </div>
        </div>
      ),
    },
    {
      title: '版本',
      dataIndex: 'revision',
      align: 'center',
      width: 90,
      render: (value) => `v${value}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      align: 'center',
      width: 110,
      render: (value) =>
        value === 'published' ? (
          <Tag color="green">已发布</Tag>
        ) : value === 'source' ? (
          <Tag className={clsx(sharedStyles['status-badge'])} color="default">
            未发布
          </Tag>
        ) : (
          <StatusBadge status={value} label={workflowStatusLabel(value)} />
        ),
    },
    {
      title: '操作',
      key: 'actions',
      align: 'center',
      width: 170,
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title="查看">
            <Button
              type="text"
              className={clsx(sharedStyles['icon-button'])}
              aria-label={`查看工作流 ${row.name}`}
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => onOpen(row.workflowUuid)}
            />
          </Tooltip>
          <Tooltip title="调试">
            <Button
              type="text"
              className={clsx(sharedStyles['icon-button'])}
              aria-label={`调试工作流 ${row.name}`}
              icon={<AppIcon name="media/play-circle" size={18} />}
              onClick={() => onDebug(row.workflowUuid)}
            />
          </Tooltip>
          <DeleteWorkflowButton workflow={row} onDeleted={onDeleted} />
        </Space>
      ),
    },
  ]

  return (
    <Table
      className={clsx(workflowListStyles['workflow-table'])}
      rowKey="workflowUuid"
      columns={columns}
      dataSource={[...rows]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无工作流" /> }}
      pagination={{
        pageSize: 10,
        showSizeChanger: false,
        showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
      }}
    />
  )
}

function CopyWorkflowUuidButton({ workflow }: { workflow: PublishedWorkflowRevisionSummary }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workflow.workflowUuid)
      message.success('UUID 已复制')
    } catch {
      message.error('复制失败，请检查浏览器剪贴板权限')
    }
  }

  return (
    <Tooltip title="复制 UUID">
      <Button
        type="text"
        className={clsx(workflowListStyles['workflow-uuid-copy'], sharedStyles['icon-button'])}
        aria-label={`复制工作流 ${workflow.name} 的 UUID`}
        icon={<AppIcon name="general/copy-01" size={14} />}
        onClick={copy}
      />
    </Tooltip>
  )
}

function DeleteWorkflowButton({
  workflow,
  onDeleted,
}: {
  workflow: PublishedWorkflowRevisionSummary
  onDeleted: () => void
}) {
  const { backend } = useBackend()
  const [busy, setBusy] = useState(false)
  const available = backend.getCapabilityStatus('workflow.editDefinitions').available
  const remove = () =>
    Modal.confirm({
      title: `删除“${workflow.name}”？`,
      content: '该操作会调用后端删除工作流定义，请确认后端已允许此操作。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBusy(true)
        try {
          await backend.core.workflowDefinitions.deleteWorkflowDefinition(workflow.workflowUuid)
          message.success('工作流已删除')
          onDeleted()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败')
        } finally {
          setBusy(false)
        }
      },
    })

  return (
    <Tooltip title={available ? '删除' : '当前后端不支持删除'}>
      <Button
        type="text"
        danger
        disabled={!available}
        loading={busy}
        className={clsx(sharedStyles['icon-button'])}
        aria-label={`删除工作流 ${workflow.name}`}
        icon={<AppIcon name="general/trash-01" size={18} />}
        onClick={remove}
      />
    </Tooltip>
  )
}
