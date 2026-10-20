import type {
  WorkflowNodeJobDetail,
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimePage,
  TaskRuntimeDetail,
  TaskRuntimePresentationPage,
  TaskRuntimeSummaryPage,
} from './model'

/** 任务列表筛选与分页；摘要视图与默认展示视图语义一致。 */
export interface TaskListFilters {
  readonly page?: number
  readonly pageSize?: number
  readonly workflowUuid?: string
  readonly executionKind?: string
  readonly status?: string
  readonly cleanupStatus?: string
}

export interface WorkflowExecutionReadPort {
  listTaskPresentations(input?: {
    readonly page?: number
    readonly pageSize?: number
    readonly workflowUuid?: string
    readonly executionKind?: string
    readonly status?: string
    readonly cleanupStatus?: string
    readonly view?: string
    readonly terminalLimit?: number
  }): Promise<TaskRuntimePresentationPage>
  /**
   * 任务列表摘要（view=summary）：不含执行计划与逐 Job 数组，Job 计数由 OS 聚合。
   * 只有 profile 声明 workflow.taskPresentationSummary 时才能调用；旧 OS 会拒绝该视图。
   */
  listTaskSummaries(input?: TaskListFilters): Promise<TaskRuntimeSummaryPage>
  listTasks(input?: {
    readonly page?: number
    readonly pageSize?: number
    readonly workflowUuid?: string
    readonly executionKind?: string
    readonly status?: string
    readonly cleanupStatus?: string
  }): Promise<TaskRuntimePage>
  getTaskDetail(taskUuid: string): Promise<TaskRuntimeDetail>
  listTaskJobs(taskUuid: string): Promise<readonly TaskJobSummary[]>
  getNodeJobDetail(jobUuid: string): Promise<WorkflowNodeJobDetail>
  listNodeJobFeedback(
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<NodeJobFeedbackPage>
}
