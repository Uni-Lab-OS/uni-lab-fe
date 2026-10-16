import { useCallback, useEffect, useRef, useState } from 'react'
import {
  handlingErrorMessage,
  isAmbiguousHandlingError,
  type StationHandlingIntent,
  type StationHandlingSnapshot,
} from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'

export interface StationHandlingState {
  readonly available: boolean
  readonly snapshot: StationHandlingSnapshot | null
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
 */
export function useStationHandling(): StationHandlingState {
  const { backend, readyEpoch } = useBackend()
  const available = backend.getCapabilityStatus('station.errorHandling').available
  const port = backend.core.stationErrorHandling
  const [snapshot, setSnapshot] = useState<StationHandlingSnapshot | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
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
    } catch (cause) {
      if (current !== sequence.current) return
      setReadError(cause instanceof Error ? cause.message : '读取工站错误处置状态失败')
    }
  }, [available, port])

  useEffect(() => {
    void reload()
  }, [reload, readyEpoch])

  // 只在工站错误处置通知（及重连）时重读；任务运行通知与工站快照无关。
  // 上次读取失败时，任何后续通知都触发重试，避免横幅停在“暂不可用”。
  const failed = useRef(false)
  failed.current = readError !== null
  useRuntimeInvalidation(reload, {
    enabled: available,
    minIntervalMs: 500,
    accept: (event) => failed.current || event.event === 'station.error_handling.changed',
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
    readError,
    submitting,
    submitError,
    unconfirmed,
    reload,
    submit: run,
    retryUnconfirmed: () => (unconfirmed ? run(unconfirmed) : Promise.resolve(false)),
  }
}
