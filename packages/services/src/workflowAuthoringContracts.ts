import type { WorkflowIoMetadata } from './workflowIo'

/**
 * 工作流创作（Workflow Authoring）的稳定传输合同。
 *
 * 本文件只描述 wire shape，不拥有创作状态，也不解释运行时生命周期。
 */

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
  description?: string
  definition_status?: 'empty' | 'configured'
}

export interface WorkflowPage {
  items: WorkflowSummary[]
  total: number
  page: number
  page_size: number
}

export interface WorkflowDefinitionCreateRequest {
  name: string
  description?: string
  tags: string[]
  meta_data?: Record<string, unknown>
}

export type WorkflowDefinitionChangeAction =
  | 'created'
  | 'current_snapshot'
  | 'metadata_updated'
  | 'graph_saved'
  | 'authoring_applied'
  | 'deleted'

export interface WorkflowDefinitionChange {
  sequence: number
  workflow_uuid: string
  revision: number
  action: WorkflowDefinitionChangeAction
  summary: string
  details: Record<string, unknown>
  create_time: string
}

export interface WorkflowDefinitionChangePage {
  items: WorkflowDefinitionChange[]
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

export type WorkflowTopologyAuthoring =
  | {
      authority: 'python_source'
      graph_mode: 'read_write'
      graph_to_python: 'supported'
    }
  | {
      authority: 'managed_exact_graph'
      graph_mode: 'read_only'
      graph_to_python: 'unsupported'
    }

export interface WorkflowAuthoringAggregate {
  workflow_uuid: string
  workflow_revision: number
  state: WorkflowAuthoringState
  applied_graph: WorkflowAuthoringGraph
  draft: WorkflowAuthoringDraft | null
  candidate: WorkflowPersistentAuthoringCandidate | null
  applied_source: WorkflowAppliedSource | null
  topology_authoring: WorkflowTopologyAuthoring
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
