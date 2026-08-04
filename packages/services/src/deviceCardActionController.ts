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
}

interface ExecuteOptions {
  signal?: AbortSignal
}

export class DeviceCardActionController {
  private readonly randomUuid: () => string

  constructor(private readonly ports: DeviceCardActionControllerPorts) {
    this.randomUuid = ports.randomUuid ?? (() => globalThis.crypto.randomUUID())
  }

  async execute(
    request: DeviceCardHostActionRequest,
    device: DeviceCatalogItem,
    options: ExecuteOptions = {}
  ): Promise<DeviceCardActionRun> {
    let taskUuid = ''
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
      } catch {
        // 补读失败不是设备动作失败；保持 SSE 等待并仅重试 REST rehydrate。
        scheduleReadRetry()
      }
    }
    const queueRefresh = (): void => {
      refreshQueue = refreshQueue.then(refresh, refresh)
    }
    const subscription = this.ports.workflow.subscribeWorkflowRuntime(
      (event) => {
        if (
          event.event === 'device_action_task.changed' &&
          event.data.task_uuid === taskUuid
        ) queueRefresh()
      },
      {
        onOpen: ({ reconnected }) => {
          if (reconnected && taskUuid) queueRefresh()
        }
      }
    )
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
        template.actionType === action.typeName
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
        authority_id: catalog.authorityId,
        template_catalog_fingerprint: catalog.fingerprint,
        workflow_node_template_uuid: template.uuid,
        device_id: request.deviceId,
        input: request.params,
        idempotency_key: this.randomUuid(),
        description: '设备卡片单动作运行'
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

function assertRunnableDeviceAction(
  request: DeviceCardHostActionRequest,
  device: DeviceCatalogItem
): void {
  if (device.deviceId !== request.deviceId) {
    throw new Error(`设备绑定已变化：${request.deviceId}`)
  }
  if (!device.online) throw new Error(`设备已离线：${request.deviceId}`)
  if (!device.actions.some((action) => action.actionName === request.action)) {
    throw new Error(`设备未声明 Action：${request.action}`)
  }
}

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

function isTerminalActionTask(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status)
}

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

function mapActionStatus(status: string): DeviceCardActionRun['status'] {
  if (status === 'succeeded') return 'DONE'
  if (status === 'failed') return 'ERROR'
  if (status === 'canceled') return 'CANCELLED'
  if (status === 'timeout') return 'TIMEOUT'
  if (status === 'running') return 'RUNNING'
  return 'ACCEPTED'
}

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
