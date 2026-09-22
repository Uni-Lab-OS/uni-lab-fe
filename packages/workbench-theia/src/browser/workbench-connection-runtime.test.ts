import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  backendHealthProbeEnabled,
  monitorBackendConnection,
  sessionConnectionState
} from './workbench-connection-runtime'

afterEach(() => vi.useRealTimers())

describe('Workbench connection runtime projection', () => {
  it('probes Backend health only in production connection mode', () => {
    expect(backendHealthProbeEnabled('backend')).toBe(true)
    expect(backendHealthProbeEnabled('local')).toBe(false)
  })

  /** 证明托管 OS 生命周期只投影传输健康，不伪造调度或任务状态。 */
  it('maps managed session phases to connection states', () => {
    expect(sessionConnectionState('ready')).toBe('connected')
    expect(sessionConnectionState('failed')).toBe('error')
    expect(sessionConnectionState('idle')).toBe('disconnected')
    expect(sessionConnectionState('starting')).toBe('connecting')
    expect(sessionConnectionState('waiting')).toBe('connecting')
  })

  it('updates the status when a previously healthy Backend disconnects', async () => {
    vi.useFakeTimers()
    const ping = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const states: string[] = []
    const stop = monitorBackendConnection(
      ping,
      state => states.push(state),
      3_000
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(states).toEqual(['connected'])

    await vi.advanceTimersByTimeAsync(3_000)
    expect(states).toEqual(['connected', 'error'])
    stop()
  })

  it('stops polling after the connection monitor is disposed', async () => {
    vi.useFakeTimers()
    const ping = vi.fn().mockResolvedValue(true)
    const stop = monitorBackendConnection(ping, vi.fn(), 3_000)

    await vi.advanceTimersByTimeAsync(0)
    stop()
    await vi.advanceTimersByTimeAsync(6_000)

    expect(ping).toHaveBeenCalledTimes(1)
    expect(ping.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
  })
})
