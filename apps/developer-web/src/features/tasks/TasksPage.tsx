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

/**
 * 服务端分页的页大小。OS 的 `_normalize_page` 会把 page_size 截断到 100，而每个
 * Task 投影都内嵌它自己的全部 Job，所以页越大投影越重、越容易拖慢首屏。
 */
const TASK_PAGE_SIZE = 20

export function TasksPage() {
  const [page, setPage] = useState(1)
  // 分页由后端做：page 进查询身份，切页是换一份投影，不是在这一批数据上切片。
  // live 只表示「收到全局 SSE 失效后重读当前页」；事件不携带状态，也不允许乐观 patch。
  // useBackendQuery 只在新身份首读时置 loading，所以后台重读是无感的（不闪骨架屏）。
  const query = useBackendQuery(
    `task-presentations:${page}`,
    (backend) =>
      backend.core.executionRead.listTaskPresentations({
        page,
        pageSize: TASK_PAGE_SIZE,
      }),
    { live: true },
  )
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedUuid, setSelectedUuid] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('task'),
  )
  const items = query.data?.items
  // 关键字与状态仍在前端过滤，因此只作用于当前页：展示接口没有 keyword 参数，
  // 而 attention/completed 属于前端状态词汇表，不是 OS 的 status 枚举。
  const rows = useMemo(
    () => filterTaskListRows((items ?? []).map(toTaskListRow), keyword, status),
    [items, keyword, status],
  )
  const filtering = keyword.trim() !== '' || status !== 'all'
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
              onChange={(event) => {
                setKeyword(event.target.value)
                // 过滤只覆盖当前页，换条件就回到第一页，不要停在一个被筛空的页上。
                setPage(1)
              }}
            />
            <Select
              className={clsx(sharedStyles['status-select'])}
              value={status}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
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
          // 只有「这一页真的没有任务」才整块空态；被筛选筛空时要留着分页器，
          // 否则当前页没有匹配项就再也翻不到下一页。
          empty={!query.loading && (items?.length ?? 0) === 0 && !filtering}
          emptyDescription="当前后端没有任务记录"
          variant="table"
          tableColumns={6}
        >
          <TaskListTable
            rows={rows}
            total={query.data?.total ?? 0}
            page={page}
            pageSize={TASK_PAGE_SIZE}
            filtered={filtering}
            onPageChange={setPage}
            onOpen={openTask}
            onDone={query.reload}
          />
        </AsyncState>
      </section>
    </div>
  )
}
