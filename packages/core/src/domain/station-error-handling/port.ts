import type {
  StationCommandOptions,
  StationCommandReceipt,
  StationDecisionRequest,
  StationHandlingSnapshot,
  StationResumeRequest,
  StationSessionCompleteRequest,
} from './model'

/**
 * 工站级节点错误处置端口。
 *
 * 快照是唯一事实源：每次决定或恢复之后都必须重新读取它来确认生效，
 * 不允许前端根据回执或本地状态推断工站是否已恢复。
 */
export interface StationErrorHandlingPort {
  getSnapshot(signal?: AbortSignal): Promise<StationHandlingSnapshot>
  decide(
    decisionId: string,
    request: StationDecisionRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  resume(
    request: StationResumeRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /**
   * 继续应用一条已受理但未生效的控制命令。
   *
   * OS 的这个端点不要求幂等键（重复应用即同一次收敛），但画面上仍必须以
   * 重新读取的快照为准，不能拿回执当生效证明。
   */
  applyControlCommand(commandUuid: string): Promise<StationCommandReceipt>
  /**
   * 完成人工处置会话，把错误事实交回「等待处置决定」。
   *
   * 现场处理本身（设备动作、上下料登记、逻辑占用释放）仍由 OS 控制台承担；
   * 这里只结束会话，让节点重新可以被取消或重试。
   */
  completeSession(
    sessionId: string,
    request: StationSessionCompleteRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /**
   * 返回同一人工处置会话继续手动处理。
   *
   * 会话一旦建立就不会随「完成」消失：错误回到待决定后，再次进入手动处理
   * 必须走 return，而不是重新 enter（OS 会以 active_session_conflict 拒绝）。
   */
  returnSession(
    sessionId: string,
    request: StationSessionCompleteRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
}

export type StationHandlingErrorCode =
  | 'STATION_NOT_FOUND'
  | 'STATION_DECISION_NOT_FOUND'
  | 'STATION_SESSION_NOT_FOUND'
  | 'STATION_COMMAND_NOT_FOUND'
  | 'STATION_MANUAL_ACTION_NOT_FOUND'
  | 'STATION_OCCUPANCY_NOT_FOUND'
  | 'STATION_HANDLING_NOT_READY'
  | 'STATION_VERSION_CONFLICT'
  | 'DECISION_CONFLICT'
  | 'SESSION_VERSION_CONFLICT'
  | 'ACTIVE_SESSION_CONFLICT'
  | 'OPERATOR_CONFIRMATION_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MANUAL_ACTIONS_RUNNING'
  | 'MANUAL_ACTIONS_UNRESOLVED'
  | 'MANUAL_ACTION_NOT_FINISHED'
  | 'MANUAL_REVIEW_VERSION_CONFLICT'
  | 'OCCUPANCY_VERSION_CONFLICT'
  | 'ACTION_DEFINITION_CHANGED'
  | 'STATION_REQUEST_INVALID'
  | 'OS_REQUEST_REJECTED'
  | 'INVALID_STATION_RESPONSE'

export class StationHandlingError extends Error {
  constructor(
    readonly code: StationHandlingErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'StationHandlingError'
  }
}
