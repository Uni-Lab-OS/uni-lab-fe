import type {
  WorkflowTask,
  WorkflowTaskCommandType
} from '@unilab/services'

import type { WorkflowRuntimeControl } from '../components/WorkflowDebugger'

const TERMINAL_TASK_STATUSES = new Set<WorkflowTask['status']>([
  'succeeded',
  'failed',
  'canceled',
  'timeout'
])

/** 工作流任务是否仍占用当前调试控制入口。 */
export function workflowTaskIsLive(task: WorkflowTask | null): boolean {
  return Boolean(task && !TERMINAL_TASK_STATUSES.has(task.status))
}

/**
 * 常规调试器只显示当前状态有意义的命令，而不是同时铺开全部按钮。
 */
export function workflowTaskToolbarControls(
  task: WorkflowTask | null,
  controls: ReadonlyArray<WorkflowRuntimeControl<WorkflowTaskCommandType>>
): ReadonlyArray<WorkflowRuntimeControl<WorkflowTaskCommandType>> {
  if (!workflowTaskIsLive(task)) return []

  const commands = task?.status === 'admission_blocked'
    ? new Set<WorkflowTaskCommandType>(['cancel'])
    : task?.control_status === 'waiting_intervention'
      ? new Set<WorkflowTaskCommandType>(['cancel'])
    : task?.control_status === 'paused'
    ? task.run_mode === 'step'
      ? new Set<WorkflowTaskCommandType>(['resume', 'step', 'cancel'])
      : new Set<WorkflowTaskCommandType>(['resume', 'cancel'])
    : new Set<WorkflowTaskCommandType>(['pause', 'cancel'])

  return controls.filter((control) => commands.has(control.command))
}

/**
 * 将权威工作流任务状态投影为可执行的运行控制按钮。
 *
 * @param task OS 返回的工作流任务；尚未创建时为 null。
 * @param busy 前端是否正在提交或补读上一条命令。
 * @returns 各运行命令的可用状态、提示与不可用原因。
 */
export function workflowTaskControls(
  task: WorkflowTask | null,
  busy: boolean
): ReadonlyArray<WorkflowRuntimeControl<WorkflowTaskCommandType>> {
  const terminal = !task || TERMINAL_TASK_STATUSES.has(task.status)
  const admissionBlocked = task?.status === 'admission_blocked'
  return [
    {
      command: 'pause',
      label: '暂停',
      title: '提交暂停请求；等待 OS 确认状态',
      message: 'OS 已接受暂停请求，正在补读任务状态',
      glyph: 'Ⅱ',
      disabled: busy || terminal || admissionBlocked ||
        task.control_status !== 'active',
      disabledReason: workflowTaskCommandDisabledReason(task, busy, 'pause')
    },
    {
      command: 'resume',
      label: '继续',
      title: '提交继续请求；等待 OS 确认状态',
      message: 'OS 已接受继续请求，正在补读任务状态',
      glyph: '▶',
      primary: true,
      disabled: busy || terminal || admissionBlocked ||
        task.control_status !== 'paused',
      disabledReason: workflowTaskCommandDisabledReason(task, busy, 'resume')
    },
    {
      command: 'step',
      label: '单步',
      title: '仅单步模式且任务已暂停时执行一步',
      message: 'OS 已接受单步请求，正在补读节点任务与工作流任务状态',
      glyph: '→',
      disabled: busy || terminal || admissionBlocked ||
        task.run_mode !== 'step' || task.control_status !== 'paused',
      disabledReason: workflowTaskCommandDisabledReason(task, busy, 'step')
    },
    {
      command: 'cancel',
      label: '取消',
      title: '提交取消请求；等待工作流任务与节点任务结束',
      message: 'OS 已接受取消请求，正在补读工作流任务与节点任务状态',
      glyph: '■',
      danger: true,
      disabled: busy || terminal,
      disabledReason: workflowTaskCommandDisabledReason(task, busy, 'cancel')
    }
  ]
}

/**
 * 解释运行控制命令在当前任务状态下为何不可提交。
 *
 * @param task OS 返回的工作流任务；尚未创建时为 null。
 * @param busy 是否正在处理上一条命令。
 * @param command 待解释的工作流任务命令。
 * @returns 面向操作者的具体不可点击原因。
 */
function workflowTaskCommandDisabledReason(
  task: WorkflowTask | null,
  busy: boolean,
  command: WorkflowTaskCommandType
): string {
  if (busy) return '正在处理上一条运行控制命令，请等待 OS 回读状态'
  if (!task) return '尚未创建工作流任务'
  if (TERMINAL_TASK_STATUSES.has(task.status)) {
    return '工作流任务已经结束，不能再提交运行控制命令'
  }
  if (task.status === 'admission_blocked') {
    return '任务正在等待物料准入，当前不能提交运行控制命令'
  }
  if (task.control_status === 'waiting_intervention') {
    return '任务正在等待人工干预，当前只能取消'
  }
  if (command === 'pause') return '只有正在执行的任务可以暂停'
  if (command === 'resume') return '只有已经暂停的任务可以继续'
  if (command === 'step' && task.run_mode !== 'step') {
    return '当前任务不是单步模式'
  }
  if (command === 'step') return '只有已经暂停的单步任务可以执行下一步'
  return '当前任务状态不允许取消'
}

export function workflowTaskVisualStatus(task: WorkflowTask | null): string {
  if (!task) return 'disabled'
  if (task.status === 'succeeded') return 'completed'
  if (task.status === 'canceled') return 'cancelled'
  if (task.status === 'failed' || task.status === 'timeout') return 'failed'
  if (task.status === 'admission_blocked') return 'admission_blocked'
  if (task.control_status === 'paused') return 'paused'
  if (task.control_status === 'waiting_intervention') {
    return 'intervention_required'
  }
  if (task.control_status === 'waiting_reconciliation') return 'reconciling'
  return task.status
}

export function workflowTaskControlStatusLabel(
  task: WorkflowTask | null
): string {
  if (!task) return '未创建任务'
  if (TERMINAL_TASK_STATUSES.has(task.status)) return '执行已结束'
  if (task.status === 'admission_blocked') return '等待物料准入'
  return {
    active: '控制可用',
    paused: '已暂停',
    waiting_intervention: '等待人工干预',
    waiting_reconciliation: '等待状态核对'
  }[task.control_status]
}

export function workflowTaskStatusLabel(
  status: WorkflowTask['status'] | undefined
): string {
  if (!status) return '未开始'
  return {
    pending: '等待执行',
    admission_blocked: '等待物料准入',
    running: '运行中',
    canceling: '正在取消',
    succeeded: '执行成功',
    failed: '执行失败',
    canceled: '已取消',
    timeout: '执行超时'
  }[status]
}
