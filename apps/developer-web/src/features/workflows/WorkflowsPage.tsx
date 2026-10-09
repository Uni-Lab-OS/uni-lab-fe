import { clsx } from 'clsx'
import workflowListStyles from './WorkflowList.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Input, Modal, Space, Table, Tabs, Tag, Tooltip, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { useEffect, useMemo, useState } from 'react'
import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import type { StudioRoute } from '../../components/AppShell'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { TableText } from '../../components/ui/TableText'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { workflowStatusLabel } from './workflowPresentation'
import { WorkflowDebugPage } from './WorkflowDebugPage'
import { WorkflowDetail } from './WorkflowDetail'

export function WorkflowsPage({
  onNavigate,
}: {
  onNavigate: (route: StudioRoute, search?: string) => void
}) {
  const { backend } = useBackend()
  const query = useBackendQuery('workflow-catalog', (current) =>
    current.core.workflowDefinitions.listPublishedRevisions({
      page: 1,
      pageSize: 100,
      allPages: true,
      status: 'all',
    }),
  )
  const [kind, setKind] = useState<'workflow' | 'experiment_operation'>('workflow')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('workflow'),
  )
  const [debugUuid, setDebugUuid] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('debugWorkflow'),
  )

  // SZLab 当前发布的标准物料转运属于“实验操作”类型。首屏不能固定
  // 假设一定存在 workflow，否则真实后端有数据时仍会显示空状态。
  useEffect(() => {
    if (!query.data?.length) return
    if (query.data.some((item) => item.workflowType === kind)) return
    const firstAvailableKind = query.data[0]?.workflowType
    if (firstAvailableKind) setKind(firstAvailableKind)
  }, [kind, query.data])

  useEffect(() => {
    if (!debugUuid || !window.location.search.includes('debugWorkflow')) return
    window.history.replaceState({}, '', '/workflows')
  }, [debugUuid])

  useEffect(() => {
    const syncSelectedWorkflow = () => {
      setSelected(new URLSearchParams(window.location.search).get('workflow'))
    }
    window.addEventListener('popstate', syncSelectedWorkflow)
    return () => window.removeEventListener('popstate', syncSelectedWorkflow)
  }, [])

  const rows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return (query.data ?? []).filter((item) => {
      const matchesKind = item.workflowType === kind
      const matchesKeyword =
        !normalized || `${item.name} ${item.workflowUuid}`.toLowerCase().includes(normalized)
      return matchesKind && matchesKeyword
    })
  }, [kind, keyword, query.data])

  if (debugUuid) {
    return (
      <WorkflowDebugPage
        workflowUuid={debugUuid}
        onBack={() => setDebugUuid(null)}
        onNavigate={onNavigate}
      />
    )
  }
  if (selected) {
    return (
      <WorkflowDetail
        workflowUuid={selected}
        onBack={() => {
          window.history.replaceState({}, '', '/workflows')
          setSelected(null)
        }}
        onDebug={setDebugUuid}
      />
    )
  }

  const openWorkflow = (workflowUuid: string) => {
    window.history.pushState({}, '', `/workflows?workflow=${encodeURIComponent(workflowUuid)}`)
    setSelected(workflowUuid)
  }

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
            onClick={() => openWorkflow(row.workflowUuid)}
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
              onClick={() => openWorkflow(row.workflowUuid)}
            />
          </Tooltip>
          <Tooltip title="调试">
            <Button
              type="text"
              className={clsx(sharedStyles['icon-button'])}
              aria-label={`调试工作流 ${row.name}`}
              icon={<AppIcon name="media/play-circle" size={18} />}
              onClick={() => setDebugUuid(row.workflowUuid)}
            />
          </Tooltip>
          <DeleteWorkflowButton workflow={row} onDeleted={query.reload} />
        </Space>
      ),
    },
  ]

  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        appShellStyles['workflow-list-page'],
      )}
    >
      <PageHeader title="工作流" />
      <section
        className={clsx(
          appShellStyles['data-section'],
          sharedStyles['data-section'],
          workflowListStyles['workflow-data-section'],
        )}
      >
        <div
          className={clsx(
            appShellStyles['data-section-toolbar'],
            sharedStyles['data-section-toolbar'],
            workflowListStyles['workflow-toolbar'],
            appShellStyles['workflow-toolbar'],
          )}
        >
          <Tabs
            className={clsx(workflowListStyles['workflow-tabs'])}
            activeKey={kind}
            onChange={(value) => setKind(value as typeof kind)}
            items={[
              {
                key: 'experiment_operation',
                label: `实验操作 ${
                  query.data?.filter((item) => item.workflowType === 'experiment_operation')
                    .length ?? 0
                }`,
              },
              {
                key: 'workflow',
                label: `工作流 ${
                  query.data?.filter((item) => item.workflowType === 'workflow').length ?? 0
                }`,
              },
            ]}
          />
          <Space>
            <Input
              allowClear
              className={clsx(sharedStyles['search-input'])}
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder="搜索名称或 UUID"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Space>
        </div>
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.reload}
          empty={!query.loading && rows.length === 0}
          emptyDescription="当前后端没有工作流"
          variant="table"
          tableColumns={4}
        >
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
        </AsyncState>
      </section>
    </div>
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
