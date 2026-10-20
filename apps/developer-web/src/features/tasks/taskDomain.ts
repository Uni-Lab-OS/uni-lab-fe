import type {
  TaskJobSummary,
  TaskRuntimeListItem,
  WorkflowJobStatusCounts,
  WorkflowNodeJobDetail,
} from '@unilab-fe/core'
import { taskAttention } from './taskStatusPresentation'
import { taskProgress } from './taskListSource'
import {
  formatDateTime,
  normalizeStatus,
  taskDisplayName,
  workflowDisplayName,
} from '../overview/taskPresentation'

export interface TaskListRow {
  readonly task: TaskRuntimeListItem
  readonly name: string
  readonly workflowName: string
  readonly status: string
  /** 仅 OS 提供业务进度时有值；不按 Job 状态估算。 */
  readonly progress: number | null
  readonly jobCounts: WorkflowJobStatusCounts
  readonly attention: string | null
}

export function filterTaskListRows(
  rows: readonly TaskListRow[],
  keyword: string,
  status: string,
): TaskListRow[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  return rows.filter((row) => {
    const text = `${row.name} ${row.workflowName} ${row.task.taskUuid}`.toLowerCase()
    return (
      (!normalizedKeyword || text.includes(normalizedKeyword)) &&
      (status === 'all' || row.status === status)
    )
  })
}

export function toTaskListRow(task: TaskRuntimeListItem): TaskListRow {
  return {
    task,
    name: taskDisplayName(task),
    workflowName: workflowDisplayName(task),
    status: normalizeStatus(
      task.status,
      task.attentionReason,
      task.controlStatus,
      task.cleanupStatus,
    ),
    progress: taskProgress(task)?.percent ?? null,
    jobCounts: task.jobCounts,
    attention: taskAttention(task),
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
/** 冻结快照中属于 OS 人工交互命令（HumanCommands）的节点；库存命令等其他 workflow_command 不计入。 */
export function humanCommandNodeIds(raw?: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const snapshot = recordValue(raw, 'workflow_snapshot')
  const templates = recordValue(snapshot, 'node_templates')
  const nodes = recordValue(snapshot, 'nodes')
  const human = new Set<string>()
  if (!Array.isArray(templates) || !Array.isArray(nodes)) return human
  const humanTemplates = new Set(
    templates
      .map(asRecord)
      .filter((template) => stringValue(template?.class)?.endsWith(':HumanCommands'))
      .map((template) => stringValue(template?.uuid))
      .filter((uuid): uuid is string => Boolean(uuid)),
  )
  for (const item of nodes) {
    const node = asRecord(item)
    const template = stringValue(node?.workflow_node_template_uuid)
    const uuid = stringValue(node?.uuid)
    if (uuid && template && humanTemplates.has(template)) human.add(uuid)
  }
  return human
}

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
      if (uuid && name) names.set(uuid, displayNodeName(name))
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

/** 节点展示名：内置技术节点换成中文，其余原样。 */
export function displayNodeName(value: string): string {
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
