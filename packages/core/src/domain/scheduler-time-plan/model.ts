/**
 * OS 调度器的时间排程与实际执行时间线（GET /api/v1/scheduler/time-plan、GET /api/v1/timeline）。
 * 计划时间是预测，不是执行授权；预计结束不代表实际完成或资源释放。
 */

/** 候选的完成语义；information 只表示已知信息前缀，不代表整个 Task 完成。 */
export type TimePlanCompletionKind = 'task_completion' | 'information' | 'partial_scope'

export interface TimePlanNode {
  /** 调度器中的工作流运行身份（Task）与节点身份。 */
  readonly taskId: string
  readonly nodeId: string
  readonly deviceId: string
  readonly startMs: number
  readonly endMs: number
  /** 已开始的动作不会被移动或打断。 */
  readonly fixed: boolean
  /** false：参数尚未由真实上游确认，仅供展示，不具备下发资格。 */
  readonly parametersFinal: boolean
}

export interface TimePlanCompletionTarget {
  readonly taskId: string
  readonly nodeKeys: readonly (readonly [string, string])[]
  readonly kind: TimePlanCompletionKind
}

export interface TimePlanCandidate {
  readonly revision: string
  /** 绝对时间原点（秒）；绝对预测起点 = timeOrigin + startMs / 1000。 */
  readonly timeOrigin: number
  /** OPTIMAL / FEASIBLE / UNKNOWN / ERROR / INFEASIBLE / MODEL_INVALID */
  readonly status: string
  readonly validated: boolean
  readonly error: string
  readonly nodes: readonly TimePlanNode[]
  readonly completionTargets: readonly TimePlanCompletionTarget[]
  readonly partialTasks: readonly string[]
}

export interface TimePlanSnapshot {
  readonly kind: 'scheduler_time_plan'
  readonly source: 'os'
  /** false：调度器未接时间排程，使用“就绪即派发”的稳定排序（algorithm 说明）。 */
  readonly enabled: boolean
  readonly algorithm: string
  readonly activeSolves: number
  readonly inputError: string
  readonly inputRevision: string
  readonly partialTasks: readonly string[]
  /** 尚不能排程的节点及原因（if 未决、人工确认、参数待定等）。 */
  readonly blocked: readonly {
    readonly taskId: string
    readonly nodeId: string
    readonly reason: string
  }[]
  readonly latest: TimePlanCandidate | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface SchedulerTimelineEntry {
  readonly jobId: string
  readonly taskId: string
  readonly nodeId: string
  readonly deviceId: string
  readonly actionName: string
  readonly deviceActionKey: string
  /** 调度器派发时刻（秒）；不是设备 ACK 或物理开始。 */
  readonly startedAt: number
  /** 观察到结果的时刻（秒）；运行中为 null。 */
  readonly endedAt: number | null
  readonly estimatedS: number
  readonly estimateSource: string
  readonly actualS: number | null
  /** 运行中为 running；完成后为调度器结算状态。 */
  readonly state: string
}

export interface SchedulerTimeline {
  readonly kind: 'scheduler_timeline'
  readonly source: 'os'
  /** 服务端当前时刻（秒），用于对齐“现在”线，避免客户端时钟偏差。 */
  readonly now: number
  readonly entries: readonly SchedulerTimelineEntry[]
  readonly estimator: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * 结构性“时间待定”原因：节点还没到可规划的时候（前面有分支/人工确认/循环未定），属正常等待。
 * 其余原因（如“动作耗时尚无可用估计”）表示 OS 无法为已就绪的节点排程，节点会一直不派发，
 * 必须显式提示，不能和正常等待混在一起。
 */
export const STRUCTURAL_BLOCK_REASONS: ReadonlySet<string> = new Set([
  'human_confirmation_required',
  'condition_unresolved',
  'loop_tail_unknown',
])

/** 原因串形如 condition_unresolved:<节点>;loop_tail_unknown:<节点>，逐段取类型。 */
export function blockReasonKinds(reason: string): string[] {
  return [
    ...new Set(
      reason
        .split(';')
        .map((part) => part.split(':')[0]!.trim())
        .filter(Boolean),
    ),
  ]
}

/** 无法排程（非结构性原因）的节点；传入 taskId 时只看该任务。 */
export function stalledPlanNodes(
  plan: TimePlanSnapshot | null,
  taskId?: string,
): TimePlanSnapshot['blocked'] {
  if (!plan) return []
  return plan.blocked.filter(
    (item) =>
      (taskId === undefined || item.taskId === taskId) &&
      blockReasonKinds(item.reason).some((kind) => !STRUCTURAL_BLOCK_REASONS.has(kind)),
  )
}

/**
 * 只保留持续出现的无法排程节点。部分原因（如连续资源区间交接）在派发间隙短暂出现又消失，
 * 不能当作停住提示。firstSeen 由调用方跨次读取保存：本次出现且首次出现已超过 minAgeMs 才返回。
 */
export function persistentStalls(
  stalls: TimePlanSnapshot['blocked'],
  firstSeen: Map<string, number>,
  now: number,
  minAgeMs: number,
): TimePlanSnapshot['blocked'] {
  const present = new Set<string>()
  const result: TimePlanSnapshot['blocked'][number][] = []
  for (const stall of stalls) {
    const key = `${stall.taskId}|${stall.nodeId}|${stall.reason}`
    present.add(key)
    const since = firstSeen.get(key) ?? now
    firstSeen.set(key, since)
    if (now - since >= minAgeMs) result.push(stall)
  }
  for (const key of [...firstSeen.keys()]) if (!present.has(key)) firstSeen.delete(key)
  return result
}
