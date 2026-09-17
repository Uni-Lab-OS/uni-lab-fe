// OS 工站异常处置的公开契约。所有版本与执行结果由 OS 提供。
export interface RecoveryActionSchema {
  type?: string | string[]
  title?: string
  description?: string
  properties?: Record<string, RecoveryActionSchema>
  required?: string[]
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  items?: RecoveryActionSchema
  anyOf?: RecoveryActionSchema[]
  [key: string]: unknown
}
export type ErrorDecisionAction = 'cancel_task' | 'retry_current_node' | 'enter_manual_handling'
export type HandlingStage = 'DECISION_REQUIRED' | 'MANUAL_HANDLING' | 'APPLYING' | 'RESOLVED'

export interface StationError {
  decision_id: string
  decision_version: number
  source_task_uuid: string
  source_job_uuid: string
  stage: HandlingStage
  status: string
  session_id?: string | null
  meta_data: { message?: string; source_node_id?: string }
}

export interface HandlingSession {
  session_id: string
  decision_id: string
  stage: HandlingStage
  version: number
  summary: string
}

export interface ManualActionJob {
  uuid: string
  workflow_task_uuid: string
  status: string
  edge_command_uuid: string
  start_state: string
  uncertainty_reason?: string | null
  review_version?: string
  result_reviewed?: boolean
  execution_source?: string
  action_name?: string
  device_id?: string
  control_data?: { dispatch_payload?: { action?: string; device_id?: string } }
  param?: Record<string, unknown>
  return_info?: unknown
  error_info?: unknown
  feedback_data?: unknown
  started_at?: string | null
  finished_at?: string | null
  meta_data: { session_id: string; source_task_uuid: string; source_job_uuid: string; source_node_id: string }
}

export interface ManualActionReviewAudit {
  review_version: string
  operator_id: string
  reviewed_at: string
  reason: string
}

export interface HistoricalManualReviewContext {
  station_id: string
  session_id: string
  session_stage: HandlingStage
  job: ManualActionJob
  review_version: string
  result_reviewed: boolean
  manual_review: ManualActionReviewAudit | null
}

export interface HistoricalManualReviewIntent {
  key: string
  body: { expected_review_version: string; reason: string; operator_confirmed: true }
}

export interface ControlCommandSummary {
  command_uuid: string
  status: 'PENDING' | 'APPLIED' | 'FAILED'
  operation: string
  needs_apply: boolean
}

export interface StationSnapshot {
  station_id: string
  mode: 'RUNNING' | 'PAUSED'
  station_version: number
  error_epoch: number
  snapshot_id: string
  active_session_id: string | null
  active_session: HandlingSession | null
  errors: StationError[]
  manual_actions: ManualActionJob[]
  control_commands: ControlCommandSummary[]
}

export interface HandlingCommand {
  command_uuid: string
  status: 'PENDING' | 'APPLIED' | 'FAILED'
  result: { error?: string; manual_command_id?: string; [key: string]: unknown }
  station: StationSnapshot
  application_error?: string
  dispatch_error?: string
}

export interface ManualDeviceAction {
  action_id: string
  action_version: string
  name: string
  display_name: string
  parameter_schema: RecoveryActionSchema
  defaults: Record<string, unknown>
  device_binding: { material_uuid: string; edge_local_id: string }
}

export interface HandlingInventory {
  instances: Array<{ edge_uuid: string; name: string; parent_uuid: string; version: number }>
  sites: Array<{ uuid: string; material_uuid: string; name: string; occupied_material_uuid: string | null; update_time: string }>
}

export interface ResourceOccupancy {
  uuid: string
  create_time?: string
  lock_key: string
  state: string
  occupancy_kind: string
  version: string
  workflow_task_uuid?: string
  workflow_node_job_uuid?: string
  task_uuid?: string
  material_uuid?: string
  device_id?: string
}

export interface HandlingIntent {
  path: string
  body: Record<string, unknown>
  key: string
  label: string
}

export function versionFields(snapshot: StationSnapshot) {
  return { expected_station_version: snapshot.station_version }
}

export function sessionFields(snapshot: StationSnapshot, session: HandlingSession) {
  return { ...versionFields(snapshot), expected_session_version: session.version }
}

export function decisionIntent(snapshot: StationSnapshot, error: StationError, action: ErrorDecisionAction, resume: boolean, reason: string): Omit<HandlingIntent, 'key' | 'label'> {
  const session = snapshot.active_session
  return {
    path: `/errors/${encodeURIComponent(error.decision_id)}/decision`,
    body: {
      ...versionFields(snapshot), action, expected_decision_version: error.decision_version,
      observed_error_epoch: snapshot.error_epoch,
      resume_requested: action !== 'enter_manual_handling' && resume,
      operator_confirmed: action !== 'enter_manual_handling' && resume,
      ...(action !== 'enter_manual_handling' && resume ? { confirm_snapshot_id: snapshot.snapshot_id } : {}),
      ...(session?.decision_id === error.decision_id ? { session_id: session.session_id, expected_session_version: session.version } : {}),
      reason,
    },
  }
}

const errors: Record<string, string> = {
  station_version_conflict: '工站状态已变化，请核对刷新后的错误与现场状态，再次选择。',
  decision_conflict: '这条错误已被处理或状态已变化，请按最新状态操作。',
  session_version_conflict: '人工处置会话已变化，请核对最新会话。',
  active_session_conflict: '请先完成当前人工处置会话，再处理其他错误。',
  operator_confirmation_required: '请重新核对现场，并勾选本次操作的确认项。',
  action_definition_changed: '设备动作定义已更新，请重新选择动作并检查参数。',
  occupancy_version_conflict: '逻辑占用已变化，请刷新后重新选择。',
  manual_actions_running: '本次人工处置仍有手动动作未结束，请等待动作结束，或停止动作并确认结果后继续。',
  manual_actions_unresolved: '本次人工处置仍有动作结果待核对，请完成现场核对后继续。',
  manual_action_not_finished: '该手动动作尚未结束，请等待动作结束后再核对结果。',
  manual_review_version_conflict: '动作结果已变化，请重新查看执行记录并核对现场。',
}

export function handlingErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '错误处置请求失败'
  return errors[message] || message
}

export interface ManualConfirmation {
  status: 'pending' | 'approved' | 'rejected' | 'timed_out' | 'canceled'
  deadline_at?: string
  actions: Array<'approve' | 'reject'>
}
export interface ExecutionLockSnapshot {
  workflow_task_uuid: string
  task_status: string
  active_device_tenancy_count: number
  locks: Array<{ uuid: string; lock_key: string; state: string; claim_uuid: string;
    fencing_token: number; can_release: boolean; release_block_reason?: string }>
}
