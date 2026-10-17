import type {
  StationError,
  StationErrorAction,
  StationHandlingIntent,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationDeviceAction,
  StationManualAction,
  StationOccupancy,
} from './model'

/**
 * OS-only 工站错误处置。intent 构造与提交分开：提交结果不明确（网络中断、超时、5xx）时，
 * 调用方用同一 intent 重发（同一幂等键），不得重新构造新的操作。
 */
export interface StationErrorHandlingPort {
  getSnapshot(): Promise<StationHandlingSnapshot>
  decisionIntent(
    snapshot: StationHandlingSnapshot,
    error: StationError,
    action: StationErrorAction,
    options: { readonly resume: boolean; readonly reason: string },
  ): StationHandlingIntent
  completeSessionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    summary: string,
  ): StationHandlingIntent
  returnToSessionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
  ): StationHandlingIntent
  resumeIntent(snapshot: StationHandlingSnapshot): StationHandlingIntent
  applyCommandIntent(commandUuid: string): StationHandlingIntent
  /** 当前逻辑资源占用（执行锁、设备托管）。 */
  listOccupancies(): Promise<readonly StationOccupancy[]>
  /**
   * 释放选中的占用。OS 要求工站暂停、填写原因，并挂在一条待决定或人工处置中的错误上；
   * 若该错误正处于人工处置会话，则带上会话版本。
   */
  releaseOccupanciesIntent(
    snapshot: StationHandlingSnapshot,
    error: StationError,
    occupancies: readonly StationOccupancy[],
    reason: string,
  ): StationHandlingIntent
  /** 人工处置会话中某设备（物料 UUID）的全部可用动作。 */
  listDeviceActions(sessionId: string, deviceUuid: string): Promise<readonly StationDeviceAction[]>
  /** 在人工处置会话中下发一个手动设备动作（会真实驱动设备）。 */
  manualActionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    deviceUuid: string,
    action: StationDeviceAction,
    parameters: Readonly<Record<string, unknown>>,
  ): StationHandlingIntent
  /** 结果未知的手动动作在现场核对后登记核对结论（不改执行结论，不清除占用）。 */
  reviewManualActionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    action: StationManualAction,
    reason: string,
  ): StationHandlingIntent
  submit(intent: StationHandlingIntent): Promise<Readonly<Record<string, unknown>>>
}
