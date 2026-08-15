import type {
  DeviceCardActionRun,
  DeviceCardHostActionRequest
} from '@unilab/device-card-sdk'

import type {
  DeviceActionTaskRuntimePort,
  DeviceActionTaskView
} from './deviceActionTasks'
import type { DeviceCatalogItem } from './laboratory'
import type {
  WorkflowActionNodeTemplate,
  WorkflowRuntimeInvalidationEvent,
  WorkflowRuntimePort
} from './workflow'

interface DeviceCardActionControllerPorts {
  workflow: Pick<
    WorkflowRuntimePort,
    'getWorkflowActionCatalog' | 'subscribeWorkflowRuntime'
  >
  tasks: DeviceActionTaskRuntimePort
  randomUuid?: () => string
  actionTasksSupported?: boolean
  runtimeEventsSupported?: boolean
}

interface ExecuteOptions {
  signal?: AbortSignal
}

export class DeviceCardActionController {
  private readonly randomUuid: () => string

  /**
   * 绑定工作流运行时（Workflow Runtime）、设备动作任务、能力状态和 UUID 生成端口。
   *
   * @param ports 设备单点动作所需的可替换服务端口。
   */
  constructor(private readonly ports: DeviceCardActionControllerPorts) {
    this.randomUuid = ports.randomUuid ?? (() => globalThis.crypto.randomUUID())
  }

  /**
   * 把设备卡片动作（Action）提交为正式任务并等待终态。
   *
   * @param request 设备卡片发出的动作参数和请求身份。
   * @param device 当前设备目录投影。
   * @param options 可选取消信号。
   * @returns 兼容设备卡片的执行结果；错误被投影为 ERROR/CANCELLED。
   * @throws 不向调用方抛出业务错误；内部失败统一转为结果对象。
   */
  async execute(
    request: DeviceCardHostActionRequest,
    device: DeviceCatalogItem,
    options: ExecuteOptions = {}
  ): Promise<DeviceCardActionRun> {
    // `taskUuid` 是服务端接受后用于补读和事件筛选的任务稳定身份。
    let taskUuid = ''
    // `retryTimer/retryDelay` 只控制权威 REST 补读，不产生新的物理执行尝试。
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    let retryDelay = 1_000
    let terminalResolve: ((task: DeviceActionTaskView) => void) | undefined
    let terminalReject: ((error: Error) => void) | undefined
    let refreshQueue = Promise.resolve()
    let disposed = false

    const terminal = new Promise<DeviceActionTaskView>((resolve, reject) => {
      terminalResolve = resolve
      terminalReject = reject
    })
    const clearRetry = (): void => {
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer)
      retryTimer = null
    }
    const scheduleReadRetry = (): void => {
      if (disposed || retryTimer !== null || !taskUuid) return
      retryTimer = globalThis.setTimeout(() => {
        retryTimer = null
        queueRefresh()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, 30_000)
    }
    const refresh = async (): Promise<void> => {
      if (disposed || !taskUuid) return
      try {
        const current = await this.ports.tasks.getDeviceActionTask(taskUuid)
        retryDelay = 1_000
        clearRetry()
        if (isTerminalActionTask(current.status)) terminalResolve?.(current)
        else scheduleReadRetry()
      } catch {
        // 补读失败不是设备动作失败；保持 SSE 等待并仅重试 REST rehydrate。
        scheduleReadRetry()
      }
    }
    const queueRefresh = (): void => {
      refreshQueue = refreshQueue.then(refresh, refresh)
    }
    let subscription = { dispose: (): void => undefined }
    if (this.ports.runtimeEventsSupported !== false) {
      try {
        subscription = this.ports.workflow.subscribeWorkflowRuntime(
          (event) => {
            if (runtimeEventTaskUuid(event) === taskUuid) queueRefresh()
          },
          {
            onOpen: ({ reconnected }) => {
              if (reconnected && taskUuid) queueRefresh()
            }
          }
        )
      } catch {
        // 实时事件不可用时继续使用 REST 补读；任务终态仍由 Backend 权威确认。
      }
    }
    const abort = (): void => terminalReject?.(
      new Error('设备卡片已退出 Live，停止等待 Action Task。')
    )
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      if (options.signal?.aborted) throw new Error('设备卡片 Action 已取消。')
      if (this.ports.actionTasksSupported === false) {
        throw new Error('当前后端不支持设备单点 Action Task。')
      }
      assertRunnableDeviceAction(request, device)
      const action = device.actions.find(
        (candidate) => candidate.actionName === request.action
      )!
      const catalog = await this.ports.workflow.getWorkflowActionCatalog()
      const matches = catalog.actionTemplates.filter((template) =>
        template.name === action.actionName &&
        template.actionType === action.typeName &&
        (
          device.resourceTemplateUuid === undefined ||
          template.resourceTemplateUuid === device.resourceTemplateUuid
        )
      )
      if (matches.length !== 1) {
        throw new Error(
          matches.length === 0
            ? `Action 缺少可执行模板：${request.action}`
            : `Action 匹配到多个模板：${request.action}`
        )
      }
      const template = matches[0]!
      if (!supportsDeviceCardSingleAction(template)) {
        throw new Error('Action 包含物料或 Site 语义，请在工作流中运行。')
      }
      const accepted = await this.ports.tasks.createDeviceActionTask({
        material_uuid: device.materialUuid,
        workflow_node_template_uuid: template.uuid,
        param: request.params,
        execution_policy: {},
        idempotency_key: this.randomUuid(),
        description: '设备卡片单动作运行',
        meta_data: {
          source: 'device-card',
          device_id: request.deviceId,
          action_name: request.action
        }
      })
      taskUuid = accepted.task_uuid
      const finished = isTerminalActionTask(accepted.status)
        ? accepted
        : await (queueRefresh(), terminal)
      return projectActionRun(request, finished)
    } catch (error) {
      return {
        requestId: request.requestId,
        action: request.action,
        status: options.signal?.aborted ? 'CANCELLED' : 'ERROR',
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      disposed = true
      clearRetry()
      options.signal?.removeEventListener('abort', abort)
      subscription.dispose()
    }
  }
}

/**
 * 判断动作模板是否可由设备卡片安全直接执行。
 *
 * @param template 已校验的动作节点模板。
 * @returns 不含物料占位符（ResourceSlot）、库位（Site）或隐式传递时为 true。
 */
export function supportsDeviceCardSingleAction(
  template: WorkflowActionNodeTemplate
): boolean {
  return template.handles.every((handle) =>
    handle.editorControl !== 'material_port' &&
    handle.editorControl !== 'site_selector' &&
    !handle.implicitPassthrough &&
    !containsUnsupportedContract(handle.valueSchema)
  ) && !containsUnsupportedContract(template.schema)
}

/** 校验设备与动作请求；参数是请求和设备投影，无返回值，绑定、在线状态或声明不一致时抛错。 */
function assertRunnableDeviceAction(
  request: DeviceCardHostActionRequest,
  device: DeviceCatalogItem
): void {
  if (device.deviceId !== request.deviceId) {
    throw new Error(`设备绑定已变化：${request.deviceId}`)
  }
  if (!device.online) throw new Error(`设备已离线：${request.deviceId}`)
  if (!device.materialUuid) {
    throw new Error('当前设备缺少运行标识，请刷新设备列表后重试。')
  }
  if (!device.actions.some((action) => action.actionName === request.action)) {
    throw new Error(`设备未声明 Action：${request.action}`)
  }
}

/** 从受支持的运行失效事件中提取工作流任务（WorkflowTask）UUID。 */
function runtimeEventTaskUuid(
  event: WorkflowRuntimeInvalidationEvent
): string | null {
  if (event.event === 'workflow.runtime.changed') {
    return event.data.workflow_task_uuid
  }
  if (event.event === 'device_action_task.changed') return event.data.task_uuid
  return null
}

/** 投影动作任务结果；参数是原请求和任务视图，返回设备卡片结果，不主动抛错。 */
function projectActionRun(
  request: DeviceCardHostActionRequest,
  task: DeviceActionTaskView
): DeviceCardActionRun {
  return {
    requestId: request.requestId,
    action: request.action,
    status: mapActionStatus(task.status),
    result: ({
      taskUuid: task.task_uuid,
      jobUuid: task.job_uuid,
      status: task.status,
      output: task.output
    }) as DeviceCardActionRun['result'],
    error: actionTaskError(task)
  }
}

/** 判断动作任务终态；参数是 wire 状态，返回是否终止，不主动抛错。 */
function isTerminalActionTask(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status)
}

/** 投影动作任务错误；参数是任务视图，返回用户可读错误或 undefined，不主动抛错。 */
function actionTaskError(task: DeviceActionTaskView): string | undefined {
  if (task.status === 'succeeded') return undefined
  if (task.status === 'canceled') return '设备动作已取消。'
  if (task.status === 'timeout') return '设备动作执行超时。'
  if (task.status !== 'failed') return undefined
  const detail = task.error_info
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .filter(Boolean)
    .join('\n')
  return detail || '设备动作执行失败。'
}

/** 映射任务状态；参数是服务端 wire 状态，返回设备卡片状态，不主动抛错。 */
function mapActionStatus(status: string): DeviceCardActionRun['status'] {
  if (status === 'succeeded') return 'DONE'
  if (status === 'failed') return 'ERROR'
  if (status === 'canceled') return 'CANCELLED'
  if (status === 'timeout') return 'TIMEOUT'
  if (status === 'running') return 'RUNNING'
  return 'ACCEPTED'
}

/** 递归检查不支持的物料或库位合同；参数是 schema 值，返回是否命中，不主动抛错。 */
function containsUnsupportedContract(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsupportedContract)
  if (!value || typeof value !== 'object') return value === 'ResourceSlot'
  const record = value as Record<string, unknown>
  if (
    record.$slot === 'ResourceSlot' ||
    record.editor_control === 'material_port' ||
    record.editor_control === 'site_selector' ||
    record.implicit_passthrough === true
  ) return true
  return Object.values(record).some(containsUnsupportedContract)
}
