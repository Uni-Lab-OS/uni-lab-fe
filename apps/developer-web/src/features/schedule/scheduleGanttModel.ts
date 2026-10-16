import type { SchedulerTimeline, TimePlanCandidate, TimePlanSnapshot } from '@unilab-fe/core'

/** manual：人工确认等待中（OS 已为其登记在途并占用设备，但设备尚未动作）。 */
export type GanttBarKind = 'actual' | 'running' | 'manual' | 'planned'

export interface GanttBar {
  readonly id: string
  readonly kind: GanttBarKind
  readonly taskId: string
  readonly nodeId: string
  readonly deviceId: string
  readonly label: string
  /** 绝对时间（秒，服务端时钟）。 */
  readonly start: number
  readonly end: number
  /** running：派发起点 + 估时，可能早于“现在”（已超预计）。 */
  readonly estimatedEnd?: number
  /** actual：调度器结算状态；running/planned 为空。 */
  readonly state?: string
  readonly parametersFinal?: boolean
}

export interface GanttLane {
  readonly deviceId: string
  readonly bars: readonly GanttBar[]
}

export interface GanttTaskSummary {
  readonly taskId: string
  readonly firstStart: number | null
  readonly lastActualEnd: number | null
  /** 当前计划中该任务最晚的预测结束；只覆盖计划范围，不代表任务一定在此完成。 */
  readonly plannedEnd: number | null
  /** 计划是否只覆盖该任务已知前缀（if 未决、人工确认等）。 */
  readonly partial: boolean
}

export interface ScheduleGantt {
  readonly lanes: readonly GanttLane[]
  readonly tasks: readonly GanttTaskSummary[]
  readonly range: { readonly start: number; readonly end: number } | null
  /** 当前可展示的候选；输入版本不一致、未验证或求解失败时为 null（只保留实际记录）。 */
  readonly candidate: TimePlanCandidate | null
  readonly candidateProblem: string | null
  /** true：只是计划在随最新状态重算/求解中（暂时隐藏预测），不是故障。 */
  readonly candidateTransient: boolean
}

/**
 * 计划与当前输入一致、已验证、求解状态可用时才展示预测；
 * 否则隐藏预测条，保留实际执行记录，不沿用旧预测。
 */
export function currentCandidate(plan: TimePlanSnapshot | null): {
  candidate: TimePlanCandidate | null
  problem: string | null
  transient: boolean
} {
  const fail = (problem: string) => ({ candidate: null, problem, transient: false })
  const pending = (problem: string) => ({ candidate: null, problem, transient: true })
  if (!plan) return pending('尚未读取时间计划')
  if (!plan.enabled) {
    return fail(`OS 未启用时间排程（当前排序：${plan.algorithm}），无预测计划`)
  }
  if (plan.inputError) return fail(`排程输入无效：${plan.inputError}`)
  const latest = plan.latest
  if (!latest) return pending(plan.activeSolves > 0 ? '正在求解计划' : '暂无候选计划')
  if (latest.revision !== plan.inputRevision) return pending('计划正在随最新状态重算')
  if (!latest.validated) return fail(`候选未通过验证${latest.error ? `：${latest.error}` : ''}`)
  if (!['FEASIBLE', 'OPTIMAL'].includes(latest.status)) {
    return fail(`求解状态 ${latest.status}${latest.error ? `：${latest.error}` : ''}`)
  }
  return { candidate: latest, problem: null, transient: false }
}

export function buildScheduleGantt(input: {
  readonly timeline: SchedulerTimeline | null
  readonly plan: TimePlanSnapshot | null
  /** 当前服务端时刻（秒）：读取时的服务端 now 加上本地经过的时间，仅用于画“现在”。 */
  readonly now: number
  readonly label?: (taskId: string, nodeId: string, fallback: string) => string
  /** 作业执行种类（来自 Task/Jobs 投影）；用于区分人工确认等待与设备动作。 */
  readonly executorKind?: (taskId: string, nodeId: string) => string | undefined
}): ScheduleGantt {
  const label = input.label ?? ((_task: string, _node: string, fallback: string) => fallback)
  const bars: GanttBar[] = []
  const runningKeys = new Set<string>()
  for (const entry of input.timeline?.entries ?? []) {
    const name = label(
      entry.taskId,
      entry.nodeId,
      entry.actionName || entry.deviceActionKey || entry.nodeId,
    )
    const deviceId =
      entry.deviceId || entry.deviceActionKey.split('/').filter(Boolean)[1] || '未知设备'
    if (entry.endedAt == null) {
      runningKeys.add(`${entry.taskId}|${entry.nodeId}`)
      if (input.executorKind?.(entry.taskId, entry.nodeId) === 'manual_confirm') {
        // 调度器把人工确认节点登记为在途并占用设备，但未派发给设备；不预测人的等待时长。
        bars.push({
          id: entry.jobId,
          kind: 'manual',
          taskId: entry.taskId,
          nodeId: entry.nodeId,
          deviceId,
          label: `待人工确认：${name}`,
          start: entry.startedAt,
          end: Math.max(entry.startedAt, input.now),
        })
        continue
      }
      bars.push({
        id: entry.jobId,
        kind: 'running',
        taskId: entry.taskId,
        nodeId: entry.nodeId,
        deviceId,
        label: name,
        start: entry.startedAt,
        end: Math.max(entry.startedAt, input.now),
        estimatedEnd: entry.startedAt + entry.estimatedS,
      })
    } else if (input.executorKind?.(entry.taskId, entry.nodeId) === 'manual_confirm') {
      // 人工确认节点的区间包含人的等待时间，不是设备动作耗时。
      bars.push({
        id: entry.jobId,
        kind: 'manual',
        taskId: entry.taskId,
        nodeId: entry.nodeId,
        deviceId,
        label: `人工确认（含等待）：${name}`,
        start: entry.startedAt,
        end: Math.max(entry.startedAt, entry.endedAt),
        state: entry.state,
      })
    } else {
      bars.push({
        id: entry.jobId,
        kind: 'actual',
        taskId: entry.taskId,
        nodeId: entry.nodeId,
        deviceId,
        label: name,
        start: entry.startedAt,
        end: Math.max(entry.startedAt, entry.endedAt),
        state: entry.state,
      })
    }
  }
  const { candidate, problem, transient } = currentCandidate(input.plan)
  if (candidate) {
    for (const node of candidate.nodes) {
      // 已在途的固定节点由实际运行条表示，不再重复画预测。
      if (node.fixed && runningKeys.has(`${node.taskId}|${node.nodeId}`)) continue
      const start = candidate.timeOrigin + node.startMs / 1000
      const end = candidate.timeOrigin + node.endMs / 1000
      // 已完全落在“现在”之前的预测区间属于过期计划片段，不画。
      if (end <= input.now) continue
      bars.push({
        id: `plan:${node.taskId}:${node.nodeId}`,
        kind: 'planned',
        taskId: node.taskId,
        nodeId: node.nodeId,
        deviceId: node.deviceId,
        label: label(node.taskId, node.nodeId, node.nodeId.slice(0, 8)),
        start: Math.max(start, input.now),
        end,
        parametersFinal: node.parametersFinal,
      })
    }
  }

  const lanesByDevice = new Map<string, GanttBar[]>()
  for (const bar of bars) {
    const lane = lanesByDevice.get(bar.deviceId) ?? []
    lane.push(bar)
    lanesByDevice.set(bar.deviceId, lane)
  }
  const lanes = [...lanesByDevice.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([deviceId, laneBars]) => ({ deviceId, bars: laneBars.sort((a, b) => a.start - b.start) }))

  const partial = new Set([...(input.plan?.partialTasks ?? []), ...(candidate?.partialTasks ?? [])])
  const taskIds = [...new Set(bars.map((bar) => bar.taskId))]
  const tasks = taskIds.map((taskId) => {
    const own = bars.filter((bar) => bar.taskId === taskId)
    const executed = own.filter((bar) => bar.kind !== 'planned')
    const planned = own.filter((bar) => bar.kind === 'planned')
    return {
      taskId,
      firstStart: executed.length ? Math.min(...executed.map((bar) => bar.start)) : null,
      lastActualEnd: executed.length ? Math.max(...executed.map((bar) => bar.end)) : null,
      plannedEnd: planned.length ? Math.max(...planned.map((bar) => bar.end)) : null,
      partial: partial.has(taskId),
    }
  })

  const times = bars.flatMap((bar) => [bar.start, bar.end, bar.estimatedEnd ?? bar.end])
  const range = times.length
    ? { start: Math.min(...times), end: Math.max(input.now, ...times) }
    : null
  return {
    lanes,
    tasks,
    range,
    candidate,
    candidateProblem: problem,
    candidateTransient: transient,
  }
}

/** 任务稳定配色：同一任务在所有泳道颜色一致，便于看样品交错；不表达状态。 */
export function taskHue(taskId: string): number {
  let hash = 0
  for (const char of taskId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 360
}

export function formatClock(seconds: number): string {
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`
}

/** 选一个让刻度数量在 4–10 之间的刻度间隔（秒）。 */
export function tickStep(spanSeconds: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400]
  return steps.find((step) => spanSeconds / step <= 10) ?? 21600
}
