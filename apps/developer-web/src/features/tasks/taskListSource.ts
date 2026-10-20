import type {
  TaskRuntimeListItem,
  TaskRuntimeListPage,
  WorkflowProgressFact,
} from '@unilab-fe/core'
import type { StudioBackend } from '../../app/backend'
import type { QueryFreshness } from '../../hooks/queryCache'

export type TaskListView = 'presentation' | 'summary'

type TaskListBackend = Pick<StudioBackend, 'core' | 'getCapabilityStatus'>

/**
 * 任务列表的读取方式由 profile 静态能力决定：声明 workflow.taskPresentationSummary 时读摘要视图，
 * 否则保持默认展示投影。不按请求失败去猜后端是否支持。
 */
export function taskListView(backend: Pick<StudioBackend, 'getCapabilityStatus'>): TaskListView {
  return backend.getCapabilityStatus('workflow.taskPresentationSummary').available
    ? 'summary'
    : 'presentation'
}

export interface TaskListInput {
  readonly page: number
  readonly pageSize: number
}

export function loadTaskList(
  backend: TaskListBackend,
  input: TaskListInput,
): Promise<TaskRuntimeListPage> {
  return taskListView(backend) === 'summary'
    ? backend.core.executionRead.listTaskSummaries(input)
    : backend.core.executionRead.listTaskPresentations(input)
}

/** 同一视图、同一分页的列表在总览、任务页与调度页之间共用一份缓存。 */
export function taskListQueryKey(
  backend: Pick<StudioBackend, 'getCapabilityStatus'>,
  input: TaskListInput,
): string {
  return `task-list:${taskListView(backend)}:${input.page}:${input.pageSize}`
}

/** 列表页缓存：30 秒内切回页面直接显示；任务运行失效通知会让它提前过期。 */
export const TASK_LIST_FRESHNESS: QueryFreshness = {
  staleTimeMs: 30_000,
  invalidateOnRuntimeEvents: true,
}

/** OS 提供的业务进度；摘要视图与未提供进度的展示投影均为 null，不按 Job 状态估算。 */
export function taskProgress(task: TaskRuntimeListItem): WorkflowProgressFact | null {
  return task.kind === 'task_runtime_presentation' ? task.progress : null
}
