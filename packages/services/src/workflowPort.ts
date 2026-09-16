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
  interventions?: import('./workflowInterventions').WorkflowInterventionPort
  executionLocks?: import('./workflowExecutionLocks').WorkflowExecutionLockPort
  createWorkflowTask: (
    request: WorkflowTaskCreateRequest
  ) => Promise<WorkflowTask>
  preflightWorkflowTask: (
    workflowUuid: string,
    request: import('./workflowTaskContracts').WorkflowTaskPreflightRequest
  ) => Promise<import('./workflowTaskContracts').WorkflowTaskLaunchPreflightReport>
  listWorkflowTasks: (
    query?: WorkflowTaskListQuery
  ) => Promise<WorkflowTaskPage>
  /** OS 轻量列表投影；快照已裁剪，不能作为选中详情的冻结图。 */
  listWorkflowTaskPresentations?: (query?: WorkflowTaskListQuery) => Promise<WorkflowTaskPage>
  getWorkflowTask: (taskUuid: string) => Promise<WorkflowTask>
  getWorkflowTaskStepState?: (taskUuid: string) => Promise<import('./workflowTaskContracts').WorkflowTaskStepState>
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
