import { useEffect, useState } from 'react'
import type {
  DeviceAction,
  DeviceActionTaskView,
  WorkflowActionNodeTemplate,
  WorkflowNodeJobFeedback
} from '@unilab/services'

import type { ManagedDevice } from './deviceCatalog'
import {
  projectDeviceActionInputSchema,
  supportsD1AS1
} from './deviceActionRun'
import { shortIdentifier } from './devicePanelFormat'
import { deviceClass } from './deviceStyles'
import styles from './DevicePanel.module.scss'

/**
 * 计算设备单动作调试（D1A）的前端就绪性，不把按钮可点击误当作调度准入。
 *
 * @param input 动作、设备、模板、连接和目录读取状态。
 * @returns 可运行状态或带稳定原因的关闭状态。
 * @safety 参数合同、设备身份或物料/库位边界无法证明安全时关闭失败。
 */
export function deviceActionReadiness({
  action,
  device,
  template,
  canRunActionTask,
  connection,
  catalogLoading,
  catalogError
}: {
  action: DeviceAction
  device: ManagedDevice
  template: WorkflowActionNodeTemplate | null
  canRunActionTask: boolean
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  catalogLoading: boolean
  catalogError: string | null
}): DeviceActionRunState {
  if (!canRunActionTask) {
    return {
      kind: 'unavailable',
      reason: 'workflow_required',
      message: '当前环境暂不支持单动作运行，请在工作流中运行'
    }
  }
  if (connection !== 'connected' || !device.online) {
    return {
      kind: 'unavailable',
      reason: 'device_offline',
      message: '设备或 Edge 当前离线，恢复连接后才能运行'
    }
  }
  if (!device.materialUuid) {
    return {
      kind: 'unavailable',
      reason: 'device_identity_missing',
      message: '当前设备缺少运行标识，请刷新设备列表后重试'
    }
  }
  if (catalogLoading) {
    return {
      kind: 'unavailable',
      reason: 'catalog_loading',
      message: '正在读取设备动作信息…'
    }
  }
  if (catalogError) {
    return {
      kind: 'unavailable',
      reason: 'catalog_error',
      message: '无法读取该动作的运行信息，请刷新后重试；如果仍失败，请检查 Edge 连接'
    }
  }
  if (!template) {
    return {
      kind: 'unavailable',
      reason: 'template_unmatched',
      message: '没有找到与当前设备动作匹配的运行信息，请刷新后重试'
    }
  }
  if (!supportsD1AS1(template)) {
    return {
      kind: 'unavailable',
      reason: 'workflow_required',
      message: '该动作会影响物料或库位，请在工作流中运行'
    }
  }
  if (projectDeviceActionInputSchema(template) === null) {
    return {
      kind: 'unavailable',
      reason: 'contract_invalid',
      message: '动作参数合同不完整，请刷新动作目录或检查动作模板'
    }
  }
  return {
    kind: 'ready',
    message: action.isBusy
      ? '当前动作被占用；提交后由调度器（Scheduler）按权威占用状态处理'
      : '参数将提交为正式工作流任务（WorkflowTask）和作业（Job）'
  }
}

export function projectDeviceActionTask(
  view: DeviceActionTaskView,
  feedback: WorkflowNodeJobFeedback[]
): DeviceActionRunState {
  const projection = {
    taskUuid: view.task_uuid,
    output: view.output,
    feedback,
    error: view.error_info
  }
  if (view.status === 'succeeded') {
    return { kind: 'succeeded', message: '动作执行完成', ...projection }
  }
  if (view.status === 'failed' || view.status === 'timeout') {
    return {
      kind: 'failed',
      message: view.status === 'timeout' ? '动作执行超时' : '动作执行失败',
      ...projection
    }
  }
  if (view.status === 'canceled') {
    return { kind: 'canceled', message: '动作任务已取消', ...projection }
  }
  if (view.job_status === 'succeeded') {
    return {
      kind: 'finishing',
      message: '设备动作已完成，OS 正在确认收尾',
      ...projection
    }
  }
  if (view.status === 'running' || view.status === 'canceling') {
    const feedbackMessage = latestFeedbackMessage(feedback)
    return {
      kind: 'running',
      message: view.status === 'canceling'
        ? '取消正在生效，等待设备终态'
        : feedbackMessage ?? `设备正在执行 · Job ${view.job_status}`,
      ...projection
    }
  }
  return {
    kind: 'accepted',
    message: '任务已接受，正在等待设备',
    ...projection
  }
}

function latestFeedbackMessage(
  feedback: WorkflowNodeJobFeedback[]
): string | null {
  for (let index = feedback.length - 1; index >= 0; index -= 1) {
    const item = feedback[index]
    if (!item) continue
    for (const value of [item.data.message, item.data.description]) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    if (item.description?.trim()) return item.description.trim()
  }
  return null
}

export function isTerminalDeviceActionTask(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status)
}

export type DeviceActionRunState =
  | {
      kind: 'ready' | 'submitting'
      message: string
    }
  | {
      kind: 'unavailable'
      reason: DeviceActionUnavailableReason
      message: string
    }
  | {
      kind: 'error'
      message: string
      retryable: boolean
    }
  | {
      kind: 'accepted' | 'running' | 'finishing' | 'succeeded' | 'failed' | 'canceled'
      message: string
      taskUuid: string
      output?: Record<string, unknown>
      feedback?: WorkflowNodeJobFeedback[]
      error?: unknown[]
    }

/**
 * 读取仍需恢复的设备单动作任务（WorkflowTask）稳定 UUID。
 *
 * @param operation 当前动作引用与运行状态；尚未创建任务时可为空。
 * @returns 等待、运行或收尾任务 UUID；其他状态返回 null。
 */
export function activeDeviceActionTaskUuid(operation: {
  actionRef: string
  state: DeviceActionRunState
} | null): string | null {
  if (!operation || !('taskUuid' in operation.state)) return null
  return ['accepted', 'running', 'finishing'].includes(operation.state.kind)
    ? operation.state.taskUuid
    : null
}

/** 单动作入口关闭时的稳定原因，用于避免把基础设施错误误报成工作流约束。 */
export type DeviceActionUnavailableReason =
  | 'workflow_required'
  | 'device_offline'
  | 'device_identity_missing'
  | 'catalog_loading'
  | 'catalog_error'
  | 'template_unmatched'
  | 'contract_invalid'
  | 'no_actions'

/**
 * 吸收零动作设备禁用按钮理论上不可达的点击。
 *
 * @returns 无返回值。
 * @throws 不抛出异常。
 * @safety 不访问服务、不修改状态，也不创建动作任务。
 */
export function ignoreUnavailableDeviceActionRun(): void {}

/**
 * 展示单动作任务的可用性、运行控制与执行日志。
 *
 * @param props.state 当前动作任务运行状态。
 * @param props.onRun 可运行时创建动作任务的回调。
 * @param props.onCancel 运行中取消动作任务的可选回调。
 * @param props.disabledRunLabel 不可运行时保留在禁用按钮上的场景文案。
 * @returns 动作任务控制区及存在任务时的执行日志。
 * @throws 不主动抛出异常；回调错误由调用方处理。
 * @safety 不可运行状态始终禁用按钮，避免误创建任务。
 */
export function DeviceActionAvailability({
  state,
  onRun,
  onCancel,
  disabledRunLabel
}: {
  state: DeviceActionRunState
  onRun: () => void
  onCancel?: (taskUuid: string) => void
  disabledRunLabel?: string
}): React.JSX.Element {
  const [logCopied, setLogCopied] = useState(false)
  const [taskIdCopied, setTaskIdCopied] = useState(false)
  const ready = state.kind === 'ready' || (
    state.kind === 'error' && state.retryable
  )
  const terminal = state.kind === 'succeeded' ||
    state.kind === 'failed' ||
    state.kind === 'canceled'
  const runnable = ready || terminal
  const log = deviceActionExecutionLog(state)
  const taskUuid = 'taskUuid' in state ? state.taskUuid : null
  useEffect(() => {
    setLogCopied(false)
  }, [log])
  useEffect(() => {
    setTaskIdCopied(false)
  }, [taskUuid])
  return (
    <>
      <div
        className={deviceClass('edge-device__debug-actions', `is-${state.kind}`)}
        role={state.kind === 'failed' || state.kind === 'error' ? 'alert' : 'status'}
      >
        <button
          type="button"
          className={deviceClass('edge-device__run-button')}
          disabled={!runnable}
          onClick={onRun}
        >
          {state.kind === 'unavailable'
            ? disabledRunLabel ?? unavailableRunLabel(state.reason)
            : state.kind === 'submitting'
              ? '正在创建正式任务…'
              : state.kind === 'error' && state.retryable
                ? '重试同一请求'
                : terminal
                  ? '再次运行'
                  : '运行此动作'}
        </button>
        {'taskUuid' in state &&
        (state.kind === 'accepted' || state.kind === 'running') &&
        onCancel ? (
          <button
            type="button"
            className={deviceClass('edge-device__cancel-button')}
            onClick={() => onCancel(state.taskUuid)}
          >
            取消任务
          </button>
        ) : null}
        <span>{userFacingActionMessage(state.message)}</span>
      </div>
      {'taskUuid' in state ? (
        <div className={deviceClass('edge-device__execution')} aria-live="polite">
          <div className={deviceClass('edge-device__execution-head')}>
            <span className={deviceClass('edge-device__execution-state', deviceActionExecutionPresentation(state.kind).tone)}>
              <span aria-hidden="true" />
              {deviceActionExecutionPresentation(state.kind).label}
            </span>
            <span className={styles.executionTools}>
              <button
                type="button"
                className={styles.taskIdButton}
                data-copied={taskIdCopied}
                title={taskIdCopied ? 'Task ID 已复制' : `复制完整 Task ID：${state.taskUuid}`}
                aria-label={taskIdCopied ? 'Task ID 已复制' : '复制完整 Task ID'}
                onClick={() => {
                  void copyDeviceActionTaskId(state.taskUuid).then(() => {
                    setTaskIdCopied(true)
                  })
                }}
              >
                <code>
                  {taskIdCopied ? 'Task ID 已复制' : `Task ${shortIdentifier(state.taskUuid)}`}
                </code>
              </button>
              {log ? (
                <button
                  type="button"
                  className={styles.copyButton}
                  data-copied={logCopied}
                  onClick={() => {
                    void navigator.clipboard.writeText(log).then(() => {
                      setLogCopied(true)
                    })
                  }}
                >
                  {logCopied ? '已复制' : '复制'}
                </button>
              ) : null}
            </span>
          </div>
          {log ? (
            <pre aria-label="Action 运行日志">{log}</pre>
          ) : (
            <p>{deviceActionExecutionPresentation(state.kind).description}</p>
          )}
        </div>
      ) : null}
    </>
  )
}

/** 将完整动作任务 UUID 写入剪贴板，不复制界面上的缩略文本。 */
export function copyDeviceActionTaskId(
  taskUuid: string,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard
): Promise<void> {
  return clipboard.writeText(taskUuid)
}

/** 把旧版本或上游错误中的内部术语转换为用户可理解的动作信息。 */
function userFacingActionMessage(message: string): string {
  return message
    .replaceAll(/ ?Action 合同目录/gu, '设备动作信息')
    .replaceAll('动作合同目录', '设备动作信息')
    .replaceAll(/ ?Action 权威合同/gu, '动作运行信息')
    .replaceAll(/ ?Action 合同/gu, '设备动作信息')
    .replaceAll('动作合同', '动作信息')
    .replaceAll('合同', '信息')
}

/** 把关闭原因投影为按钮短文案，详细诊断仍由相邻状态文本承载。 */
function unavailableRunLabel(reason: DeviceActionUnavailableReason): string {
  switch (reason) {
    case 'workflow_required':
      return '请在工作流中运行'
    case 'device_offline':
      return '设备离线'
    case 'device_identity_missing':
      return '暂时无法运行'
    case 'catalog_loading':
      return '正在读取动作信息…'
    case 'catalog_error':
      return '暂时无法运行'
    case 'template_unmatched':
      return '暂时无法运行'
    case 'contract_invalid':
      return '参数合同不可用'
    case 'no_actions':
      return '运行此动作'
  }
}

function deviceActionExecutionLog(state: DeviceActionRunState): string {
  if (!('taskUuid' in state)) return ''
  const projection: Record<string, unknown> = {}
  if (state.feedback?.length) {
    projection.events = state.feedback.map((item) => ({
      sequence: item.sequence,
      type: item.feedback_type,
      data: item.data,
      observed_at: item.observed_at
    }))
  }
  if (state.output && Object.keys(state.output).length > 0) {
    projection.result = state.output
  }
  if (state.error?.length) projection.error = state.error
  return Object.keys(projection).length > 0
    ? JSON.stringify(projection, null, 2)
    : ''
}

function deviceActionExecutionPresentation(kind: DeviceActionRunState['kind']): {
  label: string
  description: string
  tone: string
} {
  switch (kind) {
    case 'succeeded':
      return {
        label: '执行成功',
        description: '动作已由 OS 确认为成功。',
        tone: 'is-success'
      }
    case 'failed':
      return {
        label: '执行失败',
        description: 'OS 报告动作执行失败，请检查设备日志。',
        tone: 'is-danger'
      }
    case 'canceled':
      return {
        label: '已停止',
        description: 'OS 已确认动作停止。',
        tone: 'is-muted'
      }
    case 'running':
      return {
        label: '执行中',
        description: '动作已进入设备执行队列。',
        tone: 'is-running'
      }
    case 'finishing':
      return {
        label: '正在收尾',
        description: '设备动作已完成，OS 正在确认任务与库存终态。',
        tone: 'is-running'
      }
    default:
      return {
        label: '等待执行',
        description: 'OS 已接受任务，等待动作调度。',
        tone: 'is-pending'
      }
  }
}
