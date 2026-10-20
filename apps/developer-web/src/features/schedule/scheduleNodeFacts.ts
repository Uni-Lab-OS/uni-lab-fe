import type { TaskRuntimeListItem } from '@unilab-fe/core'
import { displayNodeName, taskNodeNames } from '../tasks/taskDomain'

/** 甘特图使用的节点事实，键为 nodeKey(taskId, nodeId)；全部来自 OS 投影，缺失即为空。 */
export interface ScheduleNodeFacts {
  readonly names: ReadonlyMap<string, string>
  /** 作业执行种类：区分人工确认等待与设备动作。 */
  readonly executorKinds: ReadonlyMap<string, string>
  /** 人工确认的批准时刻（秒，来自作业 manual_confirmation.decided_at）。 */
  readonly manualDecidedAt: ReadonlyMap<string, number>
}

export function nodeKey(taskId: string, nodeId: string): string {
  return `${taskId}|${nodeId}`
}

/**
 * 从任务列表收集节点事实。默认展示投影带执行计划节点与逐 Job 数组，可得到全部节点名、
 * 执行种类与人工确认批准时刻；摘要视图只列在途 Job，名称与执行种类只覆盖这些节点。
 */
export function collectScheduleNodeFacts(tasks: readonly TaskRuntimeListItem[]): ScheduleNodeFacts {
  const names = new Map<string, string>()
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
  return { names, executorKinds, manualDecidedAt }
}

/** OS 作业投影中人工确认的批准时刻（秒）；未批准或字段缺失时为 undefined。 */
export function decidedAtSeconds(raw: Readonly<Record<string, unknown>>): number | undefined {
  const confirmation = raw.manual_confirmation
  if (typeof confirmation !== 'object' || confirmation === null) return undefined
  const decided = (confirmation as Record<string, unknown>).decided_at
  const time = typeof decided === 'string' ? Date.parse(decided) : Number.NaN
  return Number.isFinite(time) ? time / 1000 : undefined
}
