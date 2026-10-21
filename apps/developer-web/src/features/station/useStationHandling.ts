import { useCallback, useEffect, useRef, useState } from 'react'
import {
  handlingErrorMessage,
  isAmbiguousHandlingError,
  isBackendUnavailableError,
  type StationHandlingIntent,
  type StationHandlingSnapshot,
} from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'

export interface StationHandlingState {
  readonly available: boolean
  readonly snapshot: StationHandlingSnapshot | null
  /** OS 尚未就绪（启动中或暂时连不上）：不是读取失败，就绪后自动重读，不提示“暂不可用”。 */
  readonly starting: boolean
  readonly readError: string | null
  readonly submitting: boolean
  readonly submitError: string | null
  /** 结果不明确的写操作：只能按原幂等键重发，不能重新构造。 */
  readonly unconfirmed: StationHandlingIntent | null
  readonly reload: () => Promise<void>
  readonly submit: (intent: StationHandlingIntent) => Promise<boolean>
  readonly retryUnconfirmed: () => Promise<boolean>
}

/**
 * 工站错误处置状态。读取时机：首次进入、station.error_handling.changed 通知、每次提交之后与手动刷新；不轮询。
 * 读取失败时禁止写操作（快照版本未知时提交只会产生冲突或误操作）。
 * OS 启动中的失败交给全局就绪轮询（与页面查询相同），就绪后经 readyEpoch 自动重读。
 */
export function useStationHandling(): StationHandlingState {
  const { backend, readyEpoch, reportError } = useBackend()
  const available = backend.getCapabilityStatus('station.errorHandling').available
  const port = backend.core.stationErrorHandling
  const [snapshot, setSnapshot] = useState<StationHandlingSnapshot | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<StationHandlingIntent | null>(null)
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    if (!available) return
    const current = ++sequence.current
    try {
      const next = await port.getSnapshot()
      if (current !== sequence.current) return
      setSnapshot(next)
      setReadError(null)
      setStarting(false)
    } catch (cause) {
      if (current !== sequence.current) return
      if (isBackendUnavailableError(cause)) {
        // 快照仍未知，写操作照样不可用；但这不是故障，不显示“暂不可用”。
        setSnapshot(null)
        setReadError(null)
        setStarting(true)
        reportError(cause)
        return
      }
      setStarting(false)
      setReadError(cause instanceof Error ? cause.message : '读取工站错误处置状态失败')
    }
  }, [available, port, reportError])

  useEffect(() => {
    void reload()
  }, [reload, readyEpoch])

  // 只在工站错误处置通知（及重连）时重读；任务运行通知与工站快照无关。例外：
  // 上次读取失败时任何通知都触发重试；人工处置会话进行中时，手动动作本身是独立任务，
  // 其进度只发任务运行通知，也要重读以更新动作状态。
  const failed = useRef(false)
  failed.current = readError !== null || starting
  const sessionActive = useRef(false)
  sessionActive.current = Boolean(snapshot?.activeSession)
  useRuntimeInvalidation(reload, {
    enabled: available,
    minIntervalMs: 500,
    accept: (event) =>
      failed.current || sessionActive.current || event.event === 'station.error_handling.changed',
  })

  const run = useCallback(
    async (intent: StationHandlingIntent) => {
      setSubmitting(true)
      setSubmitError(null)
      try {
        await port.submit(intent)
        setUnconfirmed(null)
        return true
      } catch (cause) {
        if (isAmbiguousHandlingError(cause)) setUnconfirmed(intent)
        else setUnconfirmed(null)
        setSubmitError(`${intent.label}：${handlingErrorMessage(cause)}`)
        return false
      } finally {
        setSubmitting(false)
        // 无论成功与否都重读权威状态：受理不等于已应用，冲突时需要按最新版本重选。
        await reload()
      }
    },
    [port, reload],
  )

  return {
    available,
    snapshot,
    starting,
    readError,
    submitting,
    submitError,
    unconfirmed,
    reload,
    submit: run,
    retryUnconfirmed: () => (unconfirmed ? run(unconfirmed) : Promise.resolve(false)),
  }
}
