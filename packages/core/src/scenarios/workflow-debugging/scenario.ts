import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import {
  createWorkflowDebuggingViewModel,
  type WorkflowDebuggingQuery,
  type WorkflowDebuggingViewModel
} from './view-model'

export interface WorkflowDebuggingScenario {
  load(query?: WorkflowDebuggingQuery): Promise<WorkflowDebuggingViewModel>
  reload(viewModel: WorkflowDebuggingViewModel): Promise<WorkflowDebuggingViewModel>
  inspectWorkflow(
    viewModel: WorkflowDebuggingViewModel,
    workflowUuid: string
  ): Promise<WorkflowDebuggingViewModel>
  inspectTask(
    viewModel: WorkflowDebuggingViewModel,
    taskUuid: string
  ): Promise<WorkflowDebuggingViewModel>
  inspectJob(
    viewModel: WorkflowDebuggingViewModel,
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number }
  ): Promise<WorkflowDebuggingViewModel>
}

export function createWorkflowDebuggingScenario(
  executionRead: WorkflowExecutionReadPort,
  workflowDefinitions: WorkflowDefinitionPort
): WorkflowDebuggingScenario {
  const scenario: WorkflowDebuggingScenario = {
    async load(query = {}) {
      const [page, workflows] = await Promise.all([
        executionRead.listTaskPresentations(query),
        workflowDefinitions.listPublishedRevisions({
          page: query.workflowPage,
          pageSize: query.workflowPageSize ?? query.pageSize
        })
      ])
      return createWorkflowDebuggingViewModel(query, page, workflows)
    },

    reload(viewModel) {
      return scenario.load(viewModel.query)
    },

    async inspectWorkflow(viewModel, workflowUuid) {
      const workflow = await workflowDefinitions.getPublishedRevision(workflowUuid)
      return {
        ...viewModel,
        selectedWorkflowUuid: workflowUuid,
        selectedWorkflow: workflow
      }
    },

    async inspectTask(viewModel, taskUuid) {
      const [task, jobs] = await Promise.all([
        executionRead.getTaskDetail(taskUuid),
        executionRead.listTaskJobs(taskUuid)
      ])
      return {
        ...viewModel,
        selectedTaskUuid: taskUuid,
        selectedTask: task,
        selectedJobs: jobs,
        selectedJobUuid: null,
        selectedJob: null,
        feedback: null
      }
    },

    async inspectJob(viewModel, jobUuid, input) {
      const [job, feedback] = await Promise.all([
        executionRead.getNodeJobDetail(jobUuid),
        executionRead.listNodeJobFeedback(jobUuid, input)
      ])
      return {
        ...viewModel,
        selectedTaskUuid: viewModel.selectedTaskUuid ?? job.workflowTaskUuid,
        selectedJobUuid: jobUuid,
        selectedJob: job,
        feedback
      }
    }
  }
  return scenario
}
