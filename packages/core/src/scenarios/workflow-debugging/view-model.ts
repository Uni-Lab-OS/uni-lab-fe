import type {
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimeDetail,
  TaskRuntimePresentation,
  WorkflowNodeJobDetail,
  TaskRuntimePresentationPage
} from '../../domain/workflow-execution-read/model'
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary
} from '../../domain/workflow-definition/model'

export interface WorkflowDebuggingQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly workflowPage?: number
  readonly workflowPageSize?: number
  readonly workflowUuid?: string
  readonly executionKind?: string
  readonly status?: string
  readonly cleanupStatus?: string
  readonly view?: string
  readonly terminalLimit?: number
}

export interface WorkflowDebuggingViewModel {
  readonly kind: 'workflow_debugging'
  readonly query: WorkflowDebuggingQuery
  readonly workflows: readonly PublishedWorkflowRevisionSummary[]
  readonly tasks: readonly TaskRuntimePresentation[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly selectedTaskUuid: string | null
  readonly selectedTask: TaskRuntimeDetail | null
  readonly selectedWorkflowUuid: string | null
  readonly selectedWorkflow: PublishedWorkflowRevision | null
  readonly selectedJobs: readonly TaskJobSummary[]
  readonly selectedJobUuid: string | null
  readonly selectedJob: WorkflowNodeJobDetail | null
  readonly feedback: NodeJobFeedbackPage | null
}

export function createWorkflowDebuggingViewModel(
  query: WorkflowDebuggingQuery,
  page: TaskRuntimePresentationPage,
  workflows: readonly PublishedWorkflowRevisionSummary[] = []
): WorkflowDebuggingViewModel {
  return {
    kind: 'workflow_debugging',
    query,
    workflows,
    tasks: page.items,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    selectedTaskUuid: null,
    selectedTask: null,
    selectedWorkflowUuid: null,
    selectedWorkflow: null,
    selectedJobs: [],
    selectedJobUuid: null,
    selectedJob: null,
    feedback: null
  }
}
