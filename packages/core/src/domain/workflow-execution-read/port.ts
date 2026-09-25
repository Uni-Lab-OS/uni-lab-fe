import type {
  WorkflowNodeJobDetail,
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimeDetail
} from './model'

export interface WorkflowExecutionReadPort {
  getTaskDetail(taskUuid: string): Promise<TaskRuntimeDetail>
  listTaskJobs(taskUuid: string): Promise<readonly TaskJobSummary[]>
  getNodeJobDetail(jobUuid: string): Promise<WorkflowNodeJobDetail>
  listNodeJobFeedback(
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number }
  ): Promise<NodeJobFeedbackPage>
}
