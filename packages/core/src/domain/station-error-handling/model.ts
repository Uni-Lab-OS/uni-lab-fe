/**
 * 工站级节点错误处置的只读投影与命令契约。
 *
 * 语义要点（OS 是权威来源，前端不得推断或伪造）：
 * - 任一节点错误会把**整个工站**切到 PAUSED，不是只停一个 Task；
 * - 「处理完错误」不等于「恢复调度」，恢复是一次独立的、要绑快照确认的动作；
 * - 决定的对象是一条**错误事实**（decision_id），不是一个 Task；
 * - 提交返回 202 只代表 durable accepted，生效与否必须重新读取快照确认。
 */

export type StationMode = 'RUNNING' | 'PAUSED'

/** 错误事实与人工处置会话共用的阶段。 */
export type StationHandlingStage = 'DECISION_REQUIRED' | 'MANUAL_HANDLING' | 'APPLYING' | 'RESOLVED'

export type StationErrorStatus = 'open' | 'selected' | 'superseded'

export type StationDecisionAction = 'cancel_task' | 'retry_current_node' | 'enter_manual_handling'

/**
 * OS 对这条错误声明可用的处置选项。
 *
 * 选项文案属于 OS 契约（例如它把 `enter_manual_handling` 叫「进入手动处理」），
 * 前端不得自己另起一套名字，也不能凭 stage 猜哪些动作可用。
 */
export interface StationDecisionOption {
  readonly id: StationDecisionAction
  readonly label: string
}

export type StationCommandStatus = 'PENDING' | 'APPLIED' | 'FAILED'

/** 一条工站级节点错误事实。身份是 decisionId，不是 Task 或 Job。 */
export interface StationErrorFact {
  readonly kind: 'station_error_fact'
  readonly source: 'os'
  readonly decisionId: string
  readonly decisionVersion: number
  readonly stage: StationHandlingStage
  readonly status: StationErrorStatus
  /** OS 声明可用的处置选项；为空表示 OS 没有声明，前端不得自行补全。 */
  readonly options: readonly StationDecisionOption[]
  readonly sessionId: string | null
  readonly sourceTaskUuid: string
  readonly sourceJobUuid: string
  readonly message: string | null
  readonly sourceNodeId: string | null
  readonly errorPhase: string | null
  readonly openedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface StationHandlingSession {
  readonly kind: 'station_handling_session'
  readonly source: 'os'
  readonly sessionId: string
  readonly decisionId: string
  readonly stage: StationHandlingStage
  readonly version: number
  readonly summary: string
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 已受理但可能尚未生效的控制命令。needsApply 为真时界面必须提供「继续应用」，
 * 不能把 status=APPLIED 或 HTTP 202 直接当成已生效。
 */
export interface StationControlCommand {
  readonly commandUuid: string
  readonly operation: string
  readonly status: StationCommandStatus
  readonly needsApply: boolean
}

export interface StationHandlingSnapshot {
  readonly kind: 'station_handling_snapshot'
  readonly source: 'os'
  readonly stationId: string
  readonly mode: StationMode
  readonly stationVersion: number
  readonly errorEpoch: number
  readonly snapshotId: string
  readonly activeSessionId: string | null
  readonly activeSession: StationHandlingSession | null
  readonly errors: readonly StationErrorFact[]
  readonly controlCommands: readonly StationControlCommand[]
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 决定/恢复的受理回执。applicationError 与 dispatchError 单独返回：
 * 命令被受理不等于它已经生效。
 */
export interface StationCommandReceipt {
  readonly kind: 'station_command_receipt'
  readonly source: 'os'
  readonly commandUuid: string
  readonly operation: string
  readonly status: StationCommandStatus
  readonly snapshot: StationHandlingSnapshot | null
  readonly applicationError: string | null
  readonly dispatchError: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface StationDecisionRequest {
  readonly action: StationDecisionAction
  readonly expectedStationVersion: number
  readonly expectedDecisionVersion: number
  readonly observedErrorEpoch: number
  /** 取消/重试时是否顺带恢复工站调度；进入人工处置时必须为 false。 */
  readonly resumeRequested: boolean
  /** 操作员是否已人工确认现场可以恢复；resumeRequested 为真时必须为 true。 */
  readonly operatorConfirmed: boolean
  readonly confirmSnapshotId?: string
  readonly sessionId?: string
  readonly expectedSessionVersion?: number
  readonly reason?: string
}

export interface StationResumeRequest {
  readonly expectedStationVersion: number
  readonly observedErrorEpoch: number
  readonly operatorConfirmed: boolean
  readonly confirmSnapshotId: string
}

/**
 * 完成人工处置会话，把错误事实交回「等待处置决定」。
 *
 * 会话版本必须来自刚读到的快照：期间别人做了手动动作，这次完成就会被 OS 拒绝，
 * 而不是把别人的现场核对结果顶掉。
 */
export interface StationSessionCompleteRequest {
  readonly expectedStationVersion: number
  readonly expectedSessionVersion: number
  readonly summary?: string
}

/** 所有写操作都要求幂等键；同一意图重试必须复用同一个键。 */
export interface StationCommandOptions {
  readonly idempotencyKey: string
}
