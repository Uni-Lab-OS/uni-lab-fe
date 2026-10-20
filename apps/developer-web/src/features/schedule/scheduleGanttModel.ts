import type {
  DeviceNameDirectory,
  SchedulerTimeline,
  TimePlanCandidate,
  TimePlanSnapshot,
} from '@unilab-fe/core'

/** manual：人工确认等待中（OS 已为其登记在途并占用设备，但设备尚未动作）。 */
export type GanttBarKind = 'actual' | 'running' | 'manual' | 'planned'

export interface GanttBar {
  readonly id: string
  readonly kind: GanttBarKind
  readonly taskId: string
  readonly nodeId: string
  /** 调度器作业身份；计划条没有作业。 */
  readonly jobId?: string
  readonly deviceId: string
  /** 条上显示的文字（人工确认条带前缀）。 */
  readonly label: string
  /** 节点名称（不带前缀），用于提示。 */
  readonly nodeName: string
  /** 绝对时间（秒，服务端时钟）。 */
  readonly start: number
  readonly end: number
  /** running：派发起点 + 估时，可能早于“现在”（已超预计）。 */
  readonly estimatedEnd?: number
  /** running：当前计划对该在途节点的固定区间（仅展示，不改变实际区间）。 */
  readonly plannedStart?: number
  readonly plannedEnd?: number
  /** actual：调度器结算状态；running/planned 为空。 */
  readonly state?: string
  readonly parametersFinal?: boolean
  /** true：区间仍在进行（运行中或待人工确认），end 是“现在”。 */
  readonly open?: boolean
}

/** 泳道内的条带：row 是同一设备上时间重叠时分配的子行（0 起）。 */
export interface PlacedGanttBar extends GanttBar {
  readonly row: number
}

export interface GanttLane {
  /** 泳道身份：同一设备的本地 ID 与物料 UUID 归并为同一键。 */
  readonly deviceId: string
  /** 该泳道中出现过的原始设备身份。 */
  readonly deviceIds: readonly string[]
  /** 中文显示名；OS 未提供时为设备身份。 */
  readonly name: string
  readonly nameKnown: boolean
  readonly rows: number
  readonly bars: readonly PlacedGanttBar[]
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

/** 同一设备上最多拆出的子行数；更多重叠时叠放在最后一行。 */
export const MAX_LANE_ROWS = 4

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
  /**
   * 人工确认的批准时刻（秒，来自作业 manual_confirmation.decided_at）。批准后作业执行种类
   * 变为设备动作，但调度器的在途区间从登记时开始，包含人的等待，需要拆开画。
   */
  readonly manualDecidedAt?: (taskId: string, nodeId: string) => number | undefined
  /** 设备显示名目录（OS 设备读模型与展示元数据）；缺省时泳道显示设备身份。 */
  readonly devices?: Pick<DeviceNameDirectory, 'resolve'>
}): ScheduleGantt {
  const label = input.label ?? ((_task: string, _node: string, fallback: string) => fallback)
  const { candidate, problem, transient } = currentCandidate(input.plan)
  const fixedPlan = new Map<string, { start: number; end: number }>()
  for (const node of candidate?.nodes ?? []) {
    if (!node.fixed) continue
    fixedPlan.set(`${node.taskId}|${node.nodeId}`, {
      start: candidate!.timeOrigin + node.startMs / 1000,
      end: candidate!.timeOrigin + node.endMs / 1000,
    })
  }
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
    const base = {
      taskId: entry.taskId,
      nodeId: entry.nodeId,
      jobId: entry.jobId,
      deviceId,
      nodeName: name,
    }
    if (entry.endedAt == null) {
      runningKeys.add(`${entry.taskId}|${entry.nodeId}`)
      if (input.executorKind?.(entry.taskId, entry.nodeId) === 'manual_confirm') {
        // 调度器把人工确认节点登记为在途并占用设备，但未派发给设备；不预测人的等待时长。
        bars.push({
          ...base,
          id: entry.jobId,
          kind: 'manual',
          label: `待人工确认：${name}`,
          start: entry.startedAt,
          end: Math.max(entry.startedAt, input.now),
          open: true,
        })
        continue
      }
      const planned = fixedPlan.get(`${entry.taskId}|${entry.nodeId}`)
      bars.push({
        ...base,
        id: entry.jobId,
        kind: 'running',
        label: name,
        start: entry.startedAt,
        end: Math.max(entry.startedAt, input.now),
        open: true,
        estimatedEnd: entry.startedAt + entry.estimatedS,
        ...(planned ? { plannedStart: planned.start, plannedEnd: planned.end } : {}),
      })
    } else if (input.executorKind?.(entry.taskId, entry.nodeId) === 'manual_confirm') {
      // 人工确认节点的区间包含人的等待时间，不是设备动作耗时。
      bars.push({
        ...base,
        id: entry.jobId,
        kind: 'manual',
        label: `人工确认（含等待）：${name}`,
        start: entry.startedAt,
        end: Math.max(entry.startedAt, entry.endedAt),
        state: entry.state,
      })
    } else {
      const decidedAt = input.manualDecidedAt?.(entry.taskId, entry.nodeId)
      let start = entry.startedAt
      if (decidedAt !== undefined && decidedAt > entry.startedAt && decidedAt < entry.endedAt) {
        bars.push({
          ...base,
          id: `${entry.jobId}:manual`,
          kind: 'manual',
          label: `人工确认等待：${name}`,
          start: entry.startedAt,
          end: decidedAt,
        })
        start = decidedAt
      }
      bars.push({
        ...base,
        id: entry.jobId,
        kind: 'actual',
        label: name,
        start,
        end: Math.max(start, entry.endedAt),
        state: entry.state,
      })
    }
  }
  if (candidate) {
    for (const node of candidate.nodes) {
      // 已在途的固定节点由实际运行条表示，不再重复画预测。
      if (node.fixed && runningKeys.has(`${node.taskId}|${node.nodeId}`)) continue
      const start = candidate.timeOrigin + node.startMs / 1000
      const end = candidate.timeOrigin + node.endMs / 1000
      // 已完全落在“现在”之前的预测区间属于过期计划片段，不画。
      if (end <= input.now) continue
      const name = label(node.taskId, node.nodeId, node.nodeId.slice(0, 8))
      bars.push({
        id: `plan:${node.taskId}:${node.nodeId}`,
        kind: 'planned',
        taskId: node.taskId,
        nodeId: node.nodeId,
        deviceId: node.deviceId,
        label: name,
        nodeName: name,
        start: Math.max(start, input.now),
        end,
        parametersFinal: node.parametersFinal,
      })
    }
  }

  const lanes = buildLanes(bars, input.devices)

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

  let range: ScheduleGantt['range'] = null
  for (const bar of bars) {
    const end = Math.max(bar.end, bar.estimatedEnd ?? bar.end)
    range = range
      ? { start: Math.min(range.start, bar.start), end: Math.max(range.end, end) }
      : { start: bar.start, end }
  }
  if (range) range = { start: range.start, end: Math.max(range.end, input.now) }
  return {
    lanes,
    tasks,
    range,
    candidate,
    candidateProblem: problem,
    candidateTransient: transient,
  }
}

const zhCollator = new Intl.Collator('zh-Hans-CN', { numeric: true })

/** 按设备归并泳道（本地 ID 与物料 UUID 视为同一设备），排序后为重叠条分配子行。 */
function buildLanes(
  bars: readonly GanttBar[],
  devices: Pick<DeviceNameDirectory, 'resolve'> | undefined,
): GanttLane[] {
  const groups = new Map<
    string,
    { name: string; known: boolean; ids: string[]; bars: GanttBar[] }
  >()
  for (const bar of bars) {
    const resolved = devices?.resolve(bar.deviceId)
    const key = resolved?.key ?? bar.deviceId
    const group = groups.get(key) ?? {
      name: resolved?.name ?? bar.deviceId,
      known: resolved?.known ?? false,
      ids: [],
      bars: [],
    }
    if (!group.ids.includes(bar.deviceId)) group.ids.push(bar.deviceId)
    group.bars.push(bar)
    groups.set(key, group)
  }
  return (
    [...groups.entries()]
      // 有中文名的设备在前（按名称拼音），OS 未提供名称的设备在后（按设备身份），顺序稳定不随数据跳动。
      .sort(
        ([keyA, a], [keyB, b]) =>
          Number(b.known) - Number(a.known) ||
          zhCollator.compare(a.name, b.name) ||
          keyA.localeCompare(keyB),
      )
      .map(([key, group]) => {
        const sorted = [...group.bars].sort((a, b) => a.start - b.start || a.end - b.end)
        const { rows, rowOf } = packLaneRows(sorted)
        return {
          deviceId: key,
          deviceIds: group.ids,
          name: group.name,
          nameKnown: group.known,
          rows,
          bars: sorted.map((bar) => ({ ...bar, row: rowOf.get(bar.id) ?? 0 })),
        }
      })
  )
}

/**
 * 区间分行：同一设备上时间重叠的条依次放入第一个空闲子行（容差 0.5 秒，首尾相接不算重叠），
 * 最多 maxRows 行，超过时放入最早空出的行。只看实际/计划区间，不看运行条的预计剩余虚线。
 */
export function packLaneRows(
  bars: readonly Pick<GanttBar, 'id' | 'start' | 'end'>[],
  maxRows = MAX_LANE_ROWS,
): { rows: number; rowOf: ReadonlyMap<string, number> } {
  const rowEnds: number[] = []
  const rowOf = new Map<string, number>()
  const ordered = [...bars].sort((a, b) => a.start - b.start || a.end - b.end)
  for (const bar of ordered) {
    let row = rowEnds.findIndex((end) => end <= bar.start + 0.5)
    if (row < 0) {
      if (rowEnds.length < maxRows) row = rowEnds.length
      else row = rowEnds.indexOf(Math.min(...rowEnds))
    }
    rowEnds[row] = Math.max(rowEnds[row] ?? bar.end, bar.end)
    rowOf.set(bar.id, row)
  }
  return { rows: Math.max(1, rowEnds.length), rowOf }
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

const SUCCESS_STATES = new Set(['succeeded', 'success', 'normal', 'finished'])

const STATE_LABELS: Readonly<Record<string, string>> = {
  succeeded: '成功',
  success: '成功',
  normal: '成功',
  finished: '已结束',
  failed: '失败',
  failure: '失败',
  error: '失败',
  canceled: '已取消',
  cancelled: '已取消',
  timeout: '超时',
  skipped: '已跳过',
  running: '运行中',
}

/** 实际执行条是否以失败、取消等非成功状态结算（调度器结算状态，不做推断）。 */
export function isUnsuccessfulBar(bar: Pick<GanttBar, 'kind' | 'state'>): boolean {
  return bar.kind === 'actual' && Boolean(bar.state) && !SUCCESS_STATES.has(bar.state!)
}

/** 条的状态文字：与图例一致，颜色之外的第二信号。 */
export function barStatusText(bar: Pick<GanttBar, 'kind' | 'state' | 'open'>): string {
  switch (bar.kind) {
    case 'planned':
      return 'OS 当前计划（预测）'
    case 'running':
      return '运行中'
    case 'manual':
      return bar.open ? '待人工确认' : '人工确认等待（已结束）'
    case 'actual': {
      const state = bar.state ?? ''
      const text = STATE_LABELS[state] ?? state
      return `实际执行${text ? ` · ${text}` : ''}`
    }
  }
}

export interface BarDetailRow {
  readonly label: string
  readonly value: string
}

/**
 * 提示与无障碍标签共用的条明细：任务、节点、设备、状态，以及计划/实际起止与时长。
 * 时间均为 OS 时间线与时间计划给出的时刻，这里只格式化，不推断状态。
 */
export function describeBar(
  bar: GanttBar,
  context: {
    readonly now: number
    readonly taskName: string
    readonly deviceName: string
  },
): BarDetailRow[] {
  const device =
    context.deviceName && context.deviceName !== bar.deviceId
      ? `${context.deviceName}（${bar.deviceId}）`
      : bar.deviceId
  const rows: BarDetailRow[] = [
    { label: '任务', value: context.taskName },
    { label: '节点', value: bar.nodeName },
    { label: '设备', value: device },
    { label: '状态', value: barStatusText(bar) },
  ]
  const span = (start: number, end: number) =>
    `${formatClock(start)} → ${formatClock(end)}（${formatSpan(end - start)}）`
  if (bar.kind === 'planned') {
    rows.push({ label: '计划', value: span(bar.start, bar.end) })
    if (bar.parametersFinal === false) {
      rows.push({ label: '说明', value: '参数待上游确认，仅展示，不具备下发资格' })
    }
    return rows
  }
  if (bar.plannedStart !== undefined && bar.plannedEnd !== undefined) {
    rows.push({ label: '计划', value: span(bar.plannedStart, bar.plannedEnd) })
  }
  if (bar.kind === 'running') {
    rows.push({
      label: '实际',
      value: `${formatClock(bar.start)} → 运行中（已 ${formatSpan(bar.end - bar.start)}）`,
    })
    if (bar.estimatedEnd !== undefined) {
      rows.push({
        label: '预计结束',
        value: `${formatClock(bar.estimatedEnd)}${bar.estimatedEnd < context.now ? '（已超预计）' : ''}`,
      })
    }
    return rows
  }
  if (bar.kind === 'manual' && bar.open) {
    rows.push({
      label: '等待',
      value: `${formatClock(bar.start)} 起（已 ${formatSpan(bar.end - bar.start)}，不预测人的等待时长）`,
    })
    return rows
  }
  rows.push({ label: '实际', value: span(bar.start, bar.end) })
  if (bar.state) rows.push({ label: '结算', value: STATE_LABELS[bar.state] ?? bar.state })
  return rows
}
