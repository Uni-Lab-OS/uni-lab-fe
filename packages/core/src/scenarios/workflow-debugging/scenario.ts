import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { WorkflowExecutionControlPort } from '../../domain/workflow-execution-control/port'
import type {
  TaskRuntimeListPage,
  WorkflowTaskCommandReceipt,
  WorkflowTaskCommandRequest,
  WorkflowRuntimeInvalidation,
  WorkflowRuntimeSubscription,
} from '../../domain/workflow-execution-read/model'
import type { WorkflowRuntimeEventsPort } from '../../domain/workflow-runtime-events/port'
import { deriveWorkflowDebugFacts } from '../../domain/workflow-execution-read/debug-facts'
import {
  createWorkflowDebuggingViewModel,
  projectWorkflowDebugFacts,
  type WorkflowDebuggingQuery,
  type WorkflowDebuggingViewModel,
} from './view-model'

export interface WorkflowDebuggingScenario {
  load(query?: WorkflowDebuggingQuery): Promise<WorkflowDebuggingViewModel>
  reload(viewModel: WorkflowDebuggingViewModel): Promise<WorkflowDebuggingViewModel>
  inspectWorkflow(
    viewModel: WorkflowDebuggingViewModel,
    workflowUuid: string,
  ): Promise<WorkflowDebuggingViewModel>
  inspectTask(
    viewModel: WorkflowDebuggingViewModel,
    taskUuid: string,
  ): Promise<WorkflowDebuggingViewModel>
  inspectJob(
    viewModel: WorkflowDebuggingViewModel,
    jobUuid: string,
    input?: { readonly afterSequence?: number; readonly limit?: number },
  ): Promise<WorkflowDebuggingViewModel>
  refreshTask(viewModel: WorkflowDebuggingViewModel): Promise<WorkflowDebuggingViewModel>
  sendCommand(
    viewModel: WorkflowDebuggingViewModel,
    request: WorkflowTaskCommandRequest,
  ): Promise<{
    readonly viewModel: WorkflowDebuggingViewModel
    readonly command: WorkflowTaskCommandReceipt
  }>
  subscribeRuntime(
    viewModel: WorkflowDebuggingViewModel,
    listener: (viewModel: WorkflowDebuggingViewModel, event: WorkflowRuntimeInvalidation) => void,
    options?: {
      readonly lastEventId?: string
      readonly onError?: (error: Error) => void
      /** 保留调用方覆盖刷新间隔的能力，默认合并 100 ms 内的事件。 */
      readonly minRefreshGapMs?: number
    },
  ): WorkflowRuntimeSubscription
}

export function createWorkflowDebuggingScenario(
  executionRead: WorkflowExecutionReadPort,
  workflowDefinitions: WorkflowDefinitionPort,
  control?: WorkflowExecutionControlPort,
  runtimeEvents?: WorkflowRuntimeEventsPort,
): WorkflowDebuggingScenario {
  const scenario: WorkflowDebuggingScenario = {
    async load(query = {}) {
      const [page, workflows] = await Promise.all([
        listTaskPage(executionRead, query),
        workflowDefinitions.listPublishedRevisions({
          page: query.workflowPage,
          pageSize: query.workflowPageSize ?? query.pageSize,
        }),
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
        selectedWorkflow: workflow,
      }
    },

    async inspectTask(viewModel, taskUuid) {
      const [task, jobs] = await Promise.all([
        executionRead.getTaskDetail(taskUuid),
        executionRead.listTaskJobs(taskUuid),
      ])
      return projectWorkflowDebugFacts(
        {
          ...viewModel,
          selectedTaskUuid: taskUuid,
          selectedTask: task,
          selectedJobs: jobs,
          selectedJobUuid: null,
          selectedJob: null,
          feedback: null,
          lastCommand: null,
        },
        deriveWorkflowDebugFacts(task, jobs),
        jobs,
        task,
      )
    },

    async inspectJob(viewModel, jobUuid, input) {
      const [job, feedback] = await Promise.all([
        executionRead.getNodeJobDetail(jobUuid),
        executionRead.listNodeJobFeedback(jobUuid, input),
      ])
      return {
        ...viewModel,
        selectedTaskUuid: viewModel.selectedTaskUuid ?? job.workflowTaskUuid,
        selectedJobUuid: jobUuid,
        selectedJob: job,
        feedback,
      }
    },

    async refreshTask(viewModel) {
      if (!viewModel.selectedTaskUuid) return viewModel
      const taskUuid = viewModel.selectedTaskUuid
      const [task, jobs] = await Promise.all([
        executionRead.getTaskDetail(taskUuid),
        executionRead.listTaskJobs(taskUuid),
      ])
      let next = projectWorkflowDebugFacts(
        {
          ...viewModel,
          selectedTask: task,
          selectedJobs: jobs,
        },
        deriveWorkflowDebugFacts(task, jobs),
        jobs,
        task,
      )
      if (viewModel.selectedJobUuid) {
        const selectedJob = await executionRead.getNodeJobDetail(viewModel.selectedJobUuid)
        const previousCursor = viewModel.feedback?.nextCursor ?? 0
        const feedback = await executionRead.listNodeJobFeedback(viewModel.selectedJobUuid, {
          afterSequence: previousCursor,
          limit: 500,
        })
        const existing = viewModel.feedback?.items ?? []
        const merged = new Map(existing.map((item) => [`${item.jobUuid}:${item.sequence}`, item]))
        for (const item of feedback.items) merged.set(`${item.jobUuid}:${item.sequence}`, item)
        const items = [...merged.values()].sort((left, right) => left.sequence - right.sequence)
        next = {
          ...next,
          selectedJob,
          feedback: {
            ...feedback,
            items,
            nextCursor: Math.max(viewModel.feedback?.nextCursor ?? 0, feedback.nextCursor),
          },
        }
      }
      return next
    },

    async sendCommand(viewModel, request) {
      if (!viewModel.selectedTaskUuid) throw new Error('必须先选择 Task 才能发送命令')
      if (!control) throw new Error('当前 Backend 未提供 Workflow Task 控制端口')
      const command = await control.sendTaskCommand(viewModel.selectedTaskUuid, request)
      return { viewModel: { ...viewModel, lastCommand: command }, command }
    },

    subscribeRuntime(viewModel, listener, options) {
      if (!runtimeEvents) return { dispose: () => undefined }
      let currentViewModel = viewModel
      let pendingEvent: WorkflowRuntimeInvalidation | null = null
      let refreshInFlight = false
      let disposed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedule = (): void => {
        if (disposed || refreshInFlight || timer !== undefined || !pendingEvent) return
        // Batch invalidations only; execution facts still come from REST.
        timer = setTimeout(refresh, options?.minRefreshGapMs ?? 100)
      }
      const refresh = (): void => {
        timer = undefined
        if (disposed || refreshInFlight || !pendingEvent) return
        const event = pendingEvent
        pendingEvent = null
        refreshInFlight = true
        void scenario
          .refreshTask(currentViewModel)
          .then((next) => {
            if (disposed) return
            currentViewModel = next
            listener(next, event)
          })
          .catch((error: unknown) => {
            if (disposed) return
            const failure = error instanceof Error ? error : new Error(String(error))
            if (options?.onError) options.onError(failure)
            else console.error('Workflow runtime refresh failed', failure)
          })
          .finally(() => {
            refreshInFlight = false
            schedule()
          })
      }
      const subscription = runtimeEvents.subscribe((event) => {
        if (disposed || event.workflowTaskUuid !== currentViewModel.selectedTaskUuid) return
        pendingEvent = event
        schedule()
      }, options)
      return {
        dispose: () => {
          disposed = true
          pendingEvent = null
          if (timer !== undefined) clearTimeout(timer)
          subscription.dispose()
        },
      }
    },
  }
  return scenario
}

/** 摘要视图只接受筛选与分页，不带默认视图的 view/terminal_limit。 */
function listTaskPage(
  executionRead: WorkflowExecutionReadPort,
  query: WorkflowDebuggingQuery,
): Promise<TaskRuntimeListPage> {
  if (query.taskListView !== 'summary') return executionRead.listTaskPresentations(query)
  return executionRead.listTaskSummaries({
    page: query.page,
    pageSize: query.pageSize,
    workflowUuid: query.workflowUuid,
    executionKind: query.executionKind,
    status: query.status,
    cleanupStatus: query.cleanupStatus,
  })
}
