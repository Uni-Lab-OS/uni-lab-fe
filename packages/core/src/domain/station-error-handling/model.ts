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

/**
 * 人工处置会话里执行过的设备动作（OS `manual_actions` 的投影）。
 *
 * `uncertaintyReason` 非空表示动作已结束但结果不确定：在完成现场核对之前，
 * OS 会以 `manual_actions_unresolved` 拒绝完成会话，所以界面必须把它如实显示成
 * 「待核对」，不能折叠成失败或成功。
 */
export interface StationManualActionJob {
  readonly kind: 'station_manual_action_job'
  readonly source: 'os'
  readonly jobUuid: string
  readonly sessionId: string | null
  readonly status: string
  readonly deviceId: string | null
  readonly actionName: string | null
  readonly edgeCommandUuid: string | null
  readonly uncertaintyReason: string | null
  readonly resultReviewed: boolean
  readonly reviewVersion: string | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
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
  readonly manualActions: readonly StationManualActionJob[]
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

/**
 * 一台设备在当前会话里可选的手动动作。
 *
 * `actionVersion` 是动作定义的版本：执行时必须原样回传，动作定义在读取之后被改过时
 * OS 会以 `action_definition_changed` 拒绝，而不是照旧执行一个已经变了的动作。
 */
export interface StationManualDeviceAction {
  readonly kind: 'station_manual_device_action'
  readonly source: 'os'
  readonly actionId: string
  readonly actionVersion: string
  readonly name: string
  readonly displayName: string
  readonly parameterSchema: Readonly<Record<string, unknown>>
  readonly defaults: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

export interface StationManualActionRequest {
  readonly deviceId: string
  readonly actionId: string
  readonly actionVersion: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly expectedStationVersion: number
  readonly expectedSessionVersion: number
}

/**
 * 手动执行设备动作。
 *
 * 手动动作**不检查逻辑锁**：它可能作用在别的任务正在使用的设备上。所以这不是
 * 「安全的默认行为」，界面必须在跨任务设备上把这个后果显式说出来。
 */
/**
 * 手动执行设备动作的选项。
 *
 * **没有 reason**：OS 的 `ManualActionRequest` 是 `extra="forbid"` 且不声明 reason 字段，
 * 多传会被 422 拒掉。动作的意图写在动作参数里，不另开一个说明字段。
 */
export type StationManualActionOptions = StationCommandOptions

export interface StationInventoryInstance {
  readonly edgeUuid: string
  readonly name: string
  /** 当前所在容器；空串表示不在任何库位（与线协议一致，不是 null）。 */
  readonly parentUuid: string
  readonly version: number | string
}

export interface StationInventorySite {
  readonly siteUuid: string
  readonly materialUuid: string
  readonly name: string
  readonly occupiedMaterialUuid: string | null
  readonly updateTime: string
}

/** 上下料登记用的库存投影：可选物料与可选库位，都是 OS 的当前状态。 */
export interface StationHandlingInventory {
  readonly kind: 'station_handling_inventory'
  readonly source: 'os'
  readonly instances: readonly StationInventoryInstance[]
  readonly sites: readonly StationInventorySite[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface StationInventoryChange {
  readonly materialUuid: string
  /**
   * 目标设备或容器。**空串**表示移出当前库位。
   *
   * 不是 null：OS 的 `InventoryChange.parent_uuid` 是 `str = ""`（不是 Optional），
   * 下发 null 会被 pydantic 以 422 拒掉。语义上空值就是「移出 / 不指定」。
   */
  readonly parentUuid: string
  readonly siteUuid: string
}

/**
 * 登记物料实际位置。
 *
 * 同一批里同一物料只能出现一次；`expectedInventoryVersions` 要同时覆盖被移动的物料
 * 和它的目标库位，任一项版本不符 OS 会整批拒绝（不做部分应用）。
 */
export interface StationInventoryCorrectionRequest {
  readonly changes: readonly StationInventoryChange[]
  readonly expectedInventoryVersions: Readonly<Record<string, string | number>>
  readonly reason: string
  /**
   * 关联到刚执行的那条手动动作。OS 预留了这个字段，界面据此把「执行动作」和
   * 「登记位置」两条底层记录串成同一次处理。
   */
  readonly relatedManualCommandId?: string
  readonly expectedStationVersion: number
  readonly expectedSessionVersion: number
}

export interface StationResourceOccupancy {
  readonly kind: 'station_resource_occupancy'
  readonly source: 'os'
  readonly occupancyUuid: string
  readonly lockKey: string
  readonly state: string
  readonly occupancyKind: string
  /** 释放时必须原样回传；版本不符 OS 会整批拒绝。 */
  readonly version: string
  readonly taskUuid: string | null
  readonly jobUuid: string | null
  readonly materialUuid: string | null
  readonly deviceId: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 释放选中的逻辑占用。
 *
 * OS 的释放是**整批原子**的：任一项不存在、版本不符或重复，整批拒绝。所以界面
 * 一条结果就够，不需要逐项结果；但反过来也不能把「一批」拆成多次提交来绕开校验。
 */
export interface StationOccupancyReleaseRequest {
  readonly decisionId: string
  readonly sessionId: string
  readonly occupancyIds: readonly string[]
  readonly expectedVersions: Readonly<Record<string, string>>
  readonly reason: string
  readonly expectedStationVersion: number
  readonly expectedSessionVersion: number
}

/**
 * 一条手动动作的现场核对记录（审计）。
 *
 * 核对**只记录现场检查结论**，不改变动作的实际执行结果，也不清除不确定事实 ——
 * 界面把它说成「已解决」就是撒谎。
 */
export interface StationManualReviewAudit {
  readonly reviewVersion: string
  readonly operatorId: string
  readonly reviewedAt: string
  readonly reason: string
}

/**
 * 事后核对上下文：手动动作已经结束（甚至会话已经关闭）时用来核对它的现场结果。
 *
 * `reviewVersion` 必须原样回传：期间别人核对过或结果变了，提交会被 OS 以
 * `manual_review_version_conflict` 拒绝，而不是把别人的核对顶掉。
 */
export interface StationManualReviewContext {
  readonly kind: 'station_manual_review_context'
  readonly source: 'os'
  readonly stationId: string
  readonly sessionId: string | null
  readonly sessionStage: StationHandlingStage | null
  readonly job: StationManualActionJob
  readonly reviewVersion: string
  readonly resultReviewed: boolean
  readonly audit: StationManualReviewAudit | null
  readonly raw: Readonly<Record<string, unknown>>
}

/** 会话内核对：OS 会校验会话身份与版本，避免顶掉别人的现场核对。 */
export interface StationSessionManualReviewRequest {
  readonly sessionId: string
  readonly expectedReviewVersion: string
  readonly reason: string
  readonly operatorConfirmed: boolean
  readonly expectedStationVersion: number
  readonly expectedSessionVersion: number
}

/** 事后核对：会话可能已经关闭，所以只带核对版本。 */
export interface StationManualReviewRequest {
  readonly expectedReviewVersion: string
  readonly reason: string
  readonly operatorConfirmed: boolean
}
