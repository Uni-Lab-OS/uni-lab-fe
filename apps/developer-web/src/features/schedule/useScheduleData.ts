import { useCallback, useEffect, useRef, useState } from 'react'
import type { SchedulerTimeline, TaskRuntimeListItem, TimePlanSnapshot } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import type { StudioBackend } from '../../app/backend'
import { useRuntimeInvalidation } from '../../hooks/useRuntimeInvalidation'
import { isQueryFresh, peekQuery, readQuery, type CachedQuery } from '../../hooks/queryCache'
import {
  loadTaskList,
  TASK_LIST_FRESHNESS,
  taskListQueryKey,
  taskListView,
} from '../tasks/taskListSource'

export interface ScheduleData {
  readonly available: boolean
  readonly unavailableReason: string | null
  readonly plan: TimePlanSnapshot | null
  readonly timeline: SchedulerTimeline | null
  readonly tasks: readonly TaskRuntimeListItem[]
  readonly loading: boolean
  readonly error: string | null
  /** 最近一次读取时的“服务端时刻 − 本地时刻”（秒），用于把“现在”线对齐服务端时钟。 */
  readonly serverOffset: number
  readonly loadedAt: number | null
  readonly reload: () => void
}

interface ScheduleSnapshot {
  readonly plan: TimePlanSnapshot
  readonly timeline: SchedulerTimeline
  readonly tasks: readonly TaskRuntimeListItem[]
  readonly serverOffset: number
  readonly loadedAt: number
}

interface ScheduleState {
  readonly plan: TimePlanSnapshot | null
  readonly timeline: SchedulerTimeline | null
  readonly tasks: readonly TaskRuntimeListItem[]
  readonly error: string | null
  readonly serverOffset: number
  readonly loadedAt: number | null
}

const SCHEDULE_KEY = 'scheduler-snapshot'
const EMPTY: ScheduleState = {
  plan: null,
  timeline: null,
  tasks: [],
  error: null,
  serverOffset: 0,
  loadedAt: null,
}

/**
 * 只用于任务名称与节点标签：默认展示投影每条内嵌执行计划（约 10 MB），只取最近 10 个；
 * 摘要视图很小，取 20 个并与总览、任务页共用同一份列表缓存。
 */
function scheduleTaskPage(backend: Pick<StudioBackend, 'getCapabilityStatus'>) {
  return { page: 1, pageSize: taskListView(backend) === 'summary' ? 20 : 10 }
}

async function readSchedule(backend: StudioBackend, force: boolean): Promise<ScheduleSnapshot> {
  const page = scheduleTaskPage(backend)
  const [plan, timeline, tasks] = await Promise.all([
    backend.core.schedulerTimePlan.getTimePlan(),
    backend.core.schedulerTimePlan.getTimeline(),
    readQuery(backend, taskListQueryKey(backend, page), () => loadTaskList(backend, page), {
      force,
      freshness: TASK_LIST_FRESHNESS,
    }),
  ])
  return {
    plan,
    timeline,
    tasks: tasks.items,
    serverOffset: timeline.now - Date.now() / 1000,
    loadedAt: Date.now(),
  }
}

function fromSnapshot(snapshot: ScheduleSnapshot | undefined): ScheduleState {
  return snapshot ? { ...snapshot, error: null } : EMPTY
}

/** 进入页面时的初始状态：之后的刷新若已失败，不再沿用那次之前的预测，只保留实际记录。 */
function fromCache(cached: CachedQuery<ScheduleSnapshot> | undefined): ScheduleState {
  const state = fromSnapshot(cached?.value)
  return cached?.stale ? { ...state, plan: null } : state
}

/**
 * 调度观测数据：时间计划、实际执行时间线与任务列表。读取时机只有进入页面（缓存过期时）、
 * 全局 SSE 失效通知（任务/作业变化，派发前计划必然已通过验证）和手动刷新，不轮询。
 * 切回页面先显示上次读到的快照（含“更新于”时刻），30 秒内且没有失效通知时不重复读取。
 */
export function useScheduleData(): ScheduleData {
  const { backend, readyEpoch } = useBackend()
  const capability = backend.getCapabilityStatus('scheduler.timePlan')
  const [state, setState] = useState<ScheduleState>(() =>
    fromCache(peekQuery<ScheduleSnapshot>(backend, SCHEDULE_KEY)),
  )
  const [loading, setLoading] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(
    async (force: boolean) => {
      if (!capability.available) return
      const current = ++sequence.current
      setLoading(true)
      try {
        const snapshot = await readQuery(
          backend,
          SCHEDULE_KEY,
          () => readSchedule(backend, force),
          { force, freshness: TASK_LIST_FRESHNESS },
        )
        if (current !== sequence.current) return
        setState(fromSnapshot(snapshot))
      } catch (cause) {
        if (current !== sequence.current) return
        setState((previous) => ({
          ...previous,
          // 读取失败时不沿用旧预测；实际记录保留，并明确提示。
          plan: null,
          error: cause instanceof Error ? cause.message : '读取调度数据失败',
        }))
      } finally {
        if (current === sequence.current) setLoading(false)
      }
    },
    [backend, capability.available],
  )

  const initialEpoch = useRef(readyEpoch)
  useEffect(() => {
    // 进入页面：新鲜快照直接使用；后端由启动中转为就绪时必须重读。
    const cached = peekQuery<ScheduleSnapshot>(backend, SCHEDULE_KEY)
    const ready = readyEpoch !== initialEpoch.current
    if (!ready && cached && isQueryFresh(backend, cached, TASK_LIST_FRESHNESS)) return
    void load(ready)
  }, [backend, load, readyEpoch])

  // 运行中失效通知几乎连续到达；调度快照至多 2 秒重读一次。
  useRuntimeInvalidation(() => load(true), { enabled: capability.available })

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
    reload: () => void load(true),
  }
}
