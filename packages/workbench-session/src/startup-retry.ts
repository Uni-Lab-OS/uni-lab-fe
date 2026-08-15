export interface WindowsReadinessRetryInput {
  platform: NodeJS.Platform
  retriesRemaining: number
  diagnosticCode: string
  exitCode: number | null | undefined
  signalCode: NodeJS.Signals | null | undefined
  stopRequested: boolean
}

/** Retry only the observed transient Windows pre-health exit, never a config error. */
export function isRetryableWindowsReadinessExit(
  input: WindowsReadinessRetryInput
): boolean {
  return input.platform === 'win32'
    && input.retriesRemaining > 0
    && input.diagnosticCode === 'os_readiness_failed'
    && input.exitCode === 1
    && input.signalCode === null
    && !input.stopRequested
}
