import type { BackendConfig } from './backends'
import type { HttpClient } from './http'
import { ServiceError } from './errors'
import {
  loadWorkflowActionCatalog,
  type WorkflowActionCatalogSnapshot
} from './workflowActionCatalog'
import {
  decodeWorkflowIoMetadata,
  type WorkflowIoMetadata
} from './workflowIo'
import {
  loadWorkflowMaterialSourceCatalog,
  type WorkflowMaterialSourceCatalogSnapshot
} from './workflowMaterialSource'

export type {
  WorkflowActionCatalogSnapshot,
  WorkflowActionEditorControl,
  WorkflowActionHandleTemplate,
  WorkflowActionNodeTemplate,
  WorkflowExecutableCatalogSnapshot,
  WorkflowPublishedNodeTemplate,
  WorkflowPublishedSource
} from './workflowActionCatalog'
export type {
  WorkflowInputContract,
  WorkflowInputDescriptor,
  WorkflowIoMetadata,
  WorkflowOutputBinding,
  WorkflowOutputContract,
  WorkflowOutputDescriptor,
  WorkflowValueSchema
} from './workflowIo'
export type {
  WorkflowMaterialSourceCatalogSnapshot,
  WorkflowMaterialSourceHandleTemplate,
  WorkflowMaterialSourceMaterial,
  WorkflowMaterialSourceNodeTemplate,
  WorkflowMaterialSourceResourceTemplate,
  WorkflowMaterialSourceSite
} from './workflowMaterialSource'

export type WorkflowRevision = Record<string, unknown> & {
  schema_version: '2'
  revision_id: string
  workflow_id: string
  invocations: Array<Record<string, unknown> & {
    node_id: string
    action_ref: string
    node_type?: string
    name?: string
  }>
  control_edges: Array<Record<string, unknown> & {
    source: string
    target: string
    branch?: string | null
  }>
  layout?: Record<string, unknown>
}

export interface WorkflowDocument {
  definition: {
    id: string
    name: string
  }
  revision: {
    id: string
    contentHash: string
    canonical: WorkflowRevision
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }
}

export interface WorkflowListQuery {
  page?: number
  page_size?: number
}

export interface WorkflowSummary {
  uuid: string
  create_time: string
  update_time: string
  meta_data: Record<string, unknown>
  name: string
  tags: string[]
  revision: number
}

export interface WorkflowPage {
  items: WorkflowSummary[]
  total: number
  page: number
  page_size: number
}

export interface WorkflowValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface WorkflowValidationResult {
  valid: boolean
  issues: WorkflowValidationIssue[]
  workflowRevisionHash?: string
  nodeCount?: number
  edgeCount?: number
}

export interface WorkflowAuthoringDiagnosticSourceRange {
  start_line: number
  start_column: number
  end_line: number
  end_column: number
}

export interface WorkflowAuthoringDiagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  node_id?: string
  path?: string
  workflow_handle_template_uuid?: string
  source_range?: WorkflowAuthoringDiagnosticSourceRange
}

export type WorkflowAuthoringCandidate = Record<string, unknown> & {
  revision_id: string
  parent_revision_id: string
  canonical_ir: WorkflowRevision
  python_source: string
  source_map?: Array<{
    node_id: string
    start_line: number
    start_column?: number
    end_line?: number
    end_column?: number
  }>
  diagnostics: WorkflowAuthoringDiagnostic[]
}

export interface WorkflowAuthoringResult {
  base_revision_id: string
  candidate: WorkflowAuthoringCandidate | null
  diagnostics: WorkflowAuthoringDiagnostic[]
}

export type WorkflowAuthoringState =
  | 'draft_missing'
  | 'compiling'
  | 'draft_invalid'
  | 'candidate_stale'
  | 'unapplied_source_only'
  | 'unapplied_graph'
  | 'applied'
  | 'applied_source_stale'

export interface WorkflowAuthoringSourceMapEntry {
  workflow_node_uuid: string
  start_line: number
  start_column: number
  end_line: number
  end_column: number
}

export interface WorkflowAuthoringGraph {
  workflow: Record<string, unknown> & {
    meta_data?: Record<string, unknown> & {
      unilab?: Record<string, unknown> & Partial<WorkflowIoMetadata>
    }
  }
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  node_templates: Array<Record<string, unknown>>
  handle_templates: Array<Record<string, unknown>>
}

export interface WorkflowAuthoringDraft {
  source_uri: string
  python_source: string
  draft_hash: string
  update_time: string
  diagnostics: WorkflowAuthoringDiagnostic[]
}

export interface WorkflowPersistentAuthoringCandidate {
  candidate_hash: string
  draft_hash: string
  base_workflow_revision: number
  graph: WorkflowAuthoringGraph
  normalized_python_source: string
  source_map: WorkflowAuthoringSourceMapEntry[]
  diagnostics: WorkflowAuthoringDiagnostic[]
  changeset: Record<string, unknown>
  compiler_version: string
  template_catalog_fingerprint: string
}

export interface WorkflowAppliedSource {
  python_source: string
  source_hash: string
  source_map: WorkflowAuthoringSourceMapEntry[]
  workflow_revision: number
  compiler_version: string
  template_catalog_fingerprint: string
  update_time: string
}

export interface WorkflowAuthoringAggregate {
  workflow_uuid: string
  workflow_revision: number
  state: WorkflowAuthoringState
  applied_graph: WorkflowAuthoringGraph
  draft: WorkflowAuthoringDraft | null
  candidate: WorkflowPersistentAuthoringCandidate | null
  applied_source: WorkflowAppliedSource | null
}

export interface WorkflowAuthoringDraftWriteRequest {
  python_source: string
  expected_draft_hash: string | null
  expected_workflow_revision: number
}

export interface WorkflowAuthoringApplyRequest {
  candidate_hash: string
}

export interface WorkflowAuthoringApplyResult {
  kind: 'graph' | 'source_only'
  previous_workflow_revision: number
  workflow_revision: number
  applied_candidate_hash: string
  applied_source_hash: string
  warnings: unknown[]
}

export interface WorkflowAuthoringApplyResponse {
  apply_result: WorkflowAuthoringApplyResult
  authoring: WorkflowAuthoringAggregate
}

export interface WorkflowAuthoringTransformResult {
  diagnostics: WorkflowAuthoringDiagnostic[]
  graph: WorkflowAuthoringGraph | null
  normalized_python_source: string | null
  source_map: WorkflowAuthoringSourceMapEntry[]
  changeset: Record<string, unknown> | null
  compiler_version: string
  template_catalog_fingerprint: string
}

export interface WorkflowAuthoringGeneratePythonRequest {
  workflow_uuid: string
  revision: number
  source_uri: string
  graph: WorkflowAuthoringGraph
}

export interface WorkflowAuthoringValidateRequest
  extends WorkflowAuthoringGeneratePythonRequest {
  python_source: string
}

export interface WorkflowAuthoringChangedEvent {
  id: string
  event: 'workflow.authoring.changed'
  data: {
    workflow_uuid: string
    cause: string
    workflow_revision: number
    draft_hash: string | null
    candidate_hash: string | null
  }
}

export interface WorkflowAuthoringSubscriptionOptions {
  lastEventId?: string
  onOpen?: (state: {
    lastEventId: string
    reconnected: boolean
  }) => void
  onError?: (error: Error) => void
}

export type WorkflowTaskStatus =
  | 'pending'
  | 'admission_blocked'
  | 'running'
  | 'canceling'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'timeout'

export type WorkflowTaskRunMode = 'normal' | 'step' | 'single_node'

export type WorkflowTaskControlStatus =
  | 'active'
  | 'paused'
  | 'waiting_reconciliation'

export type WorkflowTaskCleanupStatus =
  | 'none'
  | 'pending'
  | 'canceling'
  | 'settled'
  | 'requires_attention'

export interface WorkflowTaskCreateRequest {
  workflow_uuid: string
  run_mode?: WorkflowTaskRunMode
  target_node_uuid?: string | null
  input?: Record<string, unknown>
  description?: string | null
  meta_data?: Record<string, unknown>
}

export interface WorkflowTaskListQuery {
  page?: number
  page_size?: number
  workflow_uuid?: string
  status?: WorkflowTaskStatus
  cleanup_status?: WorkflowTaskCleanupStatus
}

export interface WorkflowTask {
  uuid: string
  create_time: string
  update_time: string
  description?: string
  meta_data: Record<string, unknown>
  workflow_uuid: string
  status: WorkflowTaskStatus
  workflow_snapshot: Record<string, unknown>
  execution_plan: Record<string, unknown>
  run_mode: WorkflowTaskRunMode
  target_node_uuid?: string
  control_status: WorkflowTaskControlStatus
  cleanup_status: WorkflowTaskCleanupStatus
  trace_context: Record<string, unknown>
  input: Record<string, unknown>
  output: Record<string, unknown>
  error_info: unknown[]
  timeout_at?: string
  attention_reason?: string
  terminal_ghost_detected_at?: string
  reconciliation_resume_control_status?: 'active' | 'paused'
  started_at?: string
  finished_at?: string
}

export interface WorkflowTaskPage {
  items: WorkflowTask[]
  total: number
  page: number
  page_size: number
}

export type WorkflowNodeJobStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'intervention_required'
  | 'cancel_requested'
  | 'execution_unknown'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'canceled'
  | 'timeout'

export interface WorkflowNodeJob {
  uuid: string
  create_time: string
  update_time: string
  description?: string
  meta_data: Record<string, unknown>
  workflow_task_uuid: string
  workflow_node_uuid: string
  material_uuid?: string
  edge_uuid?: string
  edge_command_uuid?: string
  feedback_sequence: number
  topological_index: number
  executor_kind: string
  execution_policy: Record<string, unknown>
  execution_timeout_seconds: number
  status: WorkflowNodeJobStatus
  attempt: number
  param: Record<string, unknown>
  feedback_data: Record<string, unknown>
  return_info: Record<string, unknown>
  control_data: Record<string, unknown>
  error_info: unknown[]
  dispatch_deadline_at?: string
  execution_deadline_at?: string
  cancel_command_uuid?: string
  cancel_ack_deadline_at?: string
  cancel_complete_deadline_at?: string
  uncertainty_reason?: string
  started_at?: string
  finished_at?: string
}

export interface WorkflowNodeJobFeedback {
  uuid: string
  create_time: string
  update_time: string
  description?: string
  meta_data: Record<string, unknown>
  workflow_node_job_uuid: string
  sequence: number
  feedback_type: string
  data: Record<string, unknown>
  observed_at: string
  received_at: string
  published_at?: string
  idempotency_key: string
}

export interface WorkflowNodeJobFeedbackQuery {
  after_sequence?: number
  limit?: number
}

export interface WorkflowNodeJobFeedbackPage {
  items: WorkflowNodeJobFeedback[]
  next_cursor: number
  has_more: boolean
}

export type WorkflowTaskRuntimeEventKind =
  | 'task_transition'
  | 'job_transition'
  | 'command_consumed'
  | 'feedback_committed'
  | 'uncertainty_opened'
  | 'uncertainty_resolved'
  | 'startup_recovered'

export interface WorkflowTaskRuntimeEvent {
  sequence: number
  workflow_task_uuid: string
  workflow_node_job_uuid?: string
  workflow_task_command_uuid?: string
  workflow_node_uuid?: string
  kind: WorkflowTaskRuntimeEventKind
  from_status?: string
  to_status?: string
  data: Record<string, unknown>
  create_time: string
  executor_kind?: string
  attempt?: number
  param?: Record<string, unknown>
  return_info?: Record<string, unknown>
  error_info?: unknown[]
  feedback_type?: string
  feedback?: Record<string, unknown>
  command_type?: string
  command_result?: Record<string, unknown>
}

export interface WorkflowTaskRuntimeEventQuery {
  after_sequence?: number
  limit?: number
}

export interface WorkflowTaskRuntimeEventPage {
  items: WorkflowTaskRuntimeEvent[]
  next_cursor: number
  has_more: boolean
}

export interface WorkflowRuntimeChangedEvent {
  id: string
  event: 'workflow.runtime.changed'
  data: {
    workflow_task_uuid: string
  }
}

export interface DeviceActionTaskChangedEvent {
  id: string
  event: 'device_action_task.changed'
  data: {
    task_uuid: string
  }
}

export type WorkflowRuntimeInvalidationEvent =
  | WorkflowRuntimeChangedEvent
  | DeviceActionTaskChangedEvent

export interface WorkflowRuntimeSubscriptionOptions {
  lastEventId?: string
  onOpen?: (state: {
    lastEventId: string
    reconnected: boolean
  }) => void
  onError?: (error: Error) => void
}

export type WorkflowTaskCommandType = 'step' | 'pause' | 'resume' | 'cancel'

export interface WorkflowTaskCommandRequest {
  type: WorkflowTaskCommandType
  target_node_uuid?: string | null
  idempotency_key: string
  description?: string | null
  meta_data?: Record<string, unknown>
}

export interface WorkflowTaskCommand {
  uuid: string
  create_time: string
  update_time: string
  description?: string
  meta_data: Record<string, unknown>
  workflow_task_uuid: string
  type: WorkflowTaskCommandType
  target_node_uuid?: string
  idempotency_key: string
  status: 'pending' | 'succeeded' | 'rejected'
  result: Record<string, unknown>
  trace_context: Record<string, unknown>
  consumed_at?: string
}

export interface WorkflowEventSubscription {
  dispose: () => void
}

export interface WorkflowRuntimePort {
  getWorkflowActionCatalog: (
    signal?: AbortSignal
  ) => Promise<WorkflowActionCatalogSnapshot>
  getWorkflowMaterialSourceCatalog: () =>
    Promise<WorkflowMaterialSourceCatalogSnapshot>
  listWorkflows: (query?: WorkflowListQuery) => Promise<WorkflowPage>
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
  createWorkflowTask: (
    request: WorkflowTaskCreateRequest
  ) => Promise<WorkflowTask>
  listWorkflowTasks: (
    query?: WorkflowTaskListQuery
  ) => Promise<WorkflowTaskPage>
  getWorkflowTask: (taskUuid: string) => Promise<WorkflowTask>
  listWorkflowTaskJobs: (
    taskUuid: string
  ) => Promise<WorkflowNodeJob[]>
  listWorkflowTaskEvents: (
    taskUuid: string,
    query?: WorkflowTaskRuntimeEventQuery
  ) => Promise<WorkflowTaskRuntimeEventPage>
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

export function createWorkflowRuntime(
  http: HttpClient,
  backend: BackendConfig
): WorkflowRuntimePort {
  const subscriptions = new Set<WorkflowEventSubscription>()

  const request = async <Value>(
    path: string,
    init?: RequestInit
  ): Promise<Value> => unwrap<Value>(await http.request<unknown>(path, init))

  const authoringRequest = async <Value>(
    path: string,
    init?: RequestInit
  ): Promise<Value> => strictAuthoringData<Value>(
    await http.request<unknown>(path, init)
  )

  const runtimeRequest = async <Value>(
    path: string,
    init?: RequestInit
  ): Promise<Value> => strictRuntimeData<Value>(
    await http.request<unknown>(path, init)
  )

  const port: WorkflowRuntimePort = {
    getWorkflowActionCatalog: (signal) => loadWorkflowActionCatalog(http, signal),
    getWorkflowMaterialSourceCatalog: () =>
      loadWorkflowMaterialSourceCatalog(http),
    listWorkflows: (query = {}) =>
      runtimeRequest(workflowListPath(query)),
    getWorkflowAuthoring: async (workflowUuid) =>
      decodeWorkflowAuthoringAggregate(await authoringRequest(
        `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/authoring`
      )),
    saveWorkflowAuthoringDraft: (workflowUuid, body) =>
      authoringRequest(
        `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/authoring/draft`,
        {
          method: 'PUT',
          headers: jsonHeaders(),
          body: JSON.stringify(body)
        }
      ),
    applyWorkflowAuthoring: (workflowUuid, body) =>
      authoringRequest(
        `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/authoring/apply`,
        {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ candidate_hash: body.candidate_hash })
        }
      ),
    subscribeWorkflowAuthoring: (
      workflowUuid,
      onInvalidate,
      options = {}
    ) => {
      let disposed = false
      let controller: AbortController | null = null
      let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
      let cursor = options.lastEventId || ''
      let openedConnections = 0
      const seenEventIds = new Set<string>()

      const scheduleReconnect = (): void => {
        if (disposed || reconnectTimer !== null) return
        reconnectTimer = globalThis.setTimeout(() => {
          reconnectTimer = null
          void connect()
        }, 3000)
      }

      const connect = async (): Promise<void> => {
        if (disposed) return
        controller = new AbortController()
        const headers = new Headers({ Accept: 'text/event-stream' })
        if (cursor) headers.set('Last-Event-ID', cursor)
        try {
          const response = await globalThis.fetch(
            workflowEventsUrl(backend),
            { headers, signal: controller.signal }
          )
          if (!response.ok || !response.body) {
            throw new Error(
              `Authoring SSE 连接失败: ${response.status} ${response.statusText}`
            )
          }
          options.onOpen?.({
            lastEventId: cursor,
            reconnected: openedConnections > 0
          })
          openedConnections += 1
          await readSseStream(response.body, (frame) => {
            if (frame.id) cursor = frame.id
            if (frame.event !== 'workflow.authoring.changed') return
            const data = parseAuthoringChangedData(frame.data)
            if (!data || data.workflow_uuid !== workflowUuid) return
            if (frame.id && seenEventIds.has(frame.id)) return
            if (frame.id) {
              seenEventIds.add(frame.id)
              if (seenEventIds.size > 512) {
                const oldest = seenEventIds.values().next().value
                if (oldest !== undefined) seenEventIds.delete(oldest)
              }
            }
            onInvalidate({
              id: frame.id,
              event: 'workflow.authoring.changed',
              data
            })
          }, controller.signal)
          scheduleReconnect()
        } catch (error) {
          if (disposed || controller.signal.aborted) return
          options.onError?.(asError(error))
          scheduleReconnect()
        }
      }

      const subscription: WorkflowEventSubscription = {
        dispose: () => {
          if (disposed) return
          disposed = true
          controller?.abort()
          if (reconnectTimer !== null) {
            globalThis.clearTimeout(reconnectTimer)
          }
          subscriptions.delete(subscription)
        }
      }
      subscriptions.add(subscription)
      void connect()
      return subscription
    },
    generateWorkflowAuthoringPython: async (body) =>
      decodeWorkflowAuthoringTransform(await authoringRequest(
        '/api/v1/authoring/generate-python', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body)
      })),
    validateWorkflowAuthoring: async (body) =>
      decodeWorkflowAuthoringTransform(await authoringRequest(
        '/api/v1/authoring/validate', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body)
      })),
    getWorkflow: (workflowId) =>
      request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/graph`),
    saveWorkflow: (workflowId, revision, expectedRevisionId) =>
      request(`/api/v1/workflows/${encodeURIComponent(workflowId)}/graph`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({
          revision,
          ...(expectedRevisionId ? { expectedRevisionId } : {})
        })
      }),
    validateWorkflow: (revision, parameters) =>
      request('/api/v1/workflows:validate', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ revision, parameters })
      }),
    compilePythonWorkflow: (baseRevisionId, pythonSource, sourceUri) =>
      request('/api/v1/authoring/compile', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          base_revision_id: baseRevisionId,
          python_source: pythonSource,
          source_uri: sourceUri
        })
      }),
    generatePythonWorkflow: (baseRevisionId, revision, sourceUri) =>
      request('/api/v1/authoring/generate-python', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          base_revision_id: baseRevisionId,
          canonical_ir: revision,
          source_uri: sourceUri
        })
      }),
    validateAuthoringCandidate: (baseRevisionId, candidate) =>
      request('/api/v1/authoring/validate', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          base_revision_id: baseRevisionId,
          candidate
        })
      }),
    createWorkflowTask: (body) =>
      runtimeRequest('/api/v1/workflow-tasks', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(body)
      }),
    listWorkflowTasks: (query = {}) =>
      runtimeRequest(workflowTaskListPath(query)),
    getWorkflowTask: (taskUuid) =>
      runtimeRequest(
        `/api/v1/workflow-tasks/${encodeURIComponent(taskUuid)}`
      ),
    listWorkflowTaskJobs: (taskUuid) =>
      runtimeRequest(
        `/api/v1/workflow-tasks/${encodeURIComponent(taskUuid)}/jobs`
      ),
    listWorkflowTaskEvents: (taskUuid, query = {}) =>
      runtimeRequest(workflowTaskRuntimeEventsPath(taskUuid, query)),
    commandWorkflowTask: (taskUuid, body) =>
      runtimeRequest(
        `/api/v1/workflow-tasks/${encodeURIComponent(taskUuid)}/commands`,
        {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify(body)
        }
      ),
    getWorkflowNodeJob: (jobUuid) =>
      runtimeRequest(
        `/api/v1/workflow-node-jobs/${encodeURIComponent(jobUuid)}`
      ),
    listWorkflowNodeJobFeedback: (jobUuid, query = {}) =>
      runtimeRequest(workflowNodeJobFeedbackPath(jobUuid, query)),
    subscribeWorkflowRuntime: (onInvalidate, options = {}) => {
      let disposed = false
      let controller: AbortController | null = null
      let reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
      let cursor = options.lastEventId || ''
      let openedConnections = 0
      const seenEventIds = new Set<string>()

      const scheduleReconnect = (): void => {
        if (disposed || reconnectTimer !== null) return
        reconnectTimer = globalThis.setTimeout(() => {
          reconnectTimer = null
          void connect()
        }, 3000)
      }

      const connect = async (): Promise<void> => {
        if (disposed) return
        controller = new AbortController()
        const headers = new Headers({ Accept: 'text/event-stream' })
        if (cursor) headers.set('Last-Event-ID', cursor)
        try {
          const response = await globalThis.fetch(
            workflowEventsUrl(backend),
            { headers, signal: controller.signal }
          )
          if (!response.ok || !response.body) {
            throw new Error(
              `Workflow Runtime SSE 连接失败: ${response.status} ${response.statusText}`
            )
          }
          options.onOpen?.({
            lastEventId: cursor,
            reconnected: openedConnections > 0
          })
          openedConnections += 1
          await readSseStream(response.body, (frame) => {
            if (frame.id) cursor = frame.id
            if (
              frame.event !== 'workflow.runtime.changed' &&
              frame.event !== 'device_action_task.changed'
            ) return
            if (frame.id && seenEventIds.has(frame.id)) return
            if (frame.id) {
              seenEventIds.add(frame.id)
              if (seenEventIds.size > 512) {
                const oldest = seenEventIds.values().next().value
                if (oldest !== undefined) seenEventIds.delete(oldest)
              }
            }
            const data = frame.event === 'workflow.runtime.changed'
              ? parseRuntimeChangedData(frame.data)
              : parseDeviceActionTaskChangedData(frame.data)
            if (!data) {
              options.onError?.(
                new Error('Workflow Runtime SSE 返回了无效事件')
              )
              return
            }
            onInvalidate({
              id: frame.id,
              event: frame.event,
              data
            } as WorkflowRuntimeInvalidationEvent)
          }, controller.signal)
          if (!disposed && !controller.signal.aborted) {
            options.onError?.(
              new Error('Workflow Runtime SSE 连接已断开，正在重连')
            )
          }
          scheduleReconnect()
        } catch (error) {
          if (disposed || controller.signal.aborted) return
          options.onError?.(asError(error))
          scheduleReconnect()
        }
      }

      const subscription: WorkflowEventSubscription = {
        dispose: () => {
          if (disposed) return
          disposed = true
          controller?.abort()
          if (reconnectTimer !== null) {
            globalThis.clearTimeout(reconnectTimer)
          }
          subscriptions.delete(subscription)
        }
      }
      subscriptions.add(subscription)
      void connect()
      return subscription
    },
    dispose: () => {
      for (const subscription of [...subscriptions]) subscription.dispose()
    }
  }
  return port
}

function unwrap<Value>(raw: unknown): Value {
  if (
    raw &&
    typeof raw === 'object' &&
    Object.prototype.hasOwnProperty.call(raw, 'data')
  ) {
    return (raw as { data: Value }).data
  }
  return raw as Value
}

function strictAuthoringData<Value>(raw: unknown): Value {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidAuthoringResponse()
  }
  const envelope = raw as Record<string, unknown>
  if (
    envelope.code !== 0 ||
    !Object.prototype.hasOwnProperty.call(envelope, 'data')
  ) {
    throw invalidAuthoringResponse()
  }
  return envelope.data as Value
}

function decodeWorkflowAuthoringAggregate(
  value: unknown
): WorkflowAuthoringAggregate {
  try {
    const aggregate = authoringRecord(value)
    decodeWorkflowAuthoringGraph(aggregate.applied_graph)
    return aggregate as unknown as WorkflowAuthoringAggregate
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw invalidAuthoringResponse()
  }
}

function decodeWorkflowAuthoringTransform(
  value: unknown
): WorkflowAuthoringTransformResult {
  try {
    const transform = authoringRecord(value)
    requireExactAuthoringKeys(transform, [
      'diagnostics',
      'graph',
      'normalized_python_source',
      'source_map',
      'changeset',
      'compiler_version',
      'template_catalog_fingerprint'
    ])
    if (!Array.isArray(transform.diagnostics)) throw invalidAuthoringResponse()
    for (const diagnostic of transform.diagnostics) {
      decodeAuthoringDiagnostic(diagnostic)
    }
    if (transform.graph !== null) decodeWorkflowAuthoringGraph(transform.graph)
    if (
      transform.normalized_python_source !== null &&
      typeof transform.normalized_python_source !== 'string'
    ) throw invalidAuthoringResponse()
    if (!Array.isArray(transform.source_map)) throw invalidAuthoringResponse()
    for (const entry of transform.source_map) decodeAuthoringSourceMap(entry)
    if (transform.changeset !== null) authoringRecord(transform.changeset)
    if (
      typeof transform.compiler_version !== 'string' ||
      !transform.compiler_version
    ) throw invalidAuthoringResponse()
    if (
      typeof transform.template_catalog_fingerprint !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(
        transform.template_catalog_fingerprint
      )
    ) throw invalidAuthoringResponse()
    return transform as unknown as WorkflowAuthoringTransformResult
  } catch (error) {
    if (error instanceof ServiceError) throw error
    throw invalidAuthoringResponse()
  }
}

function decodeAuthoringDiagnostic(value: unknown): void {
  const diagnostic = authoringRecord(value)
  requireAllowedAuthoringKeys(
    diagnostic,
    ['severity', 'code', 'message'],
    ['node_id', 'path', 'workflow_handle_template_uuid', 'source_range']
  )
  if (
    (diagnostic.severity !== 'error' && diagnostic.severity !== 'warning') ||
    typeof diagnostic.code !== 'string' ||
    typeof diagnostic.message !== 'string'
  ) throw invalidAuthoringResponse()
  for (const key of [
    'node_id',
    'path',
    'workflow_handle_template_uuid'
  ]) {
    if (diagnostic[key] !== undefined && typeof diagnostic[key] !== 'string') {
      throw invalidAuthoringResponse()
    }
  }
  if (diagnostic.source_range !== undefined) {
    const range = authoringRecord(diagnostic.source_range)
    requireExactAuthoringKeys(range, [
      'start_line',
      'start_column',
      'end_line',
      'end_column'
    ])
    for (const key of [
      'start_line',
      'start_column',
      'end_line',
      'end_column'
    ]) {
      if (!Number.isInteger(range[key])) throw invalidAuthoringResponse()
    }
  }
}

function decodeAuthoringSourceMap(value: unknown): void {
  const entry = authoringRecord(value)
  requireExactAuthoringKeys(entry, [
    'workflow_node_uuid',
    'start_line',
    'start_column',
    'end_line',
    'end_column'
  ])
  if (typeof entry.workflow_node_uuid !== 'string') {
    throw invalidAuthoringResponse()
  }
  for (const key of [
    'start_line',
    'start_column',
    'end_line',
    'end_column'
  ]) {
    if (!Number.isInteger(entry[key])) throw invalidAuthoringResponse()
  }
}

function decodeWorkflowAuthoringGraph(value: unknown): void {
  const graph = authoringRecord(value)
  for (const key of ['nodes', 'edges', 'node_templates', 'handle_templates']) {
    if (!Array.isArray(graph[key])) throw invalidAuthoringResponse()
  }
  const workflow = authoringRecord(graph.workflow)
  if (workflow.meta_data === undefined) return
  const metaData = authoringRecord(workflow.meta_data)
  if (metaData.unilab === undefined) return
  const unilab = authoringRecord(metaData.unilab)
  const ioKeys = ['input_contract', 'output_contract', 'output_bindings']
  if (!ioKeys.some((key) => Object.hasOwn(unilab, key))) return
  decodeWorkflowIoMetadata(unilab)
}

function requireExactAuthoringKeys(
  value: Record<string, unknown>,
  keys: string[]
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) throw invalidAuthoringResponse()
}

function requireAllowedAuthoringKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[]
): void {
  const allowed = new Set([...required, ...optional])
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) throw invalidAuthoringResponse()
}

function authoringRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidAuthoringResponse()
  }
  return value as Record<string, unknown>
}

function strictRuntimeData<Value>(raw: unknown): Value {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidRuntimeResponse()
  }
  const envelope = raw as Record<string, unknown>
  if (
    envelope.code !== 0 ||
    !Object.prototype.hasOwnProperty.call(envelope, 'data') ||
    Object.prototype.hasOwnProperty.call(envelope, 'error')
  ) {
    throw invalidRuntimeResponse()
  }
  return envelope.data as Value
}

function invalidAuthoringResponse(): ServiceError {
  return new ServiceError({
    code: 'INVALID_API_RESPONSE',
    message: 'Authoring 服务返回了无效响应',
    retryable: false
  })
}

function invalidRuntimeResponse(): ServiceError {
  return new ServiceError({
    code: 'INVALID_API_RESPONSE',
    message: 'Workflow Runtime 服务返回了无效响应',
    retryable: false
  })
}

function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' }
}

function workflowEventsUrl(backend: BackendConfig): string {
  const url = new URL(backend.apiUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/events`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function workflowTaskListPath(query: WorkflowTaskListQuery): string {
  const search = new URLSearchParams()
  for (const key of [
    'page',
    'page_size',
    'workflow_uuid',
    'status',
    'cleanup_status'
  ] as const) {
    const value = query[key]
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const suffix = search.toString()
  return `/api/v1/workflow-tasks${suffix ? `?${suffix}` : ''}`
}

function workflowListPath(query: WorkflowListQuery): string {
  const search = new URLSearchParams()
  if (query.page !== undefined) search.set('page', String(query.page))
  if (query.page_size !== undefined) {
    search.set('page_size', String(query.page_size))
  }
  const suffix = search.toString()
  return `/api/v1/workflows${suffix ? `?${suffix}` : ''}`
}

function workflowNodeJobFeedbackPath(
  jobUuid: string,
  query: WorkflowNodeJobFeedbackQuery
): string {
  const search = new URLSearchParams()
  if (query.after_sequence !== undefined) {
    search.set('after_sequence', String(query.after_sequence))
  }
  if (query.limit !== undefined) search.set('limit', String(query.limit))
  const suffix = search.toString()
  const base = `/api/v1/workflow-node-jobs/${
    encodeURIComponent(jobUuid)
  }/feedback`
  return `${base}${suffix ? `?${suffix}` : ''}`
}

function workflowTaskRuntimeEventsPath(
  taskUuid: string,
  query: WorkflowTaskRuntimeEventQuery
): string {
  const search = new URLSearchParams()
  if (query.after_sequence !== undefined) {
    search.set('after_sequence', String(query.after_sequence))
  }
  if (query.limit !== undefined) search.set('limit', String(query.limit))
  const suffix = search.toString()
  const base = `/api/v1/workflow-tasks/${encodeURIComponent(taskUuid)}/events`
  return `${base}${suffix ? `?${suffix}` : ''}`
}

interface ParsedSseFrame {
  id: string
  event: string
  data: string
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onFrame: (frame: ParsedSseFrame) => void,
  signal: AbortSignal
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''
      for (const value of frames) {
        const parsed = parseSseFrame(value)
        if (parsed) onFrame(parsed)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function parseSseFrame(value: string): ParsedSseFrame | null {
  let id = ''
  let event = 'message'
  const data: string[] = []
  for (const line of value.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const raw = separator < 0 ? '' : line.slice(separator + 1)
    const fieldValue = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'id') id = fieldValue
    else if (field === 'event') event = fieldValue
    else if (field === 'data') data.push(fieldValue)
  }
  if (data.length === 0 && id === '') return null
  return { id, event, data: data.join('\n') }
}

function parseAuthoringChangedData(
  value: string
): WorkflowAuthoringChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      typeof data.workflow_uuid !== 'string' ||
      typeof data.cause !== 'string' ||
      typeof data.workflow_revision !== 'number' ||
      !(
        data.draft_hash === null ||
        typeof data.draft_hash === 'string'
      ) ||
      !(
        data.candidate_hash === null ||
        typeof data.candidate_hash === 'string'
      )
    ) {
      return null
    }
    return {
      workflow_uuid: data.workflow_uuid,
      cause: data.cause,
      workflow_revision: data.workflow_revision,
      draft_hash: data.draft_hash,
      candidate_hash: data.candidate_hash
    }
  } catch {
    return null
  }
}

function parseRuntimeChangedData(
  value: string
): WorkflowRuntimeChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 1 ||
      typeof data.workflow_task_uuid !== 'string' ||
      data.workflow_task_uuid.trim() === ''
    ) {
      return null
    }
    return { workflow_task_uuid: data.workflow_task_uuid }
  } catch {
    return null
  }
}

function parseDeviceActionTaskChangedData(
  value: string
): DeviceActionTaskChangedEvent['data'] | null {
  try {
    const data = JSON.parse(value) as Record<string, unknown>
    if (
      Object.keys(data).length !== 1 ||
      typeof data.task_uuid !== 'string' ||
      data.task_uuid.trim() === ''
    ) {
      return null
    }
    return { task_uuid: data.task_uuid }
  } catch {
    return null
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
