import type {
  StationCommandOptions,
  StationCommandReceipt,
  StationDecisionRequest,
  StationHandlingInventory,
  StationHandlingSnapshot,
  StationInventoryCorrectionRequest,
  StationManualActionOptions,
  StationManualActionRequest,
  StationManualDeviceAction,
  StationManualReviewContext,
  StationManualReviewRequest,
  StationOccupancyReleaseRequest,
  StationResourceOccupancy,
  StationResumeRequest,
  StationSessionCompleteRequest,
  StationSessionManualReviewRequest,
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

  /**
   * 读取一台设备在这次会话里可选的手动动作。
   *
   * 目录是按会话和设备读的，不是全局常量：动作定义可能随部署变化，
   * 所以界面不能缓存一份自己的设备-动作表。
   */
  listManualDeviceActions(
    sessionId: string,
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<readonly StationManualDeviceAction[]>
  /**
   * 手动执行一个设备动作。**不检查逻辑锁** —— 可能作用在别的任务正在使用的设备上。
   *
   * 返回的 commandUuid 要留下来跟「登记位置」关联，而不是丢掉。
   */
  executeManualAction(
    sessionId: string,
    request: StationManualActionRequest,
    options: StationManualActionOptions,
  ): Promise<StationCommandReceipt>
  /**
   * 请求停止一个手动动作。
   *
   * 停止只解除「动作未结束」；若动作结束时带了不确定原因，它仍然需要现场核对，
   * 界面不得把「已停止」说成「已解决」。
   */
  stopManualAction(
    commandUuid: string,
    reason: string,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /** 读取会话范围内的库存投影（可比物料与可比库位）。 */
  getHandlingInventory(sessionId: string, signal?: AbortSignal): Promise<StationHandlingInventory>
  /** 登记物料实际位置。同一批里同一物料只能出现一次。 */
  correctInventory(
    sessionId: string,
    request: StationInventoryCorrectionRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /**
   * 会话内确认一条已结束手动动作的现场核对结果。
   *
   * 核对只记录结论，不改执行结果、不清除不确定事实；在它成功之前，OS 会以
   * `manual_actions_unresolved` 拒绝完成会话。
   */
  reviewSessionManualAction(
    commandUuid: string,
    request: StationSessionManualReviewRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /**
   * 读取一条手动动作的事后核对上下文。
   *
   * 用于会话已经关闭（错误已消解、任务已终态）之后仍需核对的情况 ——
   * 这时没有活跃会话，只能靠 job 自己的核对版本。
   */
  getManualActionReview(jobUuid: string, signal?: AbortSignal): Promise<StationManualReviewContext>
  /** 保存事后核对记录。 */
  submitManualActionReview(
    jobUuid: string,
    request: StationManualReviewRequest,
    options: StationCommandOptions,
  ): Promise<StationCommandReceipt>
  /** 读取当前逻辑资源占用。 */
  listResourceOccupancies(signal?: AbortSignal): Promise<readonly StationResourceOccupancy[]>
  /** 释放选中的逻辑占用；整批原子，不做部分应用。 */
  releaseOccupancies(
    request: StationOccupancyReleaseRequest,
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
