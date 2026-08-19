import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type {
  WorkflowRuntimePort,
  WorkflowSummary,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'

import {
  formatWorkflowTaskDate,
  shortWorkflowTaskId,
  visibleWorkflowTasks,
  workflowTaskCleanupStatusLabel,
  workflowTaskControlStatusLabelForList,
  workflowTaskDisplayName,
  workflowTaskRunModeLabel,
  type WorkflowTaskListFilter
} from '../utils/workflowTaskListProjection'
import { workflowTaskStatusLabel } from '../utils/workflowTaskPresentation'
import { WorkflowButton } from './WorkflowButton'
import styles from './workflow.module.scss'

const TASK_PAGE_SIZE = 100
const DEFAULT_POLL_INTERVAL_MS = 5_000

export interface WorkflowTaskListProps {
  runtime: WorkflowRuntimePort
  active?: boolean
  recoveryRevision?: number
  pollIntervalMs?: number
}

/**
 * 展示 Backend 权威工作流任务（WorkflowTask）列表与当前任务摘要。
 *
 * @param props 工作流服务端口、可见状态和恢复版本。
 * @returns 可搜索、筛选、刷新并检查任务状态的列表—详情工作区。
 */
export function WorkflowTaskList({
  runtime,
  active = true,
  recoveryRevision = 0,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: WorkflowTaskListProps): React.JSX.Element {
  const [taskPage, setTaskPage] = useState<WorkflowTaskPage>({
    items: [],
    total: 0,
    page: 1,
    page_size: TASK_PAGE_SIZE
  })
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [selectedTaskUuid, setSelectedTaskUuid] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorkflowTaskListFilter>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRevision = useRef(0)

  const loadTasks = useCallback(async (background = false): Promise<void> => {
    const revision = ++requestRevision.current
    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [nextPage, workflowPage] = await Promise.all([
        runtime.listWorkflowTasks({ page: 1, page_size: TASK_PAGE_SIZE }),
        runtime.listWorkflows({ page: 1, page_size: TASK_PAGE_SIZE })
      ])
      if (requestRevision.current !== revision) return
      setTaskPage(nextPage)
      setWorkflows(workflowPage.items)
      setSelectedTaskUuid((current) =>
        current && nextPage.items.some((task) => task.uuid === current)
          ? current
          : nextPage.items[0]?.uuid ?? null
      )
    } catch (reason: unknown) {
      if (requestRevision.current !== revision) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (requestRevision.current === revision) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [runtime])

  useEffect(() => {
    if (!active) return
    void loadTasks(false)
  }, [active, loadTasks, recoveryRevision])

  useEffect(() => {
    if (!active || pollIntervalMs <= 0) return
    const timer = globalThis.setInterval(() => {
      void loadTasks(true)
    }, pollIntervalMs)
    return () => globalThis.clearInterval(timer)
  }, [active, loadTasks, pollIntervalMs])

  const visibleTasks = useMemo(
    () => visibleWorkflowTasks(taskPage.items, workflows, query, filter),
    [filter, query, taskPage.items, workflows]
  )
  const selectedTask = visibleTasks.find(
    (task) => task.uuid === selectedTaskUuid
  ) ?? visibleTasks[0] ?? null
  const workflowNames = useMemo(
    () => new Map(workflows.map((workflow) => [workflow.uuid, workflow.name])),
    [workflows]
  )

  return (
    <div
      className={[
        styles.workflow,
        'workflow-task-list',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
    >
      <header className="workflow-task-list__header">
        <div>
          <h2>工作流任务</h2>
          <p>读取 Backend 已持久化的任务状态；运行中任务每 5 秒自动核对。</p>
        </div>
        <WorkflowButton
          type="button"
          disabled={loading || refreshing}
          disabledReason={loading
            ? '正在读取工作流任务，请稍候'
            : '正在核对 Backend 任务状态，请稍候'}
          onClick={() => void loadTasks(false)}
        >
          <span aria-hidden="true">↻</span>
          {refreshing ? '正在核对' : '刷新'}
        </WorkflowButton>
      </header>

      <div className="workflow-task-list__tools">
        <label>
          <span className="workflow-runtime__visually-hidden">搜索工作流任务</span>
          <input
            type="search"
            value={query}
            placeholder="搜索工作流、Task UUID 或状态"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div role="group" aria-label="工作流任务状态">
          {TASK_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span role="status">
          {visibleTasks.length} / {taskPage.total} 个任务
        </span>
      </div>

      {loading ? (
        <TaskListState title="正在读取工作流任务" />
      ) : error ? (
        <TaskListState
          error
          title="工作流任务列表不可用"
          detail={error}
          onRetry={() => void loadTasks(false)}
        />
      ) : visibleTasks.length === 0 ? (
        <TaskListState
          title={taskPage.items.length > 0 ? '没有匹配的任务' : '暂无工作流任务'}
          detail={taskPage.items.length > 0
            ? '调整搜索词或状态筛选后重试。'
            : '从工作流工作台启动一次运行后，任务会显示在这里。'}
        />
      ) : (
        <div className="workflow-task-list__workspace">
          <section className="workflow-task-list__queue" aria-label="任务队列">
            <ol>
              {visibleTasks.map((task) => (
                <li key={task.uuid}>
                  <button
                    type="button"
                    aria-current={selectedTask?.uuid === task.uuid
                      ? 'true'
                      : undefined}
                    onClick={() => setSelectedTaskUuid(task.uuid)}
                  >
                    <TaskStatus status={task.status} />
                    <span className="workflow-task-list__identity">
                      <strong>{workflowTaskDisplayName(task, workflowNames)}</strong>
                      <span>
                        Task {shortWorkflowTaskId(task.uuid)}
                        <time dateTime={task.create_time}>
                          {formatWorkflowTaskDate(task.create_time)}
                        </time>
                      </span>
                    </span>
                    <span className="workflow-task-list__mode">
                      {workflowTaskRunModeLabel(task.run_mode)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <TaskDetail task={selectedTask} workflowNames={workflowNames} />
        </div>
      )}
    </div>
  )
}

const TASK_FILTERS: ReadonlyArray<{
  value: WorkflowTaskListFilter
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '运行中' },
  { value: 'failed', label: '异常' },
  { value: 'attention', label: '待处理' }
]

/** 渲染任务列表的加载、错误或空状态。 */
function TaskListState({
  title,
  detail,
  error = false,
  onRetry
}: {
  title: string
  detail?: string
  error?: boolean
  onRetry?: () => void
}): React.JSX.Element {
  return (
    <div
      className={`workflow-task-list__state${error ? ' is-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>重新读取</button>
      ) : null}
    </div>
  )
}

/** 渲染一个带文字证据的工作流任务状态标记。 */
function TaskStatus({
  status
}: {
  status: WorkflowTask['status']
}): React.JSX.Element {
  return (
    <span
      className="workflow-task-list__status"
      data-status={status}
    >
      <i aria-hidden="true" />
      {workflowTaskStatusLabel(status)}
    </span>
  )
}

/** 渲染当前选中任务的 Backend 权威摘要。 */
function TaskDetail({
  task,
  workflowNames
}: {
  task: WorkflowTask | null
  workflowNames: ReadonlyMap<string, string>
}): React.JSX.Element {
  if (!task) {
    return (
      <section className="workflow-task-list__detail" aria-label="任务详情">
        <TaskListState title="请选择一个工作流任务" />
      </section>
    )
  }
  return (
    <section className="workflow-task-list__detail" aria-label="任务详情">
      <header>
        <div>
          <h3>{workflowTaskDisplayName(task, workflowNames)}</h3>
          <code title={task.uuid}>{task.uuid}</code>
        </div>
        <TaskStatus status={task.status} />
      </header>
      {task.attention_reason ? (
        <p className="workflow-task-list__attention" role="alert">
          <strong>任务需要关注</strong>
          <span>{task.attention_reason}</span>
        </p>
      ) : null}
      <dl>
        <div>
          <dt>运行模式</dt>
          <dd>{workflowTaskRunModeLabel(task.run_mode)}</dd>
        </div>
        <div>
          <dt>控制状态</dt>
          <dd>{workflowTaskControlStatusLabelForList(task.control_status)}</dd>
        </div>
        <div>
          <dt>清理状态</dt>
          <dd>{workflowTaskCleanupStatusLabel(task.cleanup_status)}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatWorkflowTaskDate(task.create_time)}</dd>
        </div>
        <div>
          <dt>开始时间</dt>
          <dd>{formatWorkflowTaskDate(task.started_at)}</dd>
        </div>
        <div>
          <dt>结束时间</dt>
          <dd>{formatWorkflowTaskDate(task.finished_at)}</dd>
        </div>
        <div className="is-wide">
          <dt>工作流 UUID</dt>
          <dd><code>{task.workflow_uuid}</code></dd>
        </div>
        <div className="is-wide">
          <dt>任务说明</dt>
          <dd>{task.description?.trim() || 'Backend 未提供任务说明'}</dd>
        </div>
      </dl>
      {task.error_info.length > 0 ? (
        <details className="workflow-task-list__errors">
          <summary>错误信息（{task.error_info.length}）</summary>
          <pre>{JSON.stringify(task.error_info, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  )
}
