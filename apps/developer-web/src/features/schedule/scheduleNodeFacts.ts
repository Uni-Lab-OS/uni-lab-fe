import type {
  TaskJobSummary,
  TaskRuntimeListItem,
  WorkflowDebugTimelineItem,
} from '@unilab-fe/core'
import { nodeKey, type ObservedTaskNodes } from '../tasks/observedTaskNodes'
import { displayNodeName, taskNodeNames } from '../tasks/taskDomain'

export { nodeKey }

/** 单个作业的执行种类与人工确认批准时刻（秒），来自 OS 作业投影。 */
export interface ScheduleJobFact {
  readonly executorKind: string
  readonly manualDecidedAt?: number
}

/** 甘特图使用的节点事实，节点级键为 nodeKey(taskId, nodeId)；全部来自 OS 投影，缺失即为空。 */
export interface ScheduleNodeFacts {
  readonly names: ReadonlyMap<string, string>
  /** 作业执行种类：区分人工确认等待与设备动作。 */
  readonly executorKinds: ReadonlyMap<string, string>
  /** 人工确认的批准时刻（秒，来自作业 manual_confirmation.decided_at）。 */
  readonly manualDecidedAt: ReadonlyMap<string, number>
  /** 按作业身份的事实，比节点级事实精确（重试后同一节点有多个作业）。 */
  readonly jobs: ReadonlyMap<string, ScheduleJobFact>
}

export const EMPTY_NODE_FACTS: ScheduleNodeFacts = {
  names: new Map(),
  executorKinds: new Map(),
  manualDecidedAt: new Map(),
  jobs: new Map(),
}

/**
 * 从任务列表收集节点事实。默认展示投影带执行计划节点与逐 Job 数组，可得到全部节点名、
 * 执行种类与人工确认批准时刻；摘要视图只列在途 Job，名称与执行种类只覆盖这些节点，
 * 已结束节点的名称来自本会话在途时见过的记录（observed）。
 */
export function collectScheduleNodeFacts(
  tasks: readonly TaskRuntimeListItem[],
  observed?: ObservedTaskNodes,
): ScheduleNodeFacts {
  const names = new Map<string, string>()
  for (const [key, name] of observed?.names ?? []) names.set(key, displayNodeName(name))
  const executorKinds = new Map<string, string>()
  const manualDecidedAt = new Map<string, number>()
  for (const task of tasks) {
    if (task.kind === 'task_runtime_summary') {
      for (const job of task.activeJobs) {
        const key = nodeKey(task.taskUuid, job.workflowNodeUuid)
        if (job.nodeName) names.set(key, displayNodeName(job.nodeName))
        executorKinds.set(key, job.executorKind)
      }
      continue
    }
    for (const [nodeId, name] of taskNodeNames(task.raw)) {
      names.set(nodeKey(task.taskUuid, nodeId), name)
    }
    for (const job of task.jobs) {
      const key = nodeKey(task.taskUuid, job.workflowNodeUuid)
      executorKinds.set(key, job.executorKind)
      const at = decidedAtSeconds(job.raw)
      if (at !== undefined) manualDecidedAt.set(key, at)
    }
  }
  return { names, executorKinds, manualDecidedAt, jobs: new Map() }
}

/** 任务详情页已读取的单个任务（时间线与全部作业），给该任务的甘特条完整命名。 */
export function detailNodeFacts(
  taskId: string,
  timeline: readonly WorkflowDebugTimelineItem[],
  jobs: readonly TaskJobSummary[],
): ScheduleNodeFacts {
  const names = new Map<string, string>()
  const executorKinds = new Map<string, string>()
  for (const item of timeline) {
    if (item.currentAttempt === false) continue
    const key = nodeKey(taskId, item.workflowNodeUuid)
    names.set(key, displayNodeName(item.nodeLabel))
    executorKinds.set(key, item.executorKind)
  }
  const jobFacts = new Map<string, ScheduleJobFact>()
  for (const job of jobs) jobFacts.set(job.jobUuid, jobFact(job.executorKind, job.raw))
  return { names, executorKinds, manualDecidedAt: new Map(), jobs: jobFacts }
}

export function jobFact(
  executorKind: string,
  raw: Readonly<Record<string, unknown>>,
): ScheduleJobFact {
  const at = decidedAtSeconds(raw)
  return at === undefined ? { executorKind } : { executorKind, manualDecidedAt: at }
}

/** 合并多份事实；后者覆盖前者。 */
export function mergeNodeFacts(
  ...sources: readonly (ScheduleNodeFacts | undefined)[]
): ScheduleNodeFacts {
  const present = sources.filter((source): source is ScheduleNodeFacts => Boolean(source))
  if (present.length === 0) return EMPTY_NODE_FACTS
  if (present.length === 1) return present[0]!
  const merge = <Value>(pick: (facts: ScheduleNodeFacts) => ReadonlyMap<string, Value>) =>
    new Map(present.flatMap((facts) => [...pick(facts)]))
  return {
    names: merge((facts) => facts.names),
    executorKinds: merge((facts) => facts.executorKinds),
    manualDecidedAt: merge((facts) => facts.manualDecidedAt),
    jobs: merge((facts) => facts.jobs),
  }
}

/** 甘特图查询：有作业身份且有该作业的事实时以它为准，否则用节点级事实。 */
export function scheduleLookups(facts: ScheduleNodeFacts) {
  const job = (jobId: string | undefined) => (jobId ? facts.jobs.get(jobId) : undefined)
  return {
    nodeName: (taskId: string, nodeId: string) => facts.names.get(nodeKey(taskId, nodeId)),
    executorKind: (taskId: string, nodeId: string, jobId?: string) => {
      const fact = job(jobId)
      return fact ? fact.executorKind : facts.executorKinds.get(nodeKey(taskId, nodeId))
    },
    manualDecidedAt: (taskId: string, nodeId: string, jobId?: string) => {
      const fact = job(jobId)
      return fact ? fact.manualDecidedAt : facts.manualDecidedAt.get(nodeKey(taskId, nodeId))
    },
  }
}

/** OS 未给出节点名时的可读占位：带节点身份前缀，便于与任务详情对照。 */
export function placeholderNodeLabel(nodeId: string): string {
  return `节点 ${nodeId.slice(0, 8)}`
}

/** OS 作业投影中人工确认的批准时刻（秒）；未批准或字段缺失时为 undefined。 */
export function decidedAtSeconds(raw: Readonly<Record<string, unknown>>): number | undefined {
  const confirmation = raw.manual_confirmation
  if (typeof confirmation !== 'object' || confirmation === null) return undefined
  const decided = (confirmation as Record<string, unknown>).decided_at
  const time = typeof decided === 'string' ? Date.parse(decided) : Number.NaN
  return Number.isFinite(time) ? time / 1000 : undefined
}
