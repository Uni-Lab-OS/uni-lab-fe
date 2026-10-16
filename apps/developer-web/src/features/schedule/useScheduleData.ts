import { useCallback, useEffect, useRef, useState } from 'react'
import type { SchedulerTimeline, TaskRuntimePresentation, TimePlanSnapshot } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'

export interface ScheduleData {
  readonly available: boolean
  readonly unavailableReason: string | null
  readonly plan: TimePlanSnapshot | null
  readonly timeline: SchedulerTimeline | null
  readonly tasks: readonly TaskRuntimePresentation[]
  readonly loading: boolean
  readonly error: string | null
  /** 最近一次读取时的“服务端时刻 − 本地时刻”（秒），用于把“现在”线对齐服务端时钟。 */
  readonly serverOffset: number
  readonly loadedAt: number | null
  readonly reload: () => void
}

/**
 * 调度观测数据：时间计划、实际执行时间线与任务列表。读取时机只有首次进入、
 * 全局 SSE 失效通知（任务/作业变化，派发前计划必然已通过验证）和手动刷新，不轮询。
 */
export function useScheduleData(): ScheduleData {
  const { backend, readyEpoch } = useBackend()
  const capability = backend.getCapabilityStatus('scheduler.timePlan')
  const [state, setState] = useState<{
    plan: TimePlanSnapshot | null
    timeline: SchedulerTimeline | null
    tasks: readonly TaskRuntimePresentation[]
    error: string | null
    serverOffset: number
    loadedAt: number | null
  }>({ plan: null, timeline: null, tasks: [], error: null, serverOffset: 0, loadedAt: null })
  const [loading, setLoading] = useState(false)
  const sequence = useRef(0)
  const pending = useRef(false)

  const load = useCallback(async () => {
    if (!capability.available) return
    if (pending.current) return
    pending.current = true
    const current = ++sequence.current
    setLoading(true)
    try {
      const [plan, timeline, tasks] = await Promise.all([
        backend.core.schedulerTimePlan.getTimePlan(),
        backend.core.schedulerTimePlan.getTimeline(),
        backend.core.executionRead.listTaskPresentations({
          page: 1,
          // 只用于任务名称与作业执行种类；每条约 10 MB，只取最近 10 个任务。
          pageSize: 10,
        }),
      ])
      if (current !== sequence.current) return
      setState({
        plan,
        timeline,
        tasks: tasks.items,
        error: null,
        serverOffset: timeline.now - Date.now() / 1000,
        loadedAt: Date.now(),
      })
    } catch (cause) {
      if (current !== sequence.current) return
      setState((previous) => ({
        ...previous,
        // 读取失败时不沿用旧预测；实际记录保留，并明确提示。
        plan: null,
        error: cause instanceof Error ? cause.message : '读取调度数据失败',
      }))
    } finally {
      pending.current = false
      if (current === sequence.current) setLoading(false)
    }
  }, [backend, capability.available])

  useEffect(() => {
    void load()
  }, [load, readyEpoch])

  // 运行中失效通知几乎连续到达；调度快照至多 2 秒重读一次。
  useRuntimeInvalidation(load, { enabled: capability.available })

  return {
    available: capability.available,
    unavailableReason: capability.available
      ? null
      : (capability.reason ?? '当前后端不支持调度观测'),
    plan: state.plan,
    timeline: state.timeline,
    tasks: state.tasks,
    loading,
    error: state.error,
    serverOffset: state.serverOffset,
    loadedAt: state.loadedAt,
    reload: () => void load(),
  }
}
