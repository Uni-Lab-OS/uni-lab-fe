import { clsx } from 'clsx'
import workflowListStyles from './WorkflowList.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Input, Select, Space, Tabs } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'
import type { StudioRoute } from '../../components/AppShell'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import {
  countWorkflowKinds,
  filterWorkflowCatalog,
  type WorkflowCatalogStatusFilter,
} from './workflowCatalogModel'
import { WorkflowCatalogTable } from './WorkflowCatalogTable'
import { WorkflowDebugPage } from './WorkflowDebugPage'
import { WorkflowDetail } from './WorkflowDetail'

export function WorkflowsPage({
  onNavigate,
}: {
  onNavigate: (route: StudioRoute, search?: string) => void
}) {
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
  const [status, setStatus] = useState<WorkflowCatalogStatusFilter>('all')
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

  const rows = useMemo(
    () => filterWorkflowCatalog(query.data ?? [], kind, keyword, status),
    [kind, keyword, query.data, status],
  )
  const kindCounts = useMemo(() => countWorkflowKinds(query.data), [query.data])

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
                label: `实验操作 ${kindCounts.experiment_operation}`,
              },
              {
                key: 'workflow',
                label: `工作流 ${kindCounts.workflow}`,
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
            <Select
              className={clsx(sharedStyles['status-select'])}
              value={status}
              onChange={(value) => setStatus(value as WorkflowCatalogStatusFilter)}
              aria-label="按发布状态筛选工作流"
              options={[
                { value: 'all', label: '全部' },
                {
                  value: 'published' satisfies PublishedWorkflowRevisionSummary['status'],
                  label: '已发布',
                },
                {
                  value: 'source' satisfies PublishedWorkflowRevisionSummary['status'],
                  label: '未发布',
                },
              ]}
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
          <WorkflowCatalogTable
            rows={rows}
            onOpen={openWorkflow}
            onDebug={setDebugUuid}
            onDeleted={query.reload}
          />
        </AsyncState>
      </section>
    </div>
  )
}
