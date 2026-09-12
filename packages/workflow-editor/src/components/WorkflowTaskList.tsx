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
  WorkflowExecutionTask,
  WorkflowRuntimePort,
  WorkflowSummary,
  WorkflowTask,
  WorkflowTaskPage
} from '@unilab/services'

import {
  formatWorkflowTaskDate,
  isWorkflowExecutionTask,
  shortWorkflowTaskId,
  visibleWorkflowTasks,
  workflowTaskDisplayName,
  type WorkflowTaskListFilter
} from '../utils/workflowTaskListProjection'
import {
  subscribeWorkflowTaskListUpdates,
  createWorkflowTaskPageLoader
} from '../utils/workflowTaskListRuntime'
import { workflowTaskStatusLabel } from '../utils/workflowTaskPresentation'
import { createWorkflowTaskViewRuntime } from '../utils/workflowTaskViewRuntime'
import { WorkflowButton } from './WorkflowButton'
import WorkflowPanel from './WorkflowPanel'
import { WorkflowTaskQueueControls } from './WorkflowTaskQueueControls'
import { WorkflowTaskListErrorBoundary } from './WorkflowTaskListErrorBoundary'
import { TaskListState } from './WorkflowTaskListState'
import styles from './workflow.module.scss'

const TASK_PAGE_SIZE = 100
const DEFAULT_TASK_QUEUE_PERCENT = 38
const MIN_TASK_QUEUE_PERCENT = 30
const MAX_TASK_QUEUE_PERCENT = 70

export interface WorkflowTaskListProps {
  runtime: WorkflowRuntimePort
  active?: boolean
  recoveryRevision?: number
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
  recoveryRevision = 0
}: WorkflowTaskListProps): React.JSX.Element {
  return (
    <WorkflowTaskListErrorBoundary resetKey={recoveryRevision}>
      <WorkflowTaskListContent
        runtime={runtime}
        active={active}
        recoveryRevision={recoveryRevision}
      />
    </WorkflowTaskListErrorBoundary>
  )
}

/** 承载任务列表状态；外层错误边界保证单条异常数据不会卸载整个面板。 */
function WorkflowTaskListContent({
  runtime,
  active = true,
  recoveryRevision = 0
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
  const [realtimeError, setRealtimeError] = useState<string | null>(null)
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

  const pageLoader = useMemo(() => createWorkflowTaskPageLoader(runtime), [runtime, active])
  useEffect(() => {
    pageLoader.activate()
    return () => pageLoader.dispose()
  }, [pageLoader])

  const loadTasks = useCallback(async (background = false): Promise<void> => {
    const revision = ++requestRevision.current
    if (background) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [nextPage, workflowPage] = await Promise.all([
        pageLoader.read({
          page: 1,
          page_size: TASK_PAGE_SIZE,
          execution_kind: 'workflow'
        }),
        runtime.listWorkflows({ page: 1, page_size: TASK_PAGE_SIZE })
      ])
      if (requestRevision.current !== revision) return
      setWorkflows(workflowPage.items)
      // 工作流目录可能比摘要慢；已收到更新摘要时不得回装旧初始页。
      if (!pageLoader.isCurrent(nextPage)) return
      setTaskPage(nextPage)
      setSelectedTaskUuid((current) =>
        current && nextPage.items.some((task) =>
          isWorkflowExecutionTask(task) && task.uuid === current
        )
          ? current
          : nextPage.items.find(isWorkflowExecutionTask)?.uuid ?? null
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
  }, [runtime, pageLoader])

  useEffect(() => {
    if (!active) return
    void loadTasks(false)
  }, [active, loadTasks, recoveryRevision])

  /**
   * 安装服务器发送事件（SSE）合并补读后的完整权威摘要页。
   *
   * @param page Backend 返回的当前任务摘要页。
   * @returns 无返回值；并行兄弟任务保持在当前列表页中。
   */
  const installRealtimePage = useCallback((page: WorkflowTaskPage): void => {
    setTaskPage(page)
  }, [])

  /** 清除已恢复的任务状态实时连接错误。 */
  const markRealtimeConnected = useCallback((): void => {
    setRealtimeError(null)
  }, [])

  /**
   * 保留最近一次权威投影，并展示实时状态补读错误。
   *
   * @param message 可行动的连接或任务补读错误。
   * @returns 无返回值；操作者仍可使用手动刷新恢复。
   */
  const installRealtimeError = useCallback((message: string): void => {
    setRealtimeError(message)
  }, [])

  useEffect(() => {
    if (!active) return
    const subscription = subscribeWorkflowTaskListUpdates(runtime, {
      onPage: installRealtimePage,
      onRecovered: markRealtimeConnected,
      onError: installRealtimeError
    }, { page: 1, page_size: TASK_PAGE_SIZE, execution_kind: 'workflow' }, pageLoader)
    return () => subscription.dispose()
  }, [
    active,
    installRealtimeError,
    installRealtimePage,
    pageLoader,
    markRealtimeConnected,
    runtime
  ])

  const visibleTasks = useMemo(
    () => visibleWorkflowTasks(taskPage.items, workflows, query, filter),
    [filter, query, taskPage.items, workflows]
  )
  const workflowTaskItemCount = useMemo(
    () => taskPage.items.filter(isWorkflowExecutionTask).length,
    [taskPage.items]
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
          <p
            className={realtimeError ? 'is-error' : undefined}
            role={realtimeError ? 'alert' : undefined}
          >
            {realtimeError ??
              '读取 Backend 已持久化的任务状态；运行变化会实时补读。'}
          </p>
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
        <TaskListState
          kind="loading"
          title="正在读取工作流任务"
          detail="正在连接 Backend 并核对任务状态。"
        />
      ) : error ? (
        <TaskListState
          kind="error"
          title="工作流任务列表不可用"
          detail={error}
          actionLabel="重新读取"
          onAction={() => void loadTasks(false)}
        />
      ) : visibleTasks.length === 0 ? (
        <TaskListState
          kind={workflowTaskItemCount > 0 ? 'filtered' : 'empty'}
          title={workflowTaskItemCount > 0
            ? '没有匹配的任务'
            : '还没有工作流任务'}
          detail={workflowTaskItemCount > 0
            ? '当前搜索词或状态筛选下没有结果。'
            : '运行工作流后，任务状态和对应的工作流快照会显示在这里。'}
          hint={workflowTaskItemCount > 0
            ? undefined
            : '前往“工作流”选择流程并启动运行。'}
          actionLabel={workflowTaskItemCount > 0
            ? '清除搜索与筛选'
            : undefined}
          onAction={workflowTaskItemCount > 0
            ? () => {
                setQuery('')
                setFilter('all')
              }
            : undefined}
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
              onReconcile={() => loadTasks(true)}
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
  active,
  onReconcile
}: {
  runtime: WorkflowRuntimePort
  task: WorkflowExecutionTask
  workflowName: string
  active: boolean
  onReconcile: () => Promise<void>
}): React.JSX.Element {
  // 初次选中的任务保留冻结快照；同一任务后续刷新只更新运行状态，读取失败可以单独重试详情。
  const [frozenTask, setFrozenTask] = useState<WorkflowExecutionTask | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRetry, setDetailRetry] = useState(0)
  useEffect(() => {
    if (!active) return
    let live = true
    setDetailError(null)
    void runtime.getWorkflowTask(task.uuid).then((detail) => {
      if (!live) return
      if (!isWorkflowExecutionTask(detail) || detail.uuid !== task.uuid) throw new Error('任务详情身份不一致')
      setFrozenTask(detail)
      setDetailError(null)
    }).catch((error) => { if (live) setDetailError(error instanceof Error ? error.message : String(error)) })
    return () => { live = false }
  }, [active, runtime, task.uuid, detailRetry])
  const taskViewRuntime = useMemo(
    () => frozenTask ? createWorkflowTaskViewRuntime(runtime, frozenTask) : null,
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
        <div className="workflow-task-list__workflow-actions">
          <TaskStatus status={task.status} />
          <WorkflowTaskQueueControls
            runtime={runtime}
            task={task}
            onReconcile={onReconcile}
          />
        </div>
      </header>
      <div className="workflow-task-list__workflow-panel">
        {detailError ? <div role="alert">
          <p>任务详情读取失败：{detailError}</p>
          <WorkflowButton disabledReason="正在读取任务详情" onClick={() => setDetailRetry((value) => value + 1)}>重试任务详情</WorkflowButton>
        </div> : null}
        {!taskViewRuntime ? (detailError ? null : <p>正在读取任务详情…</p>) : <WorkflowPanel
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
        />}
      </div>
    </section>
  )
}
