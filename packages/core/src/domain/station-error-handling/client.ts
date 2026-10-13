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
  StationHandlingInventory,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationHandlingStage,
  StationInventoryCorrectionRequest,
  StationInventoryInstance,
  StationInventorySite,
  StationManualActionJob,
  StationManualActionOptions,
  StationManualActionRequest,
  StationManualDeviceAction,
  StationManualReviewAudit,
  StationManualReviewContext,
  StationManualReviewRequest,
  StationMode,
  StationOccupancyReleaseRequest,
  StationResourceOccupancy,
  StationResumeRequest,
  StationSessionCompleteRequest,
  StationSessionManualReviewRequest,
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

  async listManualDeviceActions(
    sessionId: string,
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<readonly StationManualDeviceAction[]> {
    const payload = await this.send({
      method: 'GET',
      url: `${this.sessionRoot(sessionId)}/devices/${encodeURIComponent(deviceId)}/actions`,
      signal,
    })
    return unwrapItems(payload).map(decodeManualDeviceAction)
  }

  async executeManualAction(
    sessionId: string,
    request: StationManualActionRequest,
    options: StationManualActionOptions,
  ): Promise<StationCommandReceipt> {
    // OS 的 ManualActionRequest 继承 SessionVersion，且 extra="forbid"：body 恰好
    // 只有这 6 个键。options.reason 不在其中（多传会被 422 拒绝），所以不下发。
    const payload = await this.send({
      method: 'POST',
      url: `${this.sessionRoot(sessionId)}/manual-actions`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        expected_session_version: request.expectedSessionVersion,
        device_id: request.deviceId,
        action_id: request.actionId,
        action_version: request.actionVersion,
        parameters: request.parameters,
      },
    })
    return decodeReceipt(unwrapEnvelope(payload), `manual:${sessionId}`, 'manual action receipt')
  }

  async stopManualAction(
    commandUuid: string,
    reason: string,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    // OS 的 StopRequest 是 extra="forbid" 的裸 BaseModel：body 只有 reason，
    // 不能携带任何版本字段（带了会被 422 拒绝）。
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/manual-actions/${encodeURIComponent(commandUuid)}/stop`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: { reason },
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `stop:${commandUuid}`,
      'stop manual action receipt',
    )
  }

  async getHandlingInventory(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<StationHandlingInventory> {
    const payload = await this.send({
      method: 'GET',
      url: `${this.sessionRoot(sessionId)}/inventory`,
      signal,
    })
    return decodeInventory(unwrapEnvelope(payload))
  }

  async correctInventory(
    sessionId: string,
    request: StationInventoryCorrectionRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const body: Record<string, unknown> = {
      expected_station_version: request.expectedStationVersion,
      expected_session_version: request.expectedSessionVersion,
      changes: request.changes.map(inventoryChangeBody),
      expected_inventory_versions: request.expectedInventoryVersions,
      reason: request.reason,
    }
    // OS 侧该字段默认 None；省略表示「不关联」，不能补一个 null 表达同一件事。
    if (request.relatedManualCommandId !== undefined) {
      body.related_manual_command_id = request.relatedManualCommandId
    }
    const payload = await this.send({
      method: 'POST',
      url: `${this.sessionRoot(sessionId)}/inventory-corrections`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body,
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `inventory:${sessionId}`,
      'inventory correction receipt',
    )
  }

  async reviewSessionManualAction(
    commandUuid: string,
    request: StationSessionManualReviewRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    // OS 的 ManualReviewRequest 继承 SessionVersion，且 extra="forbid"：body 恰好
    // 只有这 6 个键。核对只写现场检查结论，不下发任何动作或结果字段。
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/manual-actions/${encodeURIComponent(commandUuid)}/review`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        expected_session_version: request.expectedSessionVersion,
        session_id: request.sessionId,
        expected_review_version: request.expectedReviewVersion,
        reason: request.reason,
        operator_confirmed: request.operatorConfirmed,
      },
    })
    return decodeReceipt(unwrapEnvelope(payload), `review:${commandUuid}`, 'manual review receipt')
  }

  async getManualActionReview(
    jobUuid: string,
    signal?: AbortSignal,
  ): Promise<StationManualReviewContext> {
    // 该端点挂在工站根下（不是 sessions 下）：会话可能已经关闭，只能靠 job 自己的核对版本。
    const payload = await this.send({
      method: 'GET',
      url: `${this.stationRoot}/manual-action-jobs/${encodeURIComponent(jobUuid)}/review`,
      signal,
    })
    return decodeManualReviewContext(unwrapEnvelope(payload))
  }

  async submitManualActionReview(
    jobUuid: string,
    request: StationManualReviewRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    // OS 的 HistoricalManualReviewRequest 是 extra="forbid" 的裸 BaseModel：body 恰好
    // 只有这 3 个键。这里**不能**带会话/工站版本字段 —— 会话可能已经关闭，带了会被 422 拒绝。
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/manual-action-jobs/${encodeURIComponent(jobUuid)}/review`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_review_version: request.expectedReviewVersion,
        reason: request.reason,
        operator_confirmed: request.operatorConfirmed,
      },
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `review-job:${jobUuid}`,
      'manual job review receipt',
    )
  }

  async listResourceOccupancies(
    signal?: AbortSignal,
  ): Promise<readonly StationResourceOccupancy[]> {
    // 注意：该端点挂在工站根下，**不在** sessions 下。
    const payload = await this.send({
      method: 'GET',
      url: `${this.stationRoot}/resource-dispositions`,
      signal,
    })
    return unwrapItems(payload).map(decodeResourceOccupancy)
  }

  async releaseOccupancies(
    request: StationOccupancyReleaseRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt> {
    const payload = await this.send({
      method: 'POST',
      url: `${this.stationRoot}/resource-dispositions`,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      body: {
        expected_station_version: request.expectedStationVersion,
        expected_session_version: request.expectedSessionVersion,
        decision_id: request.decisionId,
        session_id: request.sessionId,
        occupancy_ids: request.occupancyIds,
        expected_versions: request.expectedVersions,
        operation: 'release',
        reason: request.reason,
      },
    })
    return decodeReceipt(
      unwrapEnvelope(payload),
      `resource:${request.decisionId}`,
      'occupancy release receipt',
    )
  }

  private sessionRoot(sessionId: string): string {
    return `${this.stationRoot}/sessions/${encodeURIComponent(sessionId)}`
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

/**
 * 数组型 data 的拆包。
 *
 * `unwrapEnvelope` 只认对象 data（`asRecord` 排除数组），列表端点必须走这里：
 * 既要拆 `{ code: 0, data: [...] }`，也要兼容直接返回数组的形态。
 */
function unwrapItems(value: unknown): readonly unknown[] {
  const raw = asRecord(value)
  if (raw && Array.isArray(raw.data)) return raw.data
  return itemsOf(value)
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

/**
 * 单个库存更正项。OS 的 `InventoryChange` 用空值表达「移出当前库位」/「不指定库位」，
 * 所以 null 要如实下发，不能悄悄替换成空串。
 */
function inventoryChangeBody(change: {
  readonly materialUuid: string
  readonly parentUuid: string | null
  readonly siteUuid: string | null
}): Record<string, unknown> {
  return {
    material_uuid: change.materialUuid,
    parent_uuid: change.parentUuid,
    site_uuid: change.siteUuid,
  }
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
    // 手动动作未完成/未核对会阻塞恢复，必须与错误事实一起进入快照。
    manualActions: itemsOf(raw.manual_actions).map(decodeManualActionJob),
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

/**
 * 一条手动动作投影。
 *
 * `deviceId` / `actionName` 在线上没有稳定顶层字段：优先读顶层，缺失时回落到
 * `control_data.dispatch_payload`，两者都没有就如实保留 null（界面不得自己编一个）。
 */
function decodeManualActionJob(value: unknown): StationManualActionJob {
  const raw = asRecord(value) ?? {}
  const metaData = decodeMetaData(raw.meta_data)
  const dispatchPayload = asRecord(asRecord(raw.control_data)?.dispatch_payload)
  return {
    kind: 'station_manual_action_job',
    source: 'os',
    jobUuid: optionalString(raw.uuid) ?? '',
    sessionId: optionalString(metaData?.session_id),
    status: optionalString(raw.status) ?? '',
    deviceId: optionalString(raw.device_id) ?? optionalString(dispatchPayload?.device_id),
    actionName: optionalString(raw.action_name) ?? optionalString(dispatchPayload?.action),
    edgeCommandUuid: optionalString(raw.edge_command_uuid),
    uncertaintyReason: optionalString(raw.uncertainty_reason),
    // 未知核对状态一律按「未核对」处理：宁可要求再核对一次，也不能谎报已核对。
    resultReviewed: booleanValue(raw.result_reviewed) ?? false,
    reviewVersion: optionalString(raw.review_version),
    startedAt: optionalString(raw.started_at),
    finishedAt: optionalString(raw.finished_at),
    raw,
  }
}

/**
 * 事后核对上下文。
 *
 * `job` 与快照里的 `manual_actions` 是同一份投影（OS 两侧都走 `WorkflowStore._job_row`
 * 加 `manual_review_projection`），所以直接复用 `decodeManualActionJob`，不另写一套解码。
 *
 * `reviewVersion` 是乐观并发凭据，提交时要原样回传：缺失时宁可拒绝解码，也不能给一个
 * 空串版本 —— 那只会被 OS 当成版本不符拒掉，把「数据不完整」说成「别人先核对过了」。
 */
function decodeManualReviewContext(value: unknown): StationManualReviewContext {
  const raw = asRecord(value) ?? {}
  return {
    kind: 'station_manual_review_context',
    source: 'os',
    stationId: requiredString(raw.station_id, 'manual_review.station_id'),
    // 会话可能已经关闭，这里如实保留 null，界面上「没有活跃会话」与「会话已结束」不同。
    sessionId: optionalString(raw.session_id),
    sessionStage:
      raw.session_stage === null || raw.session_stage === undefined
        ? null
        : decodeStage(raw.session_stage),
    job: decodeManualActionJob(raw.job),
    reviewVersion: requiredString(raw.review_version, 'manual_review.review_version'),
    // 未知核对状态一律按「未核对」处理，不能谎报已核对。
    resultReviewed: booleanValue(raw.result_reviewed) ?? false,
    audit: decodeManualReviewAudit(raw.manual_review),
    raw,
  }
}

/** 一条审计记录；`manual_review` 为 null 表示这条动作还没有核对过。 */
function decodeManualReviewAudit(value: unknown): StationManualReviewAudit | null {
  const raw = asRecord(value)
  if (!raw) return null
  return {
    reviewVersion: optionalString(raw.review_version) ?? '',
    operatorId: optionalString(raw.operator_id) ?? '',
    reviewedAt: optionalString(raw.reviewed_at) ?? '',
    reason: optionalString(raw.reason) ?? '',
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

function decodeManualDeviceAction(value: unknown): StationManualDeviceAction {
  const raw = asRecord(value) ?? {}
  const name = optionalString(raw.name) ?? ''
  return {
    kind: 'station_manual_device_action',
    source: 'os',
    actionId: optionalString(raw.action_id) ?? '',
    // 动作定义版本必须原样回传；缺失是空串不是 0，执行时 OS 会以
    // action_definition_changed 拒绝，而不是误执行一个已经变了的动作。
    actionVersion: optionalString(raw.action_version) ?? '',
    name,
    // OS 自己在 display_name 缺失时回落到 name，这里照抄同一规则，不另造文案。
    displayName: optionalString(raw.display_name) ?? name,
    parameterSchema: asRecord(raw.parameter_schema) ?? {},
    defaults: asRecord(raw.defaults) ?? {},
    raw,
  }
}

function decodeInventory(value: unknown): StationHandlingInventory {
  const raw = asRecord(value) ?? {}
  return {
    kind: 'station_handling_inventory',
    source: 'os',
    instances: itemsOf(raw.instances).map(decodeInventoryInstance),
    sites: itemsOf(raw.sites).map(decodeInventorySite),
    raw,
  }
}

function decodeInventoryInstance(value: unknown): StationInventoryInstance {
  const raw = asRecord(value) ?? {}
  return {
    edgeUuid: optionalString(raw.edge_uuid) ?? '',
    name: optionalString(raw.name) ?? '',
    parentUuid: optionalString(raw.parent_uuid) ?? '',
    version: optionalNumber(raw.version) ?? optionalString(raw.version) ?? '',
  }
}

function decodeInventorySite(value: unknown): StationInventorySite {
  const raw = asRecord(value) ?? {}
  return {
    // 线上库位标识叫 uuid，投影里叫 siteUuid：改名只发生在这里。
    siteUuid: optionalString(raw.uuid) ?? '',
    materialUuid: optionalString(raw.material_uuid) ?? '',
    name: optionalString(raw.name) ?? '',
    occupiedMaterialUuid: optionalString(raw.occupied_material_uuid),
    updateTime: optionalString(raw.update_time) ?? '',
  }
}

function decodeResourceOccupancy(value: unknown): StationResourceOccupancy {
  const raw = asRecord(value) ?? {}
  return {
    kind: 'station_resource_occupancy',
    source: 'os',
    occupancyUuid: optionalString(raw.uuid) ?? '',
    lockKey: optionalString(raw.lock_key) ?? '',
    state: optionalString(raw.state) ?? '',
    occupancyKind: optionalString(raw.occupancy_kind) ?? '',
    // 释放时必须原样回传；缺失是空串，宁可让 OS 拒绝也不能猜一个版本。
    version: optionalString(raw.version) ?? '',
    // 两种占用来源的字段名不同（工作流锁 / 设备租借），两个都要认。
    taskUuid: optionalString(raw.workflow_task_uuid) ?? optionalString(raw.task_uuid),
    jobUuid: optionalString(raw.workflow_node_job_uuid),
    materialUuid: optionalString(raw.material_uuid),
    deviceId: optionalString(raw.device_id),
    raw,
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
  // OS 在 `error_control.begin_execution` 里用这个码表示「命令与作业的执行身份不一致」，
  // 是派发凭据不匹配，不是用户能自己修好的字段问题。port.ts 的联合类型里没有更贴切的
  // 码，也不宜为此新增一个码，所以统一落到 OS_REQUEST_REJECTED（界面据此提示重新读取
  // 工站状态后再试），并保持 detail 不暴露给用户。
  execution_identity_conflict: 'OS_REQUEST_REJECTED',
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
  // error_control._review_manual 里另一条手动动作缺失文案；不补会被 404 兜底
  // 误读成「工站不存在」。
  当前会话的手动动作不存在: 'STATION_MANUAL_ACTION_NOT_FOUND',
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
