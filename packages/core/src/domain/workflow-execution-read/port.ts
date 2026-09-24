import type { TaskJobSummary, TaskRuntimeDetail } from './model'

export interface WorkflowExecutionReadPort {
  getTaskDetail(taskUuid: string): Promise<TaskRuntimeDetail>
  listTaskJobs(taskUuid: string): Promise<readonly TaskJobSummary[]>
}

