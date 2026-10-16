import type {
  SchedulerTimeline,
  SchedulerTimelineEntry,
  TimePlanCandidate,
  TimePlanCompletionKind,
  TimePlanCompletionTarget,
  TimePlanSnapshot,
} from './model'

export class SchedulerTimePlanDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchedulerTimePlanDecodeError'
  }
}

const KINDS: readonly TimePlanCompletionKind[] = ['task_completion', 'information', 'partial_scope']

/** 解析时间计划；结构不合法时抛错，不拿残缺数据画预测条。 */
export function decodeTimePlan(value: unknown): TimePlanSnapshot {
  const raw = record(value, 'time-plan')
  if (typeof raw.enabled !== 'boolean') fail('时间计划缺少启用状态')
  const input = raw.input === undefined ? {} : record(raw.input, 'time-plan.input')
  const blocked = list(input.blocked ?? [], 'time-plan.input.blocked').map((item) => {
    const fields = strings(item, 'blocked')
    if (fields.length !== 3) fail('时间计划待定原因缺少节点身份')
    return { taskId: fields[0]!, nodeId: fields[1]!, reason: fields[2]! }
  })
  return {
    kind: 'scheduler_time_plan',
    source: 'os',
    enabled: raw.enabled,
    algorithm: text(raw.algorithm, 'algorithm'),
    activeSolves: raw.active_solves === undefined ? 0 : finite(raw.active_solves, 'active_solves'),
    inputError: raw.input_error === undefined ? '' : text(raw.input_error, 'input_error'),
    inputRevision: input.revision === undefined ? '' : text(input.revision, 'input.revision'),
    partialTasks:
      input.partial_tasks === undefined ? [] : strings(input.partial_tasks, 'partial_tasks'),
    blocked,
    latest: raw.latest == null ? null : decodeCandidate(raw.latest),
    raw,
  }
}

function decodeCandidate(value: unknown): TimePlanCandidate {
  const latest = record(value, 'time-plan.latest')
  if (typeof latest.validated !== 'boolean') fail('时间候选缺少验证状态')
  return {
    revision: text(latest.revision, 'latest.revision'),
    timeOrigin: finite(latest.time_origin, 'latest.time_origin'),
    status: text(latest.status, 'latest.status'),
    validated: latest.validated,
    error: latest.error === undefined ? '' : text(latest.error, 'latest.error'),
    partialTasks:
      latest.partial_tasks === undefined
        ? []
        : strings(latest.partial_tasks, 'latest.partial_tasks'),
    completionTargets: completionTargets(latest.completion_targets),
    nodes: list(latest.nodes, 'latest.nodes').map((item) => {
      const node = record(item, 'latest.nodes[]')
      const key = strings(node.key, 'node.key')
      const startMs = finite(node.start_ms, 'node.start_ms')
      const endMs = finite(node.end_ms, 'node.end_ms')
      const parametersFinal = node.parameters_final === undefined ? true : node.parameters_final
      if (
        key.length !== 2 ||
        startMs < 0 ||
        endMs < startMs ||
        typeof node.fixed !== 'boolean' ||
        typeof parametersFinal !== 'boolean'
      ) {
        fail('候选节点身份或时间区间无效')
      }
      return {
        taskId: key[0]!,
        nodeId: key[1]!,
        deviceId: text(node.device_id, 'node.device_id'),
        startMs,
        endMs,
        fixed: node.fixed as boolean,
        parametersFinal: parametersFinal as boolean,
      }
    }),
  }
}

function completionTargets(value: unknown): TimePlanCompletionTarget[] {
  if (value === undefined) return []
  return list(value, 'completion_targets').map((item) => {
    const target = record(item, 'completion_target')
    const kind =
      target.kind === undefined ? 'task_completion' : text(target.kind, 'completion_target.kind')
    if (!KINDS.includes(kind as TimePlanCompletionKind)) fail('时间计划完成目标类型无效')
    return {
      taskId: text(target.task_id, 'completion_target.task_id'),
      nodeKeys: list(target.node_keys ?? [], 'node_keys').map((key) => {
        const fields = strings(key, 'node_key')
        if (fields.length !== 2) fail('时间计划完成目标节点身份无效')
        return [fields[0]!, fields[1]!] as const
      }),
      kind: kind as TimePlanCompletionKind,
    }
  })
}

/** 解析 /timeline：running 与窗口内 completed 合并为同一列表。 */
export function decodeSchedulerTimeline(value: unknown): SchedulerTimeline {
  const raw = record(value, 'timeline')
  const running = list(raw.running ?? [], 'timeline.running').map((item) => entry(item, true))
  const completed = list(raw.completed ?? [], 'timeline.completed').map((item) =>
    entry(item, false),
  )
  return {
    kind: 'scheduler_timeline',
    source: 'os',
    now: finite(raw.now, 'timeline.now'),
    entries: [...completed, ...running],
    estimator:
      raw.estimator && typeof raw.estimator === 'object'
        ? (raw.estimator as Record<string, unknown>)
        : {},
    raw,
  }
}

function entry(value: unknown, running: boolean): SchedulerTimelineEntry {
  const item = record(value, 'timeline entry')
  return {
    jobId: text(item.job_id, 'job_id'),
    taskId: text(item.workflow_id, 'workflow_id'),
    nodeId: text(item.node_id, 'node_id'),
    deviceId: typeof item.device_id === 'string' ? item.device_id : '',
    actionName: typeof item.action_name === 'string' ? item.action_name : '',
    deviceActionKey: typeof item.device_action_key === 'string' ? item.device_action_key : '',
    startedAt: finite(item.started_at, 'started_at'),
    endedAt: running ? null : finite(item.ended_at, 'ended_at'),
    estimatedS: typeof item.estimated_s === 'number' ? item.estimated_s : 0,
    estimateSource: typeof item.estimate_source === 'string' ? item.estimate_source : '',
    actualS: running ? null : typeof item.actual_s === 'number' ? item.actual_s : null,
    state: running ? 'running' : typeof item.state === 'string' ? item.state : 'finished',
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} 格式无效`)
  return value as Record<string, unknown>
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} 不是数组`)
  return value as unknown[]
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} 不是有效时间`)
  return value as number
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} 缺失`)
  return value as string
}

function strings(value: unknown, field: string): string[] {
  const values = list(value, field)
  if (values.some((item) => typeof item !== 'string')) fail(`${field} 不是字符串数组`)
  return values as string[]
}

function fail(message: string): never {
  throw new SchedulerTimePlanDecodeError(message)
}
