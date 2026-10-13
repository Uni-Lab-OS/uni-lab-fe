import type { TaskRuntimePresentation } from '@unilab-fe/core'

export interface TaskRow {
  readonly task: TaskRuntimePresentation
  readonly name: string
  readonly workflowName: string
  readonly description: string | null
  readonly progress: number | null
  readonly priority: string | null
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
}

export function toTaskRow(task: TaskRuntimePresentation): TaskRow {
  return {
    task,
    name: taskDisplayName(task),
    workflowName: workflowDisplayName(task),
    description:
      task.description ?? readString(task.raw, ['description', 'task_description', 'subtitle']),
    // Core 已经从 OS 的 Task presentation 统一投影进度；页面不能再次按 Job
    // 状态估算，否则会与任务列表及 OS 权威进度产生分歧。
    progress: task.progress?.percent ?? null,
    priority: task.priority,
    status: normalizeStatus(
      task.status,
      task.attentionReason,
      task.controlStatus,
      task.cleanupStatus,
    ),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

export function normalizeStatus(
  status: string,
  attentionReason: string | null = null,
  controlStatus: string | null = null,
  cleanupStatus: string | null = null,
): string {
  const normalized = status.toLowerCase()
  const normalizedControlStatus = controlStatus?.toLowerCase()
  const normalizedCleanupStatus = cleanupStatus?.toLowerCase()
  if (
    normalizedControlStatus === 'error_waiting' ||
    normalizedControlStatus === 'waiting_intervention' ||
    normalizedCleanupStatus === 'requires_attention'
  ) {
    return 'attention'
  }
  if (attentionReason && ['running', 'waiting', 'queued'].includes(normalized)) return 'attention'
  if (['pending', 'queued', 'waiting_for_resource', 'waiting'].includes(normalized))
    return 'waiting'
  if (['in_progress', 'running', 'executing'].includes(normalized)) return 'running'
  if (['succeeded', 'success', 'completed', 'finished'].includes(normalized)) return 'completed'
  if (['cancelled', 'canceled', 'failed', 'blocked', 'error'].includes(normalized))
    return normalized === 'blocked' ? 'attention' : normalized
  return normalized
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 任务的展示名。列表、总览工站区和任务详情必须给出同一个名字：
 * 解析顺序与任务详情标题保持一致（显式名 > 可读描述 > 工作流快照名 > 短 UUID）。
 */
export function taskDisplayName(task: TaskRuntimePresentation): string {
  const explicit = readString(task.raw, ['name', 'task_name', 'title'])
  if (explicit) return explicit
  // 控制台创建的任务 description 是通用占位，不能当成名字。
  const description = readString(task.raw, ['description'])
  if (description && !/^从.+创建$/.test(description)) return description
  const snapshot = asRecord(task.raw.workflow_snapshot)
  const workflow = asRecord(snapshot?.workflow)
  const workflowName = readString(workflow, ['name', 'title'])
  if (workflowName) return workflowName
  // 至少要能定位到具体任务：含糊的「未命名任务」会让工站错误区无法区分多条错误。
  return `任务 ${task.taskUuid.slice(0, 8)}`
}

export function workflowDisplayName(task: TaskRuntimePresentation): string {
  const snapshot = asRecord(task.raw.workflow_snapshot)
  const workflow = asRecord(snapshot?.workflow)
  return (
    readString(task.raw, ['workflow_name', 'workflowName']) ??
    readString(workflow, ['name', 'title']) ??
    task.workflowUuid ??
    '未关联工作流'
  )
}

/**
 * 返回总览卡片中有实际补充信息的副标题。
 * 任务接口的旧数据经常把 description 回退成任务名，不能把同一文本再展示一次。
 */
export function taskSecondaryText(
  row: Pick<TaskRow, 'name' | 'workflowName' | 'description'>,
): string | null {
  const name = row.name.trim()
  const description = row.description?.trim()
  if (description && description !== name) return description

  const workflowName = row.workflowName.trim()
  if (workflowName && workflowName !== name) return workflowName
  return null
}

function readString(
  raw: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): string | null {
  if (!raw) return null
  for (const key of keys) if (typeof raw[key] === 'string' && raw[key]) return raw[key] as string
  return null
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}
