import type {
  DeviceCardRobotCommissioningOperation
} from '@unilab/device-card-sdk'

const COMMISSIONING_CLOSE_TIMEOUT_MS = 5_000
const COMMISSIONING_REQUEST_TIMEOUT_MS = 70_000
const COMMISSIONING_EXECUTE_TIMEOUT_MS = 310_000

/**
 * Native card views are disposable, so their close acknowledgement is best
 * effort. Keep its timeout short and never reuse it as an open-session gate.
 */
export function commissioningResponseTimeoutMs(
  operation: DeviceCardRobotCommissioningOperation
): number {
  if (operation === 'execute') return COMMISSIONING_EXECUTE_TIMEOUT_MS
  if (operation === 'close') return COMMISSIONING_CLOSE_TIMEOUT_MS
  return COMMISSIONING_REQUEST_TIMEOUT_MS
}

/**
 * Starts remote session cleanup without turning a missing renderer response
 * into a lifecycle barrier for the next card view.
 */
export function dispatchBestEffortCommissioningClose<T>(
  dispatch: () => Promise<T>,
  onSettled: (result: PromiseSettledResult<T>) => void
): void {
  let running: Promise<T>
  try {
    running = dispatch()
  } catch (reason) {
    onSettled({ status: 'rejected', reason })
    return
  }
  void running.then(
    value => onSettled({ status: 'fulfilled', value }),
    reason => onSettled({ status: 'rejected', reason })
  )
}
