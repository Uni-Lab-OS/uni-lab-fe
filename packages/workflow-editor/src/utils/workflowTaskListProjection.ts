import type {
  WorkflowExecutionTask,
  WorkflowSummary,
  WorkflowTask
} from '@unilab/services'

export type WorkflowTaskListFilter =
  | 'all'
  | 'active'
  | 'failed'
  | 'attention'

const TERMINAL_STATUSES = new Set<WorkflowTask['status']>([
  'succeeded',
  'failed',
  'canceled',
  'timeout'
])

const FAILED_STATUSES = new Set<WorkflowTask['status']>([
  'failed',
  'canceled',
  'timeout'
])

/**
 * 按 Backend 工作流任务（WorkflowTask）事实构建可见列表。
 *
 * @param tasks Backend 当前页返回的任务。
 * @param workflows 用于补充任务所属工作流名称的目录。
 * @param query 用户输入的名称、UUID 或状态关键词。
 * @param filter 用户选择的运行状态分组。
 * @returns 创建时间倒序排列且满足查询条件的任务。
 */
export function visibleWorkflowTasks(
  tasks: readonly WorkflowTask[],
  workflows: readonly WorkflowSummary[],
  query: string,
  filter: WorkflowTaskListFilter
): WorkflowExecutionTask[] {
  const workflowNames = new Map(
    workflows.map((workflow) => [workflow.uuid, workflow.name])
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return [...tasks]
    .filter(isWorkflowExecutionTask)
    .filter((task) => {
      if (!workflowTaskMatchesFilter(task, filter)) return false
      if (!normalizedQuery) return true
      const searchable = [
        workflowTaskDisplayName(task, workflowNames),
        task.uuid,
        task.workflow_uuid,
        task.status,
        task.control_status,
        task.cleanup_status,
        task.description ?? ''
      ]
      return searchable.some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery)
      )
    })
    .sort((left, right) => right.create_time.localeCompare(left.create_time))
}

/** 返回任务所属工作流的用户可见名称，不猜测缺失的领域事实。 */
export function workflowTaskDisplayName(
  task: WorkflowExecutionTask,
  workflowNames: ReadonlyMap<string, string>
): string {
  const catalogName = workflowNames.get(task.workflow_uuid)?.trim()
  if (catalogName) return catalogName
  const snapshot = recordValue(task.workflow_snapshot)
  const snapshotWorkflow = recordValue(snapshot.workflow)
  const snapshotName = firstText(snapshotWorkflow, ['name', 'display_name'])
    ?? firstText(snapshot, ['name', 'display_name'])
  return snapshotName ?? `工作流 ${shortWorkflowTaskId(task.workflow_uuid)}`
}

/** 判断统一任务资源是否属于当前页面支持的完整工作流运行。 */
export function isWorkflowExecutionTask(
  task: WorkflowTask
): task is WorkflowExecutionTask {
  return task.execution_kind === 'workflow'
    && typeof task.workflow_uuid === 'string'
    && task.workflow_uuid.trim().length > 0
}

/** 返回工作流任务 UUID 的稳定短显示形式。 */
export function shortWorkflowTaskId(uuid: string): string {
  return uuid.length > 8 ? uuid.slice(-8) : uuid
}

/** 返回任务运行模式的中文名称。 */
export function workflowTaskRunModeLabel(
  mode: WorkflowTask['run_mode']
): string {
  if (mode === 'step') return '单步运行'
  if (mode === 'single_node') return '单节点运行'
  return '普通运行'
}

/** 返回任务清理状态的中文名称。 */
export function workflowTaskCleanupStatusLabel(
  status: WorkflowTask['cleanup_status']
): string {
  return {
    none: '无需清理',
    pending: '等待清理',
    canceling: '正在清理',
    settled: '清理完成',
    requires_attention: '需要关注'
  }[status]
}

/** 返回任务控制状态的中文名称。 */
export function workflowTaskControlStatusLabelForList(
  status: WorkflowTask['control_status']
): string {
  return {
    active: '控制可用',
    paused: '已暂停',
    waiting_intervention: '等待人工干预',
    waiting_reconciliation: '等待状态核对'
  }[status]
}

/** 返回适合任务列表展示的本地日期时间。 */
export function formatWorkflowTaskDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

/** 判断任务是否属于用户选择的列表状态分组。 */
function workflowTaskMatchesFilter(
  task: WorkflowTask,
  filter: WorkflowTaskListFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return !TERMINAL_STATUSES.has(task.status)
  if (filter === 'failed') return FAILED_STATUSES.has(task.status)
  return Boolean(
    task.attention_reason
    || task.control_status === 'waiting_intervention'
    || task.cleanup_status === 'requires_attention'
  )
}

/** 把未知 JSON 值收窄为只读记录。 */
function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {}
}

/** 从开放元数据中读取第一个非空文本。 */
function firstText(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
