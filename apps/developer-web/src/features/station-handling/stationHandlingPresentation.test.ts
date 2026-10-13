import { describe, expect, it } from 'vitest'
import {
  decisionAvailability,
  errorFactPresentation,
  resumeAvailability,
  stationErrorForJob,
  stationStageLabel,
  stationStatusPresentation,
} from './stationHandlingPresentation'
import { makeStationError, makeStationSnapshot } from '../../../test/stationHandlingStub'

describe('station handling presentation', () => {
  it('matches a station error to a node only by the OS source job uuid', () => {
    const error = makeStationError({ sourceJobUuid: 'job-1' })
    const snapshot = makeStationSnapshot({ errors: [error] })

    expect(stationErrorForJob(snapshot, 'job-1')).toBe(error)
    expect(stationErrorForJob(snapshot, 'job-2')).toBeNull()
    // 没有快照或没有 job 身份时必须返回 null，不能猜一条错误事实出来。
    expect(stationErrorForJob(undefined, 'job-1')).toBeNull()
    expect(stationErrorForJob(snapshot, undefined)).toBeNull()
  })

  it('treats an unreadable snapshot as an error that blocks action', () => {
    const status = stationStatusPresentation(undefined, new Error('服务尚未就绪'))
    expect(status.tone).toBe('error')
    expect(status.needsAction).toBe(true)
    expect(status.detail).toContain('服务尚未就绪')
    expect(status.detail).toContain('暂停全部处置写入')
  })

  it('stays quiet while a healthy station runs', () => {
    const status = stationStatusPresentation(makeStationSnapshot(), undefined)
    expect(status.tone).toBe('ok')
    expect(status.needsAction).toBe(false)
  })

  it('counts errors and pending commands without inventing state', () => {
    const paused = stationStatusPresentation(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [makeStationError()],
        controlCommands: [
          {
            commandUuid: 'c1',
            operation: 'retry_current_node',
            status: 'PENDING',
            needsApply: true,
          },
          {
            commandUuid: 'c2',
            operation: 'retry_current_node',
            status: 'APPLIED',
            needsApply: false,
          },
        ],
      }),
      undefined,
    )
    expect(paused.tone).toBe('error')
    expect(paused.needsAction).toBe(true)
    expect(paused.detail).toContain('1 个节点等待处置')
    expect(paused.detail).toContain('1 条操作已受理待应用')

    // 没有错误但工站仍暂停 —— 这是「处理完成 ≠ 恢复运行」那个状态。
    const stillPaused = stationStatusPresentation(
      makeStationSnapshot({ mode: 'PAUSED' }),
      undefined,
    )
    expect(stillPaused.tone).toBe('attention')
    expect(stillPaused.detail).toContain('调度还没有恢复')
  })

  it('labels every stage and error kind explicitly, never by colour alone', () => {
    expect(stationStageLabel('DECISION_REQUIRED')).toBe('等待处置决定')
    expect(stationStageLabel('MANUAL_HANDLING')).toBe('人工处置中')
    expect(errorFactPresentation(makeStationError()).label).toBe('等待处置决定')
    expect(errorFactPresentation(makeStationError({ stage: 'MANUAL_HANDLING' })).label).toBe(
      '人工处置中',
    )
    expect(errorFactPresentation(makeStationError({ stage: 'APPLYING' })).label).toBe(
      '已受理，正在应用',
    )
    // 已处理的错误不能再显示成「等待处置决定」，否则会给用户一个假的待办。
    expect(errorFactPresentation(makeStationError({ stage: 'RESOLVED' }))).toEqual({
      tone: 'ok',
      label: '已处理',
    })
    expect(stationStageLabel('RESOLVED')).toBe('已处理')
  })

  it('keeps errors waiting visible after scheduling resumes', () => {
    // 工站已恢复 RUNNING 但错误还没处置：不能显示成「运行中、一切正常」。
    const status = stationStatusPresentation(
      makeStationSnapshot({ mode: 'RUNNING', errors: [makeStationError()] }),
      undefined,
    )
    expect(status.tone).toBe('error')
    expect(status.label).toBe('仍有错误等待决定')
    expect(status.needsAction).toBe(true)
    expect(status.detail).toContain('错误任务仍等待各自的决定')
  })

  it('gates the decision on read state, stage and the single station session', () => {
    expect(decisionAvailability(makeStationSnapshot(), null, undefined)).toEqual({ kind: 'none' })

    const error = makeStationError()
    expect(decisionAvailability(undefined, error, new Error('boom')).kind).toBe('blocked')
    expect(decisionAvailability(undefined, error, undefined).kind).toBe('blocked')
    expect(decisionAvailability(makeStationSnapshot({ errors: [error] }), error).kind).toBe('ready')

    // 已处理的错误不再提供任何决定入口（快照可能早于别处完成的处置）。
    expect(
      decisionAvailability(
        makeStationSnapshot({ errors: [error] }),
        makeStationError({ stage: 'RESOLVED' }),
      ).kind,
    ).toBe('none')

    expect(
      decisionAvailability(makeStationSnapshot({ errors: [error], mode: 'PAUSED' }), error).kind,
    ).toBe('ready')

    // 会话属于另一条错误时必须在本地就挡住，而不是提交后拿 409。
    const otherSession = decisionAvailability(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [error],
        activeSessionId: 'session-9',
        activeSession: {
          kind: 'station_handling_session',
          source: 'os',
          sessionId: 'session-9',
          decisionId: 'decision-9',
          stage: 'MANUAL_HANDLING',
          version: 1,
          summary: '',
          raw: {},
        },
      }),
      error,
    )
    expect(otherSession.kind).toBe('blocked')
    expect(otherSession.kind === 'blocked' && otherSession.reason).toContain(
      '另一条错误正在人工处置',
    )

    expect(
      decisionAvailability(makeStationSnapshot(), makeStationError({ stage: 'APPLYING' })).kind,
    ).toBe('applying')
    expect(
      decisionAvailability(makeStationSnapshot(), makeStationError({ stage: 'MANUAL_HANDLING' }))
        .kind,
    ).toBe('manual')
  })

  it('only offers resume when there is nothing left to decide or apply', () => {
    expect(resumeAvailability(undefined, new Error('boom')).available).toBe(false)
    expect(resumeAvailability(makeStationSnapshot(), undefined).available).toBe(false)
    expect(
      resumeAvailability(
        makeStationSnapshot({ mode: 'PAUSED', errors: [makeStationError()] }),
        undefined,
      ).available,
    ).toBe(false)
    expect(
      resumeAvailability(
        makeStationSnapshot({
          mode: 'PAUSED',
          controlCommands: [
            { commandUuid: 'c1', operation: 'resume', status: 'PENDING', needsApply: true },
          ],
        }),
        undefined,
      ).available,
    ).toBe(false)

    const ready = resumeAvailability(makeStationSnapshot({ mode: 'PAUSED' }), undefined)
    expect(ready.available).toBe(true)
    expect(ready.reason).toContain('确认现场')
  })
})
