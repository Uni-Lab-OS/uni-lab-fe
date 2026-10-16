import type {
  StationControlCommand,
  StationError,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationManualAction,
} from './model'

export function decodeStationSnapshot(value: unknown): StationHandlingSnapshot {
  const raw = record(value, 'station snapshot')
  const session = raw.active_session ? record(raw.active_session, 'active_session') : null
  return {
    kind: 'station_handling_snapshot',
    source: 'os',
    stationId: text(raw.station_id, 'station_id'),
    mode: text(raw.mode, 'mode'),
    stationVersion: integer(raw.station_version, 'station_version'),
    errorEpoch: integer(raw.error_epoch, 'error_epoch'),
    snapshotId: text(raw.snapshot_id, 'snapshot_id'),
    activeSession: session ? decodeSession(session) : null,
    errors: list(raw.errors).map((item) => decodeError(record(item, 'error'))),
    manualActions: list(raw.manual_actions).map((item) => decodeManualAction(record(item, 'manual_action'))),
    controlCommands: list(raw.control_commands).map((item) => decodeCommand(record(item, 'control_command'))),
    raw,
  }
}

function decodeError(raw: Record<string, unknown>): StationError {
  const meta = (raw.meta_data && typeof raw.meta_data === 'object' ? raw.meta_data : {}) as Record<string, unknown>
  return {
    decisionId: text(raw.decision_id ?? raw.uuid, 'decision_id'),
    decisionVersion: integer(raw.decision_version ?? raw.revision, 'decision_version'),
    sourceTaskUuid: text(raw.source_task_uuid ?? raw.workflow_task_uuid, 'source_task_uuid'),
    sourceJobUuid: text(raw.source_job_uuid ?? raw.workflow_node_job_uuid, 'source_job_uuid'),
    sourceNodeId: typeof meta.source_node_id === 'string' ? meta.source_node_id : null,
    stage: text(raw.stage, 'stage') as StationError['stage'],
    status: typeof raw.status === 'string' ? raw.status : '',
    message: readableMessage(meta.message),
    options: list(raw.options).map((item) => {
      const option = record(item, 'option')
      return { id: text(option.id, 'option.id'), label: typeof option.label === 'string' ? option.label : String(option.id) }
    }),
    sessionId: typeof raw.session_id === 'string' ? raw.session_id : null,
    openedAt: typeof raw.opened_at === 'string' ? raw.opened_at : null,
  }
}

function decodeSession(raw: Record<string, unknown>): StationHandlingSession {
  return {
    sessionId: text(raw.session_id, 'session_id'),
    decisionId: text(raw.decision_id, 'session.decision_id'),
    stage: text(raw.stage, 'session.stage') as StationHandlingSession['stage'],
    version: integer(raw.version, 'session.version'),
    summary: typeof raw.summary === 'string' ? raw.summary : '',
  }
}

function decodeCommand(raw: Record<string, unknown>): StationControlCommand {
  return {
    commandUuid: text(raw.command_uuid, 'command_uuid'),
    status: typeof raw.status === 'string' ? raw.status : '',
    operation: typeof raw.operation === 'string' ? raw.operation : '',
    needsApply: raw.needs_apply === true,
  }
}

function decodeManualAction(raw: Record<string, unknown>): StationManualAction {
  const meta = (raw.meta_data && typeof raw.meta_data === 'object' ? raw.meta_data : {}) as Record<string, unknown>
  const control = (raw.control_data && typeof raw.control_data === 'object' ? raw.control_data : {}) as Record<string, unknown>
  const payload = (control.dispatch_payload && typeof control.dispatch_payload === 'object' ? control.dispatch_payload : {}) as Record<string, unknown>
  return {
    jobUuid: text(raw.uuid, 'manual_action.uuid'),
    status: typeof raw.status === 'string' ? raw.status : '',
    sessionId: typeof meta.session_id === 'string' ? meta.session_id : null,
    actionName: String(raw.action_name ?? payload.action ?? ''),
    deviceId: String(raw.device_id ?? payload.device_id ?? ''),
    uncertaintyReason: typeof raw.uncertainty_reason === 'string' && raw.uncertainty_reason ? raw.uncertainty_reason : null,
    resultReviewed: raw.result_reviewed === true,
  }
}

/** OS 把设备错误列表序列化成 Python repr 字符串；尽量提取其中的 message 便于阅读，原文保留在 raw。 */
function readableMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = value.match(/'message':\s*"((?:[^"\\]|\\.)*)"|'message':\s*'((?:[^'\\]|\\.)*)'/)
  return match ? (match[1] ?? match[2] ?? value) : value
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`工站处置数据 ${field} 格式无效`)
  return value as Record<string, unknown>
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`工站处置数据缺少 ${field}`)
  return value
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`工站处置数据 ${field} 不是整数`)
  return value
}
