import {
  TransportError,
  type RequestTransport,
  type TransportRequest,
} from '../../transport/request'
import type {
  StationCommandOptions,
  StationCommandReceipt,
  StationCommandStatus,
  StationControlCommand,
  StationDecisionAction,
  StationDecisionOption,
  StationDecisionRequest,
  StationErrorFact,
  StationErrorStatus,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationHandlingStage,
  StationMode,
  StationResumeRequest,
  StationSessionCompleteRequest,
} from './model'
import {
  StationHandlingError,
  type StationErrorHandlingPort,
  type StationHandlingErrorCode,
} from './port'

export class StationErrorHandlingClient implements StationErrorHandlingPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly stationId: string,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async getSnapshot(signal?: AbortSignal): Promise<StationHandlingSnapshot> {
    const payload = await this.send({
      method: 'GET',
      url: `${this.stationRoot}/error-handling`,
      signal,
    })
    return decodeSnapshot(unwrapEnvelope(payload), 'snapshot')
  }

  async decide(
    decisionId: string,
    request: StationDecisionRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/errors/${encodeURIComponent(decisionId)}/decision`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: decisionBody(request),
    })
    return decodeReceipt(unwrapEnvelope(payload), `decision:${decisionId}`, 'decision receipt')
  }

  async resume(
    request: StationResumeRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/resume`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        observed_error_epoch: request.observedErrorEpoch,
        operator_confirmed: request.operatorConfirmed,
        confirm_snapshot_id: request.confirmSnapshotId,
      },
    })
    return decodeReceipt(unwrapEnvelope(payload), 'resume', 'resume receipt')
  }

  async applyControlCommand(commandUuid: string): Promise<StationCommandReceipt> {
    // OS 对 apply 端点不要求 Idempotency-Key（`error_handling_api.py` 的
    // `/control-commands/{uuid}/apply` 没有该参数），所以这里不伪造一个。
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/control-commands/${encodeURIComponent(commandUuid)}/apply`,
    })
    return decodeReceipt(unwrapEnvelope(payload), `apply:${commandUuid}`, 'apply receipt')
  }

  async completeSession(
    sessionId: string,
    request: StationSessionCompleteRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/sessions/${encodeURIComponent(sessionId)}/complete`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        expected_session_version: request.expectedSessionVersion,
        summary: request.summary ?? '',
      },
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `complete-session:${sessionId}`,
      'complete session receipt',
    )
  }

  async returnSession(
    sessionId: string,
    request: StationSessionCompleteRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/sessions/${encodeURIComponent(sessionId)}/return`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        expected_session_version: request.expectedSessionVersion,
      },
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `return-session:${sessionId}`,
      'return session receipt',
    )
  }

  private get stationRoot(): string {
    return `${this.apiPrefix}/stations/${encodeURIComponent(this.stationId)}`
  }

  private async send(request: TransportRequest): Promise<unknown> {
    try {
      const response = await this.transport.request<unknown>(request)
      return response.data
    } catch (error) {
      if (error instanceof TransportError) throw toStationHandlingError(error)
      throw error
    }
  }
}

/** OS 的 `{ code: 0, data: {...} }` 信封；解包失败时保留原始值交给解码器判定。 */
function unwrapEnvelope(value: unknown): unknown {
  const raw = asRecord(value) ?? {}
  return asRecord(raw.data) ?? raw
}

function decisionBody(request: StationDecisionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action: request.action,
    expected_station_version: request.expectedStationVersion,
    expected_decision_version: request.expectedDecisionVersion,
    observed_error_epoch: request.observedErrorEpoch,
    resume_requested: request.resumeRequested,
    operator_confirmed: request.operatorConfirmed,
  }
  // OS 的 DecisionRequest 是 extra="forbid"：可选字段必须整体省略，不能传 null。
  if (request.confirmSnapshotId !== undefined) {
    body.confirm_snapshot_id = request.confirmSnapshotId
  }
  if (request.sessionId !== undefined) body.session_id = request.sessionId
  if (request.expectedSessionVersion !== undefined) {
    body.expected_session_version = request.expectedSessionVersion
  }
  if (request.reason !== undefined) body.reason = request.reason
  return body
}

function decodeSnapshot(value: unknown, path: string): StationHandlingSnapshot {
  const raw = asRecord(value) ?? {}
  // error_epoch 和版本号一样参与乐观并发（要原样回传 observed_error_epoch），
  // 所以这四个字段缺失时宁可不给出快照，也不能给一个会误判的默认值。
  const stationId = requiredString(raw.station_id, `${path}.station_id`)
  const stationVersion = requiredNumber(raw.station_version, `${path}.station_version`)
  const snapshotId = requiredString(raw.snapshot_id, `${path}.snapshot_id`)
  const errorEpoch = requiredNumber(raw.error_epoch, `${path}.error_epoch`)
  const activeSessionId = optionalString(raw.active_session_id)
  return {
    kind: 'station_handling_snapshot',
    source: 'os',
    stationId,
    mode: decodeMode(raw.mode),
    stationVersion,
    errorEpoch,
    snapshotId,
    activeSessionId,
    activeSession: decodeSession(raw.active_session, activeSessionId),
    errors: itemsOf(raw.errors).map(decodeErrorFact),
    controlCommands: itemsOf(raw.control_commands).map(decodeControlCommand),
    raw,
  }
}

function decodeSession(
  value: unknown,
  fallbackSessionId: string | null,
): StationHandlingSession | null {
  const raw = asRecord(value)
  if (!raw) return null
  return {
    kind: 'station_handling_session',
    source: 'os',
    sessionId: optionalString(raw.session_id) ?? fallbackSessionId ?? '',
    decisionId: optionalString(raw.decision_id) ?? '',
    stage: decodeStage(raw.stage),
    version: optionalNumber(raw.version) ?? 0,
    summary: optionalString(raw.summary) ?? '',
    raw,
  }
}

function decodeErrorFact(value: unknown): StationErrorFact {
  const raw = asRecord(value) ?? {}
  const metaData = decodeMetaData(raw.meta_data)
  return {
    kind: 'station_error_fact',
    source: 'os',
    decisionId: optionalString(raw.decision_id) ?? '',
    decisionVersion: optionalNumber(raw.revision) ?? 0,
    stage: decodeStage(raw.stage),
    status: decodeErrorStatus(raw.status),
    options: decodeDecisionOptions(raw.options),
    sessionId: optionalString(raw.session_id),
    sourceTaskUuid: optionalString(raw.workflow_task_uuid) ?? '',
    sourceJobUuid: optionalString(raw.workflow_node_job_uuid) ?? '',
    message: optionalString(metaData?.message),
    sourceNodeId: optionalString(metaData?.source_node_id),
    errorPhase: optionalString(raw.error_phase),
    openedAt: optionalString(raw.opened_at),
    raw,
  }
}

const DECISION_ACTIONS: readonly StationDecisionAction[] = [
  'cancel_task',
  'retry_current_node',
  'enter_manual_handling',
]

/**
 * 只接受 OS 声明的三个动作，且必须有可用文案：
 * 未知动作不能渲染成按钮，否则点下去只会拿到 400。
 */
function decodeDecisionOptions(value: unknown): readonly StationDecisionOption[] {
  if (!Array.isArray(value)) return []
  const options: StationDecisionOption[] = []
  for (const item of value) {
    const raw = asRecord(item)
    const id = optionalString(raw?.id)
    if (!id || !DECISION_ACTIONS.includes(id as StationDecisionAction)) continue
    options.push({
      id: id as StationDecisionAction,
      label: optionalString(raw?.label) ?? id,
    })
  }
  return options
}

function decodeControlCommand(value: unknown): StationControlCommand {
  const raw = asRecord(value) ?? {}
  return {
    commandUuid: optionalString(raw.command_uuid) ?? '',
    operation: optionalString(raw.operation) ?? '',
    status: decodeCommandStatus(raw.status),
    needsApply: booleanValue(raw.needs_apply) ?? false,
  }
}

function decodeReceipt(
  value: unknown,
  fallbackOperation: string,
  path: string,
): StationCommandReceipt {
  const raw = asRecord(value) ?? {}
  const result = asRecord(raw.result)
  const station = asRecord(raw.station)
  return {
    kind: 'station_command_receipt',
    source: 'os',
    commandUuid: optionalString(raw.command_uuid) ?? '',
    // OS 回执不返回 operation，按 OS 的 operation 构造规则（decision:{id} / resume）补齐。
    operation: optionalString(raw.operation) ?? fallbackOperation,
    status: decodeCommandStatus(raw.status),
    // 回执缺 station 时不能凭空造快照，只能如实返回 null，由调用方重新读取。
    snapshot: station ? decodeSnapshot(station, `${path}.station`) : null,
    // 确定被拒绝的命令把原因写在 result.error 里，不能因此丢掉未生效的原因。
    applicationError:
      optionalString(raw.application_error) ?? optionalString(result?.error) ?? null,
    dispatchError: optionalString(raw.dispatch_error) ?? null,
    raw,
  }
}

function decodeMode(value: unknown): StationMode {
  return value === 'PAUSED' ? 'PAUSED' : 'RUNNING'
}

function decodeStage(value: unknown): StationHandlingStage {
  switch (value) {
    case 'MANUAL_HANDLING':
    case 'APPLYING':
    case 'RESOLVED':
    case 'DECISION_REQUIRED':
      return value
    default:
      return 'DECISION_REQUIRED'
  }
}

function decodeErrorStatus(value: unknown): StationErrorStatus {
  switch (value) {
    case 'selected':
    case 'superseded':
    case 'open':
      return value
    default:
      return 'open'
  }
}

/** 未知状态一律按未生效处理，不能让界面误以为命令已经生效。 */
function decodeCommandStatus(value: unknown): StationCommandStatus {
  switch (value) {
    case 'APPLIED':
    case 'FAILED':
    case 'PENDING':
      return value
    default:
      return 'PENDING'
  }
}

/**
 * `meta_data` 在线上已经是对象（OS 侧 json.loads 过）；这里仍兼容字符串形态，
 * 但解析失败只当作 null，不能让一条坏元数据毁掉整个快照。
 */
function decodeMetaData(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'string') return asRecord(value)
  try {
    return asRecord(JSON.parse(value) as unknown)
  } catch {
    return null
  }
}

const DETAIL_CODES: Readonly<Partial<Record<string, StationHandlingErrorCode>>> = {
  station_version_conflict: 'STATION_VERSION_CONFLICT',
  decision_conflict: 'DECISION_CONFLICT',
  session_version_conflict: 'SESSION_VERSION_CONFLICT',
  active_session_conflict: 'ACTIVE_SESSION_CONFLICT',
  operator_confirmation_required: 'OPERATOR_CONFIRMATION_REQUIRED',
  idempotency_conflict: 'IDEMPOTENCY_CONFLICT',
  manual_actions_running: 'MANUAL_ACTIONS_RUNNING',
  manual_actions_unresolved: 'MANUAL_ACTIONS_UNRESOLVED',
  manual_action_not_finished: 'MANUAL_ACTION_NOT_FINISHED',
  manual_review_version_conflict: 'MANUAL_REVIEW_VERSION_CONFLICT',
  occupancy_version_conflict: 'OCCUPANCY_VERSION_CONFLICT',
  action_definition_changed: 'ACTION_DEFINITION_CHANGED',
}

/**
 * OS 的 404 用同一个状态码表达「工站不存在」和「某条具体事实不存在」。
 * 只有 detail 能区分；否则用户会把「这条错误已被处理」误读成「工站部署错了」。
 */
const NOT_FOUND_CODES: Readonly<Partial<Record<string, StationHandlingErrorCode>>> = {
  工站不存在: 'STATION_NOT_FOUND',
  错误决定不存在: 'STATION_DECISION_NOT_FOUND',
  处置会话不存在: 'STATION_SESSION_NOT_FOUND',
  手动执行命令不存在: 'STATION_MANUAL_ACTION_NOT_FOUND',
  手动动作不存在: 'STATION_MANUAL_ACTION_NOT_FOUND',
  本工站的手动动作不存在: 'STATION_MANUAL_ACTION_NOT_FOUND',
  控制命令不存在: 'STATION_COMMAND_NOT_FOUND',
  资源占用不存在: 'STATION_OCCUPANCY_NOT_FOUND',
}

const ERROR_MESSAGES: Readonly<Record<StationHandlingErrorCode, string>> = {
  STATION_NOT_FOUND: '未找到该工站，请确认部署的工站配置后重试。',
  STATION_DECISION_NOT_FOUND:
    '这条错误决定已经不存在（可能已被处理或任务已结束），请重新读取工站状态。',
  STATION_SESSION_NOT_FOUND: '这个人工处置会话已经不存在或已结束，请重新读取工站状态。',
  STATION_COMMAND_NOT_FOUND: '这条已受理的命令已经不存在，请重新读取工站状态。',
  STATION_MANUAL_ACTION_NOT_FOUND: '这条人工动作记录已经不存在，请重新读取工站状态。',
  STATION_OCCUPANCY_NOT_FOUND: '选中的逻辑占用已经不存在，请重新读取占用列表后再操作。',
  STATION_HANDLING_NOT_READY: '工站错误处置服务尚未就绪，请稍后重试。',
  STATION_VERSION_CONFLICT: '工站状态已变化，请核对刷新后的错误与现场状态后重新选择。',
  DECISION_CONFLICT: '该错误已被处理或状态已变化，请刷新后重新选择处理方式。',
  SESSION_VERSION_CONFLICT: '人工处置会话已更新，请刷新后基于最新会话重新操作。',
  ACTIVE_SESSION_CONFLICT: '该工站已有进行中的人工处置会话，请先结束现有会话再继续。',
  OPERATOR_CONFIRMATION_REQUIRED: '恢复调度需要操作员明确确认现场状态，请确认后重试。',
  IDEMPOTENCY_CONFLICT: '该幂等键已被不同的操作内容使用，请更换幂等键后重新提交。',
  MANUAL_ACTIONS_RUNNING:
    '这个工站还有人工触发的设备动作没有结束，请先等待或停止这些动作，再处理这条错误。',
  MANUAL_ACTIONS_UNRESOLVED:
    '人工触发的设备动作已经结束，但还没有完成现场核对；请先核对执行结果，再继续处置。',
  MANUAL_ACTION_NOT_FINISHED: '这条人工动作还没有结束，不能现在核对结果，请等待它进入终态。',
  MANUAL_REVIEW_VERSION_CONFLICT: '核对记录已被更新，请重新读取后再提交核对结果。',
  OCCUPANCY_VERSION_CONFLICT: '逻辑占用在提交前发生了变化，请重新读取占用列表后再选择释放。',
  ACTION_DEFINITION_CHANGED: '设备动作定义已经变化，请重新读取设备动作目录后再提交。',
  STATION_REQUEST_INVALID:
    '工站拒绝了这次请求的字段（常见原因是缺少幂等键或携带了未知字段），请刷新后重试。',
  OS_REQUEST_REJECTED: '工站拒绝了本次请求，请核对当前错误与现场状态后重试。',
  INVALID_STATION_RESPONSE: '工站返回的错误处置数据不完整，无法安全继续操作，请刷新后重试。',
}

function toStationHandlingError(error: TransportError): StationHandlingError {
  const detail = detailOf(error.cause) ?? ''
  const mapped = DETAIL_CODES[detail] ?? NOT_FOUND_CODES[detail]
  if (mapped) return new StationHandlingError(mapped, ERROR_MESSAGES[mapped], error.status)
  // OS 已经给出可执行的中文说明时原样透出；英文稳定码只用于选文案，不能丢给用户。
  const prose = /[\u4e00-\u9fa5]/.test(detail) ? detail : ''
  const code = statusCode(error.status)
  return new StationHandlingError(code, prose || ERROR_MESSAGES[code], error.status)
}

/**
 * 适配器的 `responseMessage()` 只认 `message` / `error.message`，而 OS 的
 * HTTPException 返回的是 `{"detail": "..."}`，所以文案只能从 `cause`（响应体）里取。
 */
function detailOf(cause: unknown): string | undefined {
  return optionalString(asRecord(cause)?.detail) ?? undefined
}

function statusCode(status: number | undefined): StationHandlingErrorCode {
  if (status === 503) return 'STATION_HANDLING_NOT_READY'
  if (status === 404) return 'STATION_NOT_FOUND'
  if (status === 422) return 'STATION_REQUEST_INVALID'
  return 'OS_REQUEST_REJECTED'
}

function invalid(path: string): StationHandlingError {
  return new StationHandlingError(
    'INVALID_STATION_RESPONSE',
    `工站返回的错误处置数据缺少必需字段 ${path}，无法安全继续操作，请刷新后重试。`,
  )
}

function requiredString(value: unknown, path: string): string {
  const text = optionalString(value)
  if (text === null) throw invalid(path)
  return text
}

function requiredNumber(value: unknown, path: string): number {
  const count = optionalNumber(value)
  if (count === null) throw invalid(path)
  return count
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function itemsOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}
