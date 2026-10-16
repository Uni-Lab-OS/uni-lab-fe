import type {
  StationError,
  StationErrorAction,
  StationHandlingIntent,
  StationHandlingSession,
  StationHandlingSnapshot,
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
  returnToSessionIntent(snapshot: StationHandlingSnapshot, session: StationHandlingSession): StationHandlingIntent
  resumeIntent(snapshot: StationHandlingSnapshot): StationHandlingIntent
  applyCommandIntent(commandUuid: string): StationHandlingIntent
  submit(intent: StationHandlingIntent): Promise<Readonly<Record<string, unknown>>>
}
