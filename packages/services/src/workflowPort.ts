import type { WorkflowActionCatalogSnapshot } from './workflowActionCatalog'
import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringApplyRequest,
  WorkflowAuthoringApplyResponse,
  WorkflowAuthoringCandidate,
  WorkflowAuthoringChangedEvent,
  WorkflowAuthoringDraftWriteRequest,
  WorkflowAuthoringGeneratePythonRequest,
  WorkflowAuthoringResult,
  WorkflowAuthoringSubscriptionOptions,
  WorkflowAuthoringTransformResult,
  WorkflowAuthoringValidateRequest,
  WorkflowDefinitionChangePage,
  WorkflowDefinitionCreateRequest,
  ExperimentOperationCreateRequest,
  WorkflowDocument,
  WorkflowListQuery,
  WorkflowPage,
  WorkflowRevision,
  WorkflowSummary,
  WorkflowValidationResult
} from './workflowAuthoringContracts'
import type { WorkflowMaterialSourceCatalogSnapshot } from './workflowMaterialSource'
import type { BackendWorkflowGraph } from './backendWorkflowGraph'
import type {
  DebugWorkflowTaskCommand,
  DebugWorkflowTaskCommandRequest,
  DebugWorkflowTaskCreateRequest,
  DebugWorkflowTaskPreflight,
  DebugWorkflowTaskPreflightRequest,
  DebugWorkflowTaskProjection,
  WorkflowEventSubscription,
  WorkflowNodeJob,
  WorkflowNodeJobFeedbackPage,
  WorkflowNodeJobFeedbackQuery,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRunPreflightReport,
  WorkflowRunPreparation,
  WorkflowRuntimeSubscriptionOptions,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskCommandRequest,
  WorkflowTaskCreateRequest,
  WorkflowTaskListQuery,
  WorkflowTaskPage,
  WorkflowTaskRunMode
} from './workflowTaskContracts'

/**
 * 前端访问工作流创作（Workflow Authoring）与工作流任务（WorkflowTask）的唯一服务端口。
 *
 * 该端口只封装通信与解码，不持有工作流或任务权威状态。
 */
export interface WorkflowRuntimePort {
  getWorkflowActionCatalog: (
    signal?: AbortSignal,
    options?: { refresh?: boolean }
  ) => Promise<WorkflowActionCatalogSnapshot>
  getWorkflowMaterialSourceCatalog: () =>
    Promise<WorkflowMaterialSourceCatalogSnapshot>
  listWorkflows: (query?: WorkflowListQuery) => Promise<WorkflowPage>
  createWorkflowDefinition: (
    request: WorkflowDefinitionCreateRequest
  ) => Promise<WorkflowSummary>
  createExperimentOperation: (
    request: ExperimentOperationCreateRequest
  ) => Promise<WorkflowSummary>
  deleteWorkflowDefinition: (workflowUuid: string) => Promise<void>
  listWorkflowDefinitionChanges: (
    workflowUuid: string
  ) => Promise<WorkflowDefinitionChangePage>
  getWorkflowAuthoring: (
    workflowUuid: string
  ) => Promise<WorkflowAuthoringAggregate>
  saveWorkflowAuthoringDraft: (
    workflowUuid: string,
    request: WorkflowAuthoringDraftWriteRequest
  ) => Promise<WorkflowAuthoringAggregate>
  applyWorkflowAuthoring: (
    workflowUuid: string,
    request: WorkflowAuthoringApplyRequest
  ) => Promise<WorkflowAuthoringApplyResponse>
  subscribeWorkflowAuthoring: (
    workflowUuid: string,
    onInvalidate: (event: WorkflowAuthoringChangedEvent) => void,
    options?: WorkflowAuthoringSubscriptionOptions
  ) => WorkflowEventSubscription
  generateWorkflowAuthoringPython: (
    request: WorkflowAuthoringGeneratePythonRequest
  ) => Promise<WorkflowAuthoringTransformResult>
  validateWorkflowAuthoring: (
    request: WorkflowAuthoringValidateRequest
  ) => Promise<WorkflowAuthoringTransformResult>
  getWorkflow: (workflowId: string) => Promise<WorkflowDocument>
  saveWorkflow: (
    workflowId: string,
    revision: WorkflowRevision,
    expectedRevisionId?: string
  ) => Promise<WorkflowDocument>
  validateWorkflow: (
    revision: WorkflowRevision,
    parameters?: Record<string, unknown>
  ) => Promise<WorkflowValidationResult>
  compilePythonWorkflow: (
    baseRevisionId: string,
    pythonSource: string,
    sourceUri: string
  ) => Promise<WorkflowAuthoringResult>
  generatePythonWorkflow: (
    baseRevisionId: string,
    revision: WorkflowRevision,
    sourceUri: string
  ) => Promise<WorkflowAuthoringResult>
  validateAuthoringCandidate: (
    baseRevisionId: string,
    candidate: WorkflowAuthoringCandidate
  ) => Promise<WorkflowAuthoringResult>
  getBackendWorkflowGraph: (
    workflowUuid: string
  ) => Promise<BackendWorkflowGraph>
  saveBackendWorkflowGraph: (
    workflowUuid: string,
    graph: BackendWorkflowGraph
  ) => Promise<BackendWorkflowGraph>
  getWorkflowRunPreparation: (
    workflowUuid: string
  ) => Promise<WorkflowRunPreparation>
  getWorkflowRunPreflight: (
    workflowUuid: string,
    runMode: WorkflowTaskRunMode,
    targetNodeUuid?: string
  ) => Promise<WorkflowRunPreflightReport>
  createWorkflowTask: (
    request: WorkflowTaskCreateRequest
  ) => Promise<WorkflowTask>
  createDebugWorkflowTask: (
    request: DebugWorkflowTaskCreateRequest
  ) => Promise<WorkflowTask>
  preflightDebugWorkflowTask: (
    request: DebugWorkflowTaskPreflightRequest
  ) => Promise<DebugWorkflowTaskPreflight>
  getDebugWorkflowTask: (
    taskUuid: string
  ) => Promise<DebugWorkflowTaskProjection>
  commandDebugWorkflowTask: (
    taskUuid: string,
    request: DebugWorkflowTaskCommandRequest
  ) => Promise<DebugWorkflowTaskCommand>
  listWorkflowTasks: (
    query?: WorkflowTaskListQuery
  ) => Promise<WorkflowTaskPage>
  getWorkflowTask: (taskUuid: string) => Promise<WorkflowTask>
  listWorkflowTaskJobs: (
    taskUuid: string
  ) => Promise<WorkflowNodeJob[]>
  commandWorkflowTask: (
    taskUuid: string,
    request: WorkflowTaskCommandRequest
  ) => Promise<WorkflowTaskCommand>
  getWorkflowNodeJob: (jobUuid: string) => Promise<WorkflowNodeJob>
  listWorkflowNodeJobFeedback: (
    jobUuid: string,
    query?: WorkflowNodeJobFeedbackQuery
  ) => Promise<WorkflowNodeJobFeedbackPage>
  subscribeWorkflowRuntime: (
    onInvalidate: (event: WorkflowRuntimeInvalidationEvent) => void,
    options?: WorkflowRuntimeSubscriptionOptions
  ) => WorkflowEventSubscription
  dispose: () => void
}
