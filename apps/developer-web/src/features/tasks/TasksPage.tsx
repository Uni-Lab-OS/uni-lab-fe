import { clsx } from 'clsx'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Input, Select, Space, Tooltip } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { filterTaskListRows, toTaskListRow, type TaskListRow } from './taskDomain'
import { TaskListTable } from './TaskListTable'
import { TaskDetailPage } from './TaskDetailPage'

export function TasksPage() {
  const query = useBackendQuery('task-presentations', (backend) =>
    backend.core.executionRead.listTaskPresentations({
      page: 1,
      pageSize: 200,
      terminalLimit: 200,
    }),
  )
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedUuid, setSelectedUuid] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('task'),
  )
  const rows = useMemo(
    () => filterTaskListRows((query.data?.items ?? []).map(toTaskListRow), keyword, status),
    [keyword, query.data, status],
  )
  useEffect(() => {
    const syncSelectedTask = () => {
      const nextTaskUuid = new URLSearchParams(window.location.search).get('task')
      setSelectedUuid(nextTaskUuid)
      if (!nextTaskUuid && window.location.pathname === '/tasks') query.reload()
    }
    window.addEventListener('popstate', syncSelectedTask)
    return () => window.removeEventListener('popstate', syncSelectedTask)
  }, [query.reload])

  const openTask = (row: TaskListRow) => {
    window.history.pushState({}, '', `/tasks?task=${encodeURIComponent(row.task.taskUuid)}`)
    setSelectedUuid(row.task.taskUuid)
  }

  const closeTask = () => {
    window.history.pushState({}, '', '/tasks')
    setSelectedUuid(null)
    query.reload()
  }

  // URL 中已有任务编号时直接保持详情路由。刷新期间列表请求尚未完成，
  // 不能因为 rows 暂时为空而先回退到列表，再跳回详情。
  if (selectedUuid) return <TaskDetailPage taskUuid={selectedUuid} onBack={closeTask} />
  return (
    <div className={clsx(appShellStyles['page-stack'], sharedStyles['page-stack'])}>
      <PageHeader title="任务" />
      <section className={clsx(appShellStyles['data-section'], sharedStyles['data-section'])}>
        <div
          className={clsx(
            appShellStyles['data-section-toolbar'],
            sharedStyles['data-section-toolbar'],
          )}
        >
          <div className={clsx(sharedStyles['section-title'])}>
            <h2>任务列表</h2>
          </div>
          <Space>
            <Input
              allowClear
              className={clsx(sharedStyles['search-input'])}
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder="搜索名称、工作流或任务编号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              className={clsx(sharedStyles['status-select'])}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'waiting', label: '等待中' },
                { value: 'running', label: '执行中' },
                { value: 'attention', label: '异常' },
                { value: 'completed', label: '已完成' },
                { value: 'failed', label: '失败' },
              ]}
            />
            <Tooltip title="刷新">
              <Button
                type="text"
                loading={query.loading}
                aria-label="刷新任务列表"
                icon={<AppIcon name="arrows/refresh-ccw-01" size={18} />}
                onClick={query.reload}
              />
            </Tooltip>
          </Space>
        </div>
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.reload}
          empty={!query.loading && rows.length === 0}
          emptyDescription="当前后端没有任务记录"
          variant="table"
          tableColumns={6}
        >
          <TaskListTable rows={rows} onOpen={openTask} onDone={query.reload} />
        </AsyncState>
      </section>
    </div>
  )
}
