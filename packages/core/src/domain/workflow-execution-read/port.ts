import type {
  WorkflowNodeJobDetail,
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimePage,
  TaskRuntimeDetail,
  TaskRuntimePresentationPage,
  WorkflowTaskExecutionLockSnapshot,
} from './model'

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
  /**
   * 读取任务级整组解锁（调试场景）所需的执行锁快照，只读不写。
   * 真正解锁要另发 `unlock_resources` 命令；快照为空不代表解锁会成功。
   */
  getTaskExecutionLocks(
    taskUuid: string,
    signal?: AbortSignal,
  ): Promise<WorkflowTaskExecutionLockSnapshot>
  getNodeJobDetail(jobUuid: string): Promise<WorkflowNodeJobDetail>
  listNodeJobFeedback(
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<NodeJobFeedbackPage>
}
