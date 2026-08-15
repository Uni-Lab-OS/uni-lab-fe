import { describe, expect, it } from 'vitest'

import { isRetryableWindowsReadinessExit } from './startup-retry'

describe('isRetryableWindowsReadinessExit', () => {
  it('allows one Windows code-1 exit before readiness', () => {
    expect(isRetryableWindowsReadinessExit({
      platform: 'win32',
      retriesRemaining: 1,
      diagnosticCode: 'os_readiness_failed',
      exitCode: 1,
      signalCode: null,
      stopRequested: false
    })).toBe(true)
  })

  it.each([
    ['persistent second failure', 'win32', 0, 'os_readiness_failed', 1, null, false],
    ['CLI/config failure', 'win32', 1, 'os_readiness_failed', 2, null, false],
    ['user stop', 'win32', 1, 'os_readiness_failed', 1, null, true],
    ['macOS failure', 'darwin', 1, 'os_readiness_failed', 1, null, false]
  ] as const)('rejects %s', (
    _label,
    platform,
    retriesRemaining,
    diagnosticCode,
    exitCode,
    signalCode,
    stopRequested
  ) => {
    expect(isRetryableWindowsReadinessExit({
      platform,
      retriesRemaining,
      diagnosticCode,
      exitCode,
      signalCode,
      stopRequested
    })).toBe(false)
  })
})
