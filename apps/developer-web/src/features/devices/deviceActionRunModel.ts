import type { DeviceActionRunView } from '@unilab-fe/core'

/**
 * 单动作运行阶段：把 OS Task/Job 状态归为操作员可理解的几层。
 * “已受理”只表示 OS 接收了请求；只有 Job 终态才能说明动作结果（见现场 11.14）。
 */
export type DeviceActionRunPhase =
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'canceling'
  | 'canceled'

export interface DeviceActionRunState {
  readonly phase: DeviceActionRunPhase
  readonly label: string
  readonly detail: string
  /** true 时停止轮询；结果未知与取消中仍需人工核对，但不再自动刷新。 */
  readonly settled: boolean
  readonly tone: 'info' | 'success' | 'error' | 'warning'
}

const LABELS: Record<DeviceActionRunPhase, string> = {
  accepted: '已受理，等待派发',
  running: '执行中',
  succeeded: '已完成',
  failed: '执行失败',
  unknown: '结果未知，需现场核对',
  canceling: '取消已受理，等待设备停止回执',
  canceled: '已取消',
}

export function deviceActionRunState(view: DeviceActionRunView): DeviceActionRunState {
  const { task, job } = view
  const attention = task.attentionReason ?? ''
  // OS 对结果未知的作业可能仍保持 running/failed，只以 uncertainty_reason 标记待物理对账。
  const uncertain =
    typeof job.raw.uncertainty_reason === 'string' && job.raw.uncertainty_reason !== ''
  const phase = runPhase(task.status, task.controlStatus, job.status, attention, uncertain)
  const detail =
    phase === 'unknown'
      ? '设备可能已动作但未确认终态，该设备暂停接收新动作。请到现场确认设备状态，不要直接重发；在任务页打开该节点，填写核对结论后按“已取消”收尾。'
      : phase === 'canceling'
        ? `取消请求已被 OS 受理，但尚未收到设备停止回执${attention ? `（${attention}）` : ''}。不要重复提交取消。`
        : phase === 'accepted'
          ? waitText(job.waitReason)
          : ''
  return {
    phase,
    label: LABELS[phase],
    detail,
    settled: ['succeeded', 'failed', 'unknown', 'canceled', 'canceling'].includes(phase),
    tone:
      phase === 'succeeded'
        ? 'success'
        : phase === 'failed'
          ? 'error'
          : phase === 'unknown' || phase === 'canceling'
            ? 'warning'
            : 'info',
  }
}

function runPhase(
  taskStatus: string,
  controlStatus: string,
  jobStatus: string,
  attention: string,
  uncertain: boolean,
): DeviceActionRunPhase {
  if (jobStatus === 'succeeded') return 'succeeded'
  if (jobStatus === 'execution_unknown' || attention.includes('unknown') || uncertain) {
    return controlStatus === 'canceling' || taskStatus === 'canceling' ? 'canceling' : 'unknown'
  }
  if (controlStatus === 'canceling' || taskStatus === 'canceling') return 'canceling'
  if (jobStatus === 'failed' || jobStatus === 'timeout') return 'failed'
  if (jobStatus === 'canceled' || taskStatus === 'canceled' || taskStatus === 'cancelled')
    return 'canceled'
  if (taskStatus === 'failed') return 'failed'
  if (jobStatus === 'running' || jobStatus === 'dispatched') return 'running'
  return 'accepted'
}

function waitText(waitReason: Readonly<Record<string, unknown>>): string {
  const message = waitReason.wait_message ?? waitReason.message
  return typeof message === 'string' && message.trim() ? `等待原因：${message}` : ''
}

export interface DeviceActionErrorEntry {
  readonly code: string
  readonly message: string
  readonly detail: string
}

/** 读取 Job error_info；设备包透传的 ptlc_* 代码附带协议状态与 PLC 错误码。 */
export function deviceActionErrors(view: DeviceActionRunView): readonly DeviceActionErrorEntry[] {
  return view.job.errorInfo.map((item) => {
    const record =
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}
    const code = typeof record.code === 'string' ? record.code : ''
    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof item === 'string'
          ? item
          : JSON.stringify(item)
    const extras = [
      typeof record.protocol_status === 'string' ? `协议状态 ${record.protocol_status}` : '',
      typeof record.protocol_error_code === 'number'
        ? `PLC 错误码 ${record.protocol_error_code}`
        : '',
    ].filter(Boolean)
    return { code: ERROR_TITLES[code] ?? code, message, detail: extras.join('，') }
  })
}

const ERROR_TITLES: Record<string, string> = {
  ptlc_action_rejected: '设备拒绝执行',
  ptlc_device_offline: '设备离线',
  ptlc_action_failed: '执行异常',
  ptlc_action_canceled: '已取消',
  legacy_edge_scheduler_action_failed: '设备动作执行失败',
}

export function deviceActionReturnInfo(
  view: DeviceActionRunView,
): Readonly<Record<string, unknown>> | undefined {
  const value = view.job.raw.return_info
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
