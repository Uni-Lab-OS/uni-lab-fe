import type {
  WorkflowNodeJobDetail,
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimePage,
  TaskRuntimeDetail,
  TaskRuntimePresentationPage,
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
  getNodeJobDetail(jobUuid: string): Promise<WorkflowNodeJobDetail>
  listNodeJobFeedback(
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<NodeJobFeedbackPage>
}
