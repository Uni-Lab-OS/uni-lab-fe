import type {
  TaskJobSummary,
  TaskRuntimePresentation,
  WorkflowNodeJobDetail,
} from '@unilab-fe/core'
import {
  formatDateTime,
  normalizeStatus,
  taskDisplayName,
  workflowDisplayName,
} from '../overview/taskPresentation'

export interface TaskListRow {
  readonly task: TaskRuntimePresentation
  readonly name: string
  readonly workflowName: string
  readonly status: string
  readonly progress: number | null
  readonly completedJobs: number
  readonly totalJobs: number
}

export function toTaskListRow(task: TaskRuntimePresentation): TaskListRow {
  const totalJobs = task.progress?.total ?? task.jobs.length
  const completedJobs = task.progress?.completed ?? 0
  return {
    task,
    name: taskDisplayName(task),
    workflowName: workflowDisplayName(task),
    status: normalizeStatus(task.status, task.attentionReason),
    progress:
      task.progress?.percent ?? (totalJobs ? Math.round((completedJobs / totalJobs) * 100) : null),
    completedJobs,
    totalJobs,
  }
}

export function jobStatus(job: TaskJobSummary | WorkflowNodeJobDetail): string {
  return normalizeStatus(job.status)
}

export function jobLabel(
  job: TaskJobSummary | WorkflowNodeJobDetail,
  index: number,
  nodeNames?: ReadonlyMap<string, string>,
): string {
  const nodeName = nodeNames?.get(job.workflowNodeUuid)
  if (nodeName) return nodeName
  const executorLabels: Record<string, string> = {
    workflow_input: '工作流输入',
    workflow_output: '工作流输出',
    material_transfer: '物料转运',
    transfer_material_atomic: '原子物料搬运',
  }
  return executorLabels[job.executorKind] ?? `节点 ${index + 1}`
}

/** 从任务冻结快照提取节点显示名称，避免把内部 UUID 暴露给操作员。 */
export function taskNodeNames(
  raw?: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const sources = [
    recordValue(recordValue(raw, 'workflow_snapshot'), 'nodes'),
    recordValue(recordValue(raw, 'execution_plan'), 'nodes'),
  ]
  for (const source of sources) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      const node = asRecord(item)
      const uuid = stringValue(node?.uuid)
      const name =
        stringValue(node?.name) ?? stringValue(node?.display_name) ?? stringValue(node?.action_name)
      if (uuid && name) names.set(uuid, technicalNodeLabel(name))
    }
  }
  return names
}

export interface TimelineItem {
  readonly id: string
  readonly label: string
  readonly status: string
  readonly start: number | null
  readonly end: number | null
  readonly duration: string
}

export function toTimelineItems(jobs: readonly WorkflowNodeJobDetail[]): TimelineItem[] {
  return jobs.map((job, index) => {
    const rawStartedAt = stringValue(job.raw.started_at) ?? stringValue(job.raw.create_time)
    const rawFinishedAt = stringValue(job.raw.finished_at)
    const startedAt = job.startedAt ?? rawStartedAt
    const finishedAt = job.finishedAt ?? rawFinishedAt
    const start = startedAt ? Date.parse(startedAt) : null
    const end = finishedAt
      ? Date.parse(finishedAt)
      : start != null && ['running', 'dispatched', 'pending'].includes(job.status)
        ? Date.now()
        : null
    const duration =
      start != null && end != null && end >= start
        ? `${Math.max(1, Math.round((end - start) / 1000))} 秒`
        : '时间未提供'
    return {
      id: job.jobUuid,
      label: job.workflowNodeUuid || `节点 ${index + 1}`,
      status: jobStatus(job),
      start,
      end,
      duration,
    }
  })
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)?.[key]
}

function technicalNodeLabel(value: string): string {
  return (
    {
      transfer_material_atomic: '原子物料搬运',
      workflow_input: '工作流输入',
      workflow_output: '工作流输出',
    }[value] ?? value
  )
}

export function displayTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : '未提供'
}

export function resourceEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    typeof item === 'string' ? item : JSON.stringify(item),
  ])
}
