/**
 * OS 工站错误处置（/api/v1/stations/{station}/...）。节点执行出错后，工站暂停新派发，
 * 等待操作员对每条错误做决定：取消当前任务、重试当前节点（界面称“重新执行该动作”）或进入手动处理。
 * 所有写操作带幂等键；HTTP 受理不等于已应用，状态以重新读取的工站快照为准。
 */
export type StationErrorAction = 'cancel_task' | 'retry_current_node' | 'enter_manual_handling'
export type StationHandlingStage = 'DECISION_REQUIRED' | 'MANUAL_HANDLING' | 'APPLYING' | 'RESOLVED'

export interface StationErrorOption {
  readonly id: string
  readonly label: string
}

export interface StationError {
  readonly decisionId: string
  readonly decisionVersion: number
  readonly sourceTaskUuid: string
  readonly sourceJobUuid: string
  readonly sourceNodeId: string | null
  readonly stage: StationHandlingStage
  readonly status: string
  readonly message: string
  readonly options: readonly StationErrorOption[]
  readonly sessionId: string | null
  readonly openedAt: string | null
}

export interface StationHandlingSession {
  readonly sessionId: string
  readonly decisionId: string
  readonly stage: StationHandlingStage
  readonly version: number
  readonly summary: string
}

export interface StationControlCommand {
  readonly commandUuid: string
  readonly status: 'PENDING' | 'APPLIED' | 'FAILED' | string
  readonly operation: string
  readonly needsApply: boolean
}

export interface StationManualAction {
  readonly jobUuid: string
  readonly status: string
  readonly sessionId: string | null
  readonly actionName: string
  readonly deviceId: string
  readonly uncertaintyReason: string | null
  readonly resultReviewed: boolean
  /** 执行命令号（edge_command_uuid），核对结果时用。 */
  readonly commandId: string | null
  /** OS 核对证据版本；核对提交须带上，防止基于旧证据确认。 */
  readonly reviewVersion: string | null
  readonly errorMessage: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
}

/** 人工处置会话中某设备可下发的动作（OS 动作目录，含当前内容版本）。 */
export interface StationDeviceAction {
  readonly actionId: string
  readonly name: string
  readonly displayName: string
  readonly actionVersion: string
  readonly parameterSchema: Readonly<Record<string, unknown>>
  readonly defaults: Readonly<Record<string, unknown>>
}

export interface StationHandlingSnapshot {
  readonly kind: 'station_handling_snapshot'
  readonly source: 'os'
  readonly stationId: string
  readonly mode: 'RUNNING' | 'PAUSED' | string
  readonly stationVersion: number
  readonly errorEpoch: number
  readonly snapshotId: string
  readonly activeSession: StationHandlingSession | null
  readonly errors: readonly StationError[]
  readonly manualActions: readonly StationManualAction[]
  readonly controlCommands: readonly StationControlCommand[]
  readonly raw: Readonly<Record<string, unknown>>
}

/** 一次写操作意图；结果不明确时必须用同一幂等键重发，不能生成第二条操作。 */
export interface StationHandlingIntent {
  readonly path: string
  readonly body: Readonly<Record<string, unknown>>
  readonly idempotencyKey: string
  readonly label: string
}

/** 逻辑资源占用（/resource-dispositions）：执行锁或设备托管，释放前须现场核对。 */
export interface StationOccupancy {
  readonly uuid: string
  readonly lockKey: string
  readonly state: string
  readonly occupancyKind: string
  /** device / material / material_site / resource */
  readonly scope: string
  readonly version: string
  readonly taskUuid: string | null
  readonly materialUuid: string | null
  readonly deviceId: string | null
}
