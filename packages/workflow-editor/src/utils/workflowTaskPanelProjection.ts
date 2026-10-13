import type {
  WorkflowNodeJob,
  WorkflowTask,
  WorkflowTaskCommand,
  WorkflowTaskCommandType
} from '@unilab/services'

import type {
  WorkflowTaskRuntimeSnapshot
} from '../runtime/WorkflowTaskController'

export const TERMINAL_JOB_STATUSES = new Set([
  'succeeded',
  'failed',
  'skipped',
  'canceled',
  'timeout'
])

/** 把后端作业状态投影为工作流画布节点状态。 */
export function workflowTaskDagState(
  status: WorkflowNodeJob['status'],
  materialSource: boolean,
  taskStatus: WorkflowTask['status'] | undefined
): string {
  if (materialSource) {
    if (status === 'succeeded') return 'success'
    if (
      status === 'failed' ||
      status === 'intervention_required' ||
      status === 'timeout' ||
      status === 'execution_unknown'
    ) return 'failed'
    if (status === 'canceled' || status === 'cancel_requested') {
      return 'cancelled'
    }
    if (status === 'skipped') return 'skipped'
    if (taskStatus === 'admission_blocked') return 'material_waiting'
    return 'pending'
  }
  const states: Record<WorkflowNodeJob['status'], string> = {
    pending: 'pending',
    dispatched: 'ready',
    running: 'running',
    intervention_required: 'failed',
    cancel_requested: 'running',
    execution_unknown: 'reconciling',
    succeeded: 'success',
    failed: 'failed',
    skipped: 'skipped',
    canceled: 'cancelled',
    timeout: 'failed'
  }
  return states[status]
}

/** 构建调试器工作区所需的紧凑任务元数据。 */
export function workflowTaskMetadata(
  task: WorkflowTask | null,
  command: WorkflowTaskCommand | null,
  snapshot: Pick<
    WorkflowTaskRuntimeSnapshot,
    'realtimeStatus' | 'projectionStale' | 'feedbackStale'
  >
): ReadonlyArray<{ label: string; value: string; title?: string }> {
  const metadata = task
    ? taskMetadataRecord(task.meta_data)
    : {}
  const workflowSnapshot = task
    ? taskMetadataRecord(task.workflow_snapshot)
    : {}
  const snapshotWorkflow = taskMetadataRecord(workflowSnapshot.workflow)
  const actor = firstTaskMetadataText(metadata, [
    'operator_name',
    'created_by_name',
    'actor_name',
    'operator',
    'created_by',
    'actor'
  ])
  const subject = task?.description || firstTaskMetadataText(metadata, [
    'display_name',
    'task_name',
    'name'
  ]) || firstTaskMetadataText(snapshotWorkflow, [
    'display_name',
    'name',
    'title'
  ]) || firstTaskMetadataText(workflowSnapshot, [
    'display_name',
    'name',
    'title'
  ]) || (task ? '当前工作流' : '尚未创建')
  const syncState = snapshot.projectionStale
    ? '上一版本'
    : snapshot.feedbackStale
      ? '反馈待补读'
      : {
          connecting: '正在连接',
          live: '已确认',
          reconnecting: '正在重连'
        }[snapshot.realtimeStatus]

  return [
    {
      label: '运行主体',
      value: subject,
      title: task?.description || undefined
    },
    {
      label: '执行人',
      value: actor || 'OS 未返回'
    },
    {
      label: '任务',
      value: task ? task.uuid.slice(-8) : '尚未创建',
      title: task
        ? `工作流任务 UUID：${task.uuid}；创建时间：${task.create_time}`
        : undefined
    },
    {
      label: '模式',
      value: task?.run_mode === 'step' ? '单步' : '正常'
    },
    {
      label: '命令',
      value: command
        ? `${workflowTaskCommandLabel(command.type)} · OS 已接受`
        : '无'
    },
    {
      label: '状态同步',
      value: syncState
    }
  ]
}

/** 把开放的任务元数据值收窄为可安全读取的对象。 */
function taskMetadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 从 OS 任务元数据中读取第一个非空、可识别的文本字段。 */
function firstTaskMetadataText(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * 返回任务命令的中文显示名。
 *
 * `unlock_resources`（解除任务全部锁）**仅供调试场景**的整组解锁使用，**不在
 * AGENTS.md 的生产共享 Runtime 命令白名单内**（生产白名单只有 step / pause /
 * resume / cancel）。这里补标签只为补齐类型与调试文案，不代表生产面板可下发它。
 */
function workflowTaskCommandLabel(type: WorkflowTaskCommandType): string {
  return {
    pause: '暂停',
    resume: '继续',
    step: '单步',
    cancel: '取消',
    unlock_resources: '解除任务全部锁'
  }[type]
}
