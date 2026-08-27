import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
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
  workflowTaskDisplayName,
  type WorkflowTaskListFilter
} from '../utils/workflowTaskListProjection'
import { workflowTaskStatusLabel } from '../utils/workflowTaskPresentation'
import { createWorkflowTaskViewRuntime } from '../utils/workflowTaskViewRuntime'
import { WorkflowButton } from './WorkflowButton'
import WorkflowPanel from './WorkflowPanel'
import styles from './workflow.module.scss'

const TASK_PAGE_SIZE = 100
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_TASK_QUEUE_PERCENT = 38
const MIN_TASK_QUEUE_PERCENT = 30
const MAX_TASK_QUEUE_PERCENT = 70

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
  const [taskQueuePercent, setTaskQueuePercent] = useState(
    DEFAULT_TASK_QUEUE_PERCENT
  )
  const requestRevision = useRef(0)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const setBoundedTaskQueuePercent = useCallback((value: number) => {
    setTaskQueuePercent(Math.min(
      MAX_TASK_QUEUE_PERCENT,
      Math.max(MIN_TASK_QUEUE_PERCENT, value)
    ))
  }, [])
  const resizeTaskQueueFromPointer = useCallback((clientX: number) => {
    const bounds = workspaceRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    setBoundedTaskQueuePercent(
      ((clientX - bounds.left) / bounds.width) * 100
    )
  }, [setBoundedTaskQueuePercent])
  const startTaskQueueResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      resizeTaskQueueFromPointer(moveEvent.clientX)
    }
    const stop = () => {
      globalThis.removeEventListener('pointermove', move)
      globalThis.removeEventListener('pointerup', stop)
    }
    globalThis.addEventListener('pointermove', move)
    globalThis.addEventListener('pointerup', stop, { once: true })
  }, [resizeTaskQueueFromPointer])
  const resizeTaskQueueFromKeyboard = useCallback((
    event: ReactKeyboardEvent
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setBoundedTaskQueuePercent(
      taskQueuePercent + (event.key === 'ArrowLeft' ? -5 : 5)
    )
  }, [setBoundedTaskQueuePercent, taskQueuePercent])

  const workspaceStyle = {
    '--workflow-task-queue-width': `${taskQueuePercent}%`
  } as CSSProperties

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
        <div
          ref={workspaceRef}
          className="workflow-task-list__workspace"
          style={workspaceStyle}
        >
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
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <div
            className="workflow-task-list__splitter"
            role="separator"
            aria-label="调整任务列表与任务详情宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_TASK_QUEUE_PERCENT}
            aria-valuemax={MAX_TASK_QUEUE_PERCENT}
            aria-valuenow={taskQueuePercent}
            tabIndex={0}
            onPointerDown={startTaskQueueResize}
            onKeyDown={resizeTaskQueueFromKeyboard}
          >
            <span aria-hidden="true" />
          </div>
          {selectedTask ? (
            <TaskWorkflowPane
              key={selectedTask.uuid}
              runtime={runtime}
              task={selectedTask}
              workflowName={workflowTaskDisplayName(
                selectedTask,
                workflowNames
              )}
              active={active}
            />
          ) : null}
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

/**
 * 在任务列表右侧展示该任务创建时冻结的工作流（Workflow）界面。
 *
 * @param runtime Backend 权威工作流端口，用于持续补读选中任务的状态。
 * @param task 当前任务；任务 UUID 固定运行投影，快照固定工作流定义版本。
 * @param workflowName 由工作流目录或任务快照解析出的界面名称。
 * @param active 当前任务列表是否可见，用于约束嵌入工作流面板的发布权。
 * @returns 左侧任务选择对应的只读工作流画布与运行投影。
 */
function TaskWorkflowPane({
  runtime,
  task,
  workflowName,
  active
}: {
  runtime: WorkflowRuntimePort
  task: WorkflowTask
  workflowName: string
  active: boolean
}): React.JSX.Element {
  // 初次选中的任务保留冻结快照；同一任务后续刷新只更新运行状态。
  const [frozenTask] = useState(task)
  const taskViewRuntime = useMemo(
    () => createWorkflowTaskViewRuntime(runtime, frozenTask),
    [frozenTask, runtime]
  )

  return (
    <section
      className="workflow-task-list__workflow"
      aria-label="任务对应工作流"
    >
      <header className="workflow-task-list__workflow-context">
        <div>
          <h3>{workflowName}</h3>
          <p>
            <code title={task.uuid}>Task {shortWorkflowTaskId(task.uuid)}</code>
            <time dateTime={task.create_time}>
              {formatWorkflowTaskDate(task.create_time)}
            </time>
          </p>
        </div>
        <TaskStatus status={task.status} />
      </header>
      <div className="workflow-task-list__workflow-panel">
        <WorkflowPanel
          runtime={taskViewRuntime}
          workflowUuid={task.workflow_uuid}
          workflowName={workflowName}
          active={active}
          definitionEditingMode="backend"
          authoringStatus={{
            available: false,
            reason: '工作流任务视图展示创建时冻结的工作流，不允许修改定义'
          }}
          runStatus={{ available: true }}
          executionStatus={{
            available: false,
            reason: '当前显示已创建任务；请在工作流工作台启动新任务'
          }}
          hideEmbeddedCodeEditor
          hideRuntimeControls
          allowWorkflowSelection={false}
        />
      </div>
    </section>
  )
}
