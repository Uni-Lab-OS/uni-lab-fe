import { useEffect, useState } from 'react'
import type {
  DeviceAction,
  DeviceActionTaskView,
  WorkflowActionNodeTemplate,
  WorkflowNodeJobFeedback
} from '@unilab/services'

import type { ManagedDevice } from '../../data/deviceCatalog'
import { supportsD1AS1 } from './deviceActionRun'
import { shortIdentifier } from './devicePanelFormat'
import styles from './DevicePanel.module.scss'

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
      message: '当前服务尚未启用正式单 Action Task，请在工作流中运行'
    }
  }
  if (connection !== 'connected' || !device.online) {
    return {
      kind: 'unavailable',
      message: '设备或 Edge 当前离线，恢复连接后才能运行'
    }
  }
  if (catalogLoading) {
    return { kind: 'unavailable', message: '正在读取 A1 Action 合同目录…' }
  }
  if (catalogError) {
    return { kind: 'unavailable', message: `Action 合同目录不可用：${catalogError}` }
  }
  if (!template) {
    return {
      kind: 'unavailable',
      message: 'live Action 无法唯一匹配 A1 template，请在工作流中运行'
    }
  }
  if (!supportsD1AS1(template)) {
    return {
      kind: 'unavailable',
      message: '该动作包含物料或 Site 语义，请在工作流中运行'
    }
  }
  return {
    kind: 'ready',
    message: action.isBusy
      ? '当前动作被占用；提交后由 OS durable admission 排队'
      : '参数将提交为正式 WorkflowTask / WorkflowNodeJob'
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
  if (view.status === 'running' || view.status === 'canceling') {
    return {
      kind: 'running',
      message: view.status === 'canceling'
        ? '取消正在生效，等待设备终态'
        : actionPhaseMessage(feedback) ??
          `设备正在执行 · 作业 ${view.job_status}`,
      ...projection
    }
  }
  return {
    kind: 'accepted',
    message: '任务已接受，正在等待设备',
    ...projection
  }
}

function actionPhaseMessage(
  feedback: readonly WorkflowNodeJobFeedback[]
): string | null {
  const data = [...feedback]
    .sort((left, right) => right.sequence - left.sequence)[0]?.data
  if (!data || typeof data.phase !== 'string') return null
  const position = typeof data.position === 'number' ||
    typeof data.position === 'string'
    ? ` · 位置 ${String(data.position)}`
    : ''
  const elapsed = finiteNumber(data.elapsed_s)
  const timeout = finiteNumber(data.timeout_s)
  const timing = elapsed !== null && timeout !== null
    ? ` · 已等待 ${formatSeconds(elapsed)}/${formatSeconds(timeout)}`
    : ''
  if (data.phase === 'waiting_precondition') {
    return `等待物料到位${position}${timing}`
  }
  if (data.phase === 'writing_parameters') {
    return `正在写入设备参数${position}`
  }
  if (data.phase === 'processing') {
    return `设备正在加工${position}`
  }
  if (data.phase === 'waiting_completion') {
    return `等待设备完成信号${position}${timing}`
  }
  return null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatSeconds(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} 秒`
}

export function isTerminalDeviceActionTask(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status)
}

export type DeviceActionRunState =
  | {
      kind: 'ready' | 'unavailable' | 'submitting'
      message: string
    }
  | {
      kind: 'error'
      message: string
      retryable: boolean
    }
  | {
      kind: 'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled'
      message: string
      taskUuid: string
      output?: Record<string, unknown>
      feedback?: WorkflowNodeJobFeedback[]
      error?: unknown[]
    }

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
  disabledRunLabel = '请在工作流中运行'
}: {
  state: DeviceActionRunState
  onRun: () => void
  onCancel?: (taskUuid: string) => void
  disabledRunLabel?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const ready = state.kind === 'ready' || (
    state.kind === 'error' && state.retryable
  )
  const terminal = state.kind === 'succeeded' ||
    state.kind === 'failed' ||
    state.kind === 'canceled'
  const runnable = ready || terminal
  const log = deviceActionExecutionLog(state)
  useEffect(() => {
    setCopied(false)
  }, [log])
  return (
    <>
      <div
        className={`edge-device__debug-actions is-${state.kind}`}
        role={state.kind === 'failed' ? 'alert' : 'status'}
      >
        <button
          type="button"
          className="edge-device__run-button"
          disabled={!runnable}
          onClick={onRun}
        >
          {state.kind === 'unavailable'
            ? disabledRunLabel
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
            className="edge-device__cancel-button"
            onClick={() => onCancel(state.taskUuid)}
          >
            取消任务
          </button>
        ) : null}
        <span>{state.message}</span>
      </div>
      {'taskUuid' in state ? (
        <div className="edge-device__execution" aria-live="polite">
          <div className="edge-device__execution-head">
            <span className={`edge-device__execution-state ${
              deviceActionExecutionPresentation(state.kind).tone
            }`}>
              <span aria-hidden="true" />
              {deviceActionExecutionPresentation(state.kind).label}
            </span>
            <span className={styles.executionTools}>
              <code title={state.taskUuid}>
                Task {shortIdentifier(state.taskUuid)}
              </code>
              {log ? (
                <button
                  type="button"
                  className={styles.copyButton}
                  data-copied={copied}
                  onClick={() => {
                    void navigator.clipboard.writeText(log).then(() => {
                      setCopied(true)
                    })
                  }}
                >
                  {copied ? '已复制' : '复制'}
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
    default:
      return {
        label: '等待执行',
        description: 'OS 已接受任务，等待动作调度。',
        tone: 'is-pending'
      }
  }
}
