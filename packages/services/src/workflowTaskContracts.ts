/**
 * 工作流任务（WorkflowTask）及其作业、命令与事件的稳定传输合同。
 *
 * 类型只复刻服务端事实；前端不得用这些接口建立第二套运行权威。
 */

import type { WorkflowValueSchema } from './workflowIo'

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

/** 工作流正式运行前可供操作者选择的已应用节点。 */
export interface WorkflowRunNodeOption {
  workflow_node_uuid: string
  workflow_node_template_uuid?: string
  name: string
  type: string
  disabled: boolean
  description?: string
  action_name?: string
  action_type?: string
  position?: {
    x: number
    y: number
  }
  material_source?: WorkflowRunMaterialSourceOption
  handles: WorkflowRunHandleOption[]
}

/** 已有工作流只读定义中的物料来源（MaterialSource）选择器事实。 */
export interface WorkflowRunMaterialSourceOption {
  mode: string
  flow_role: string
  custody_policy: 'task_exclusive' | 'shared_source'
  mount_uuid: string
  resource_template_uuid: string
}

/** 已有工作流只读画布中的一个稳定端口。 */
export interface WorkflowRunHandleOption {
  uuid: string
  handle_key: string
  display_name: string
  io_type: 'source' | 'target'
  value_type: string
  data_key?: string
}

/** 已有工作流只读画布中的一条稳定有向连线。 */
export interface WorkflowRunEdgeOption {
  uuid: string
  source_node_uuid: string
  target_node_uuid: string
  source_handle_uuid: string
  target_handle_uuid: string
}

/** 工作流正式运行入口所需的只读定义快照。 */
export interface WorkflowRunPreparation {
  workflow_uuid: string
  workflow_revision: number
  nodes: WorkflowRunNodeOption[]
  edges: WorkflowRunEdgeOption[]
}

export type WorkflowRunPreflightStatus =
  | 'ready'
  | 'requires_confirmation'
  | 'blocked'

export type WorkflowRunPreflightCheckStatus =
  | 'passed'
  | 'blocked'
  | 'deferred'
  | 'confirmation_required'

/** Backend 对候选工作流运行范围执行的一项只读检查。 */
export interface WorkflowRunPreflightCheck {
  type: string
  status: WorkflowRunPreflightCheckStatus
  code: string
  message: string
  blocking: boolean
  node_uuid?: string
  node_name?: string
  details: Record<string, unknown>
}

/** Backend 在创建任务前返回的只读可运行性报告。 */
export interface WorkflowRunPreflightReport {
  workflow_uuid: string
  workflow_revision: number
  run_mode: WorkflowTaskRunMode
  target_node_uuid?: string
  status: WorkflowRunPreflightStatus
  can_run: boolean
  checked_at: string
  summary: {
    execution_node_count: number
    passed_check_count: number
    blocking_check_count: number
    deferred_check_count: number
    confirmation_required_count: number
  }
  checks: WorkflowRunPreflightCheck[]
}

export type WorkflowTaskControlStatus =
  | 'active'
  | 'paused'
  | 'waiting_intervention'
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
  inventory_bindings?: WorkflowInventoryBinding[]
  input?: Record<string, unknown>
  description?: string | null
  meta_data?: Record<string, unknown>
}

/** Backend 在一次工作流任务（WorkflowTask）中冻结的库存实例绑定。 */
export interface WorkflowInventoryBinding {
  requirement_key: string
  inventory_type: 'reagent' | 'current_substance'
  inventory_uuid: string
  reserved_quantity: number
  quantity_unit: string
}

export interface DebugWorkflowTaskCreateRequest {
  workflow_uuid: string
  start_node_uuids: string[]
  breakpoint_node_uuids: string[]
  input?: Record<string, unknown>
  description?: string | null
  meta_data?: Record<string, unknown>
  launch_overrides?: DebugLaunchOverride[]
  preflight_hash?: string
}

export type DebugLaunchRequirementReason =
  | 'start_scope'
  | 'disabled_node'
  | 'out_of_scope'

export interface DebugLaunchOverride {
  requirement_id: string
  value: unknown
  confirmed?: boolean
}

export interface DebugLaunchMaterialSuggestion {
  id: string
  material_uuid: string
  material_name: string
  resource_template_uuid: string
  recommended: boolean
  requires_confirmation: true
  actual: {
    site: { uuid: string; name: string } | null
    status: string | null
  }
  inferred_target: {
    kind: 'same_material_passthrough' | 'selected_inventory_candidate'
    through_node_uuids: string[]
    site: { uuid: string; name?: string } | null
    status: string | null
  }
}

export interface DebugLaunchRequirement {
  id: string
  kind: 'value' | 'material'
  reason: DebugLaunchRequirementReason
  required: true
  target: {
    node_uuid: string
    node_name: string
    handle_uuid: string
    data_key: string
    display_name: string
  }
  schema: WorkflowValueSchema
  upstream_nodes: Array<{
    node_uuid: string
    node_name: string
    disabled: boolean
  }>
  allowed_resource_template_uuids?: string[]
  suggestions: DebugLaunchMaterialSuggestion[]
}

export interface DebugWorkflowTaskPreflightRequest {
  workflow_uuid: string
  start_node_uuids: string[]
  breakpoint_node_uuids: string[]
  input?: Record<string, unknown>
  launch_overrides?: DebugLaunchOverride[]
}

export interface DebugWorkflowTaskPreflight {
  workflow_uuid: string
  workflow_revision: number
  status: 'needs_input' | 'ready'
  preflight_hash: string
  requirements: DebugLaunchRequirement[]
  diagnostics: Array<{
    code: string
    message: string
    requirement_id?: string
  }>
  launch_overrides: Array<{
    requirement_id: string
    target_node_uuid: string
    target_handle_uuid: string
    value: unknown
    confirmed: boolean
  }>
}

export interface WorkflowNodeAdmissionHold {
  uuid: string
  workflow_task_uuid: string
  workflow_node_job_uuid: string
  workflow_node_uuid: string
  attempt: number
  reason: 'start' | 'breakpoint' | 'step'
  status: 'open' | 'released' | 'canceled'
  create_time: string
  update_time: string
  released_at?: string
}

export interface DebugWorkflowTaskProjection {
  task: WorkflowTask
  jobs: WorkflowNodeJob[]
  configuration: {
    start_node_uuids: string[]
    breakpoint_node_uuids: string[]
  }
  execution_policy: 'step' | 'continue'
  status: 'paused' | 'running' | 'completed' | 'stopped'
  holds: WorkflowNodeAdmissionHold[]
  active_node_uuids: string[]
  out_of_scope_node_uuids: string[]
  disabled_node_uuids: string[]
}

export interface DebugWorkflowTaskCommandRequest {
  type: 'step' | 'continue'
  scope: { type: 'hold'; hold_uuid: string }
  idempotency_key: string
}

export interface DebugWorkflowTaskCommand {
  uuid: string
  workflow_task_uuid: string
  type: 'step' | 'continue'
  scope: { type: 'hold'; hold_uuid: string }
  idempotency_key: string
  status: 'pending' | 'succeeded' | 'rejected'
  result: Record<string, unknown>
  create_time: string
  update_time: string
  consumed_at?: string
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
  input?: Record<string, unknown>
  output?: Record<string, unknown>
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

export interface DeviceCatalogChangedEvent {
  id: string
  event: 'device.catalog.changed'
  data: {
    catalog_revision: number
  }
}

export interface WorkflowDefinitionChangedEvent {
  id: string
  event: 'workflow.definition.changed'
  data: {
    workflow_uuid: string
    workflow_revision: number
  }
}

export type WorkflowRuntimeInvalidationEvent =
  | WorkflowRuntimeChangedEvent
  | DeviceActionTaskChangedEvent
  | DeviceCatalogChangedEvent
  | WorkflowDefinitionChangedEvent

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
