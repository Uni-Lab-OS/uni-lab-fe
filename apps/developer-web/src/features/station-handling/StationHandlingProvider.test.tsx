import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { StationHandlingError } from '@unilab-fe/core'
import { useStationHandling } from './StationHandlingProvider'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeStationError,
  makeStationReceipt,
  makeStationSnapshot,
  StationProviders,
} from '../../../test/stationHandlingStub'

const stationPort = createStationPortStub()
const backend = createStudioBackendStub({ core: { stationErrorHandling: stationPort } })
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

const pausedWith = (overrides = {}) =>
  makeStationSnapshot({ mode: 'PAUSED', errors: [makeStationError()], ...overrides })

// 端口替身是模块级共享的：每个用例都从干净状态开始，避免调用史跨用例泄漏。
beforeEach(() => {
  vi.clearAllMocks()
  stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot())
  stationPort.decide.mockResolvedValue(makeStationReceipt())
  stationPort.resume.mockResolvedValue(makeStationReceipt({ operation: 'resume' }))
})

describe('station handling provider', () => {
  it('reads the authoritative snapshot on mount', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot?.mode).toBe('PAUSED'))
    expect(result.current.snapshot?.errors[0].decisionId).toBe('decision-1')
    expect(result.current.readError).toBeUndefined()
  })

  it('sends the version fields read from the snapshot plus an idempotency key', async () => {
    const current = pausedWith({ stationVersion: 7, errorEpoch: 3, snapshotId: 'local:7:3' })
    stationPort.getSnapshot.mockResolvedValue(current)
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    await act(async () => {
      await result.current.decide({
        error: current.errors[0],
        action: 'retry_current_node',
        reason: '  现场已核对  ',
        resumeRequested: true,
        operatorConfirmed: true,
      })
    })

    expect(stationPort.decide).toHaveBeenCalledTimes(1)
    const [decisionId, request, options] = stationPort.decide.mock.calls[0]
    expect(decisionId).toBe('decision-1')
    expect(request).toMatchObject({
      action: 'retry_current_node',
      expectedStationVersion: 7,
      expectedDecisionVersion: 2,
      observedErrorEpoch: 3,
      resumeRequested: true,
      operatorConfirmed: true,
      confirmSnapshotId: 'local:7:3',
      reason: '现场已核对',
    })
    expect(typeof options.idempotencyKey).toBe('string')
    expect(options.idempotencyKey.length).toBeGreaterThan(0)
    // 202 只代表受理：必须重新读快照确认生效。
    expect(stationPort.getSnapshot.mock.calls.length).toBeGreaterThan(1)
  })

  it('carries the session fields the OS validates when the error belongs to the active session', async () => {
    const error = makeStationError({ sessionId: 'session-1' })
    const current = makeStationSnapshot({
      mode: 'PAUSED',
      errors: [error],
      activeSessionId: 'session-1',
      activeSession: {
        kind: 'station_handling_session',
        source: 'os',
        sessionId: 'session-1',
        decisionId: 'decision-1',
        stage: 'DECISION_REQUIRED',
        version: 4,
        summary: '',
        raw: {},
      },
    })
    stationPort.getSnapshot.mockResolvedValue(current)
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    await act(async () => {
      await result.current.decide({
        error,
        action: 'retry_current_node',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })

    const [, request] = stationPort.decide.mock.calls[0]
    expect(request).toMatchObject({ sessionId: 'session-1', expectedSessionVersion: 4 })
  })

  it('omits session fields when the error session is no longer the active one', async () => {
    // OS 校验的是错误事实自带的 session_id；会话不在活动会话里时前端拿不到
    // 会话版本，不能猜一个版本号发过去。
    const error = makeStationError({ sessionId: 'session-1' })
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [error] }),
    )
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    await act(async () => {
      await result.current.decide({
        error,
        action: 'cancel_task',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })

    const [, request] = stationPort.decide.mock.calls[0]
    expect(request).not.toHaveProperty('sessionId')
    expect(request).not.toHaveProperty('expectedSessionVersion')
  })

  it('refuses to resume implicitly and refuses resume without confirmation', async () => {
    const current = pausedWith()
    stationPort.getSnapshot.mockResolvedValue(current)
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    await act(async () => {
      await result.current.decide({
        error: current.errors[0],
        action: 'cancel_task',
        resumeRequested: true,
        operatorConfirmed: false,
      })
    })
    expect(stationPort.decide).not.toHaveBeenCalled()
    expect(result.current.submitError).toContain('我已核对现场')

    await act(async () => {
      await result.current.resume({ operatorConfirmed: false })
    })
    expect(stationPort.resume).not.toHaveBeenCalled()
    expect(result.current.submitError).toContain('我已核对现场')
  })

  it('surfaces a read failure and refuses to keep a stale snapshot', async () => {
    stationPort.getSnapshot.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })

    await waitFor(() => expect(result.current.readError).toBeDefined())
    expect(result.current.snapshot).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it('reuses the same idempotency key when the previous result is unknown', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    stationPort.decide.mockRejectedValueOnce(new Error('network down'))
    await act(async () => {
      await result.current.decide({
        error: makeStationError(),
        action: 'retry_current_node',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })
    expect(result.current.unconfirmed).toEqual({ label: '节点错误处置决定' })

    stationPort.decide.mockResolvedValueOnce(makeStationReceipt())
    await act(async () => {
      await result.current.retryUnconfirmed()
    })

    expect(stationPort.decide).toHaveBeenCalledTimes(2)
    const firstKey = stationPort.decide.mock.calls[0][2].idempotencyKey
    const secondKey = stationPort.decide.mock.calls[1][2].idempotencyKey
    // 结果未知时必须用同一个键重发，否则会在 OS 侧产生第二条操作。
    expect(secondKey).toBe(firstKey)
  })

  it('reports a FAILED receipt as not applied instead of success', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    stationPort.decide.mockResolvedValue(makeStationReceipt({ status: 'FAILED' }))
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    let ok = true
    await act(async () => {
      ok = await result.current.decide({
        error: makeStationError(),
        action: 'cancel_task',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })
    expect(ok).toBe(false)
    expect(result.current.submitError).toContain('未被应用')
  })

  it('继续应用失败时如实报错并重新读取快照', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    stationPort.applyControlCommand.mockRejectedValueOnce(new Error('库存权威未装配'))
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    const before = stationPort.getSnapshot.mock.calls.length
    let ok = true
    await act(async () => {
      ok = await result.current.applyCommand('cmd-1')
    })

    expect(ok).toBe(false)
    expect(stationPort.applyControlCommand).toHaveBeenCalledWith('cmd-1')
    expect(result.current.submitError).toContain('库存权威未装配')
    expect(stationPort.getSnapshot.mock.calls.length).toBeGreaterThan(before)
  })

  it('reports an accepted-but-not-applied command instead of calling it done', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    stationPort.decide.mockResolvedValue(
      makeStationReceipt({ status: 'PENDING', applicationError: '等待手动动作结束' }),
    )
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    let ok = true
    await act(async () => {
      ok = await result.current.decide({
        error: makeStationError(),
        action: 'retry_current_node',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })
    expect(ok).toBe(false)
    expect(result.current.submitError).toContain('已受理')
    expect(result.current.submitError).toContain('等待手动动作结束')
  })

  it('drops the intent on a determinate rejection but keeps it when the result is unknown', async () => {
    stationPort.getSnapshot.mockResolvedValue(pausedWith())
    const { result } = renderHook(() => useStationHandling(), { wrapper: StationProviders })
    await waitFor(() => expect(result.current.snapshot).toBeDefined())

    stationPort.decide.mockRejectedValueOnce(
      new StationHandlingError(
        'STATION_VERSION_CONFLICT',
        '工站状态已变化，请核对后重新选择。',
        409,
      ),
    )
    await act(async () => {
      await result.current.decide({
        error: makeStationError(),
        action: 'retry_current_node',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })
    expect(result.current.submitError).toContain('工站状态已变化')
    expect(result.current.unconfirmed).toBeUndefined()

    stationPort.decide.mockRejectedValueOnce(new Error('network down'))
    await act(async () => {
      await result.current.decide({
        error: makeStationError(),
        action: 'retry_current_node',
        resumeRequested: false,
        operatorConfirmed: false,
      })
    })
    expect(result.current.submitError).toContain('按原请求重试')
    expect(result.current.unconfirmed).toEqual({ label: '节点错误处置决定' })
  })
})
