import type { BackendConfig } from './backends'
import type { HttpClient } from './http'
import { ServiceError } from './errors'
import { strictRuntimeData } from './workflowRuntimeCodec'
import { createWorkflowSseSubscription, type WorkflowSseTransport } from './workflowSse'
import type { WorkflowEventSubscription, WorkflowNodeJob, WorkflowTask } from './workflowTaskContracts'
import type {
  StationSnapshot, HandlingIntent, HandlingCommand, ManualDeviceAction,
  HandlingInventory, ResourceOccupancy, ManualActionJob, HistoricalManualReviewContext,
  ExecutionLockSnapshot
} from './workflowRecoveryContracts'

export interface WorkflowRecoveryPort {
  scopeKey: string
  loadStation: () => Promise<StationSnapshot>
  loadCommand: (id: string) => Promise<HandlingCommand>
  forceReleaseLock: (task: string, lease: string, body: Record<string, unknown>) => Promise<{ status: string; released_lock_uuids?: string[] }>
  submit: (intent: HandlingIntent) => Promise<HandlingCommand>
  loadActions: (session: string, device: string) => Promise<ManualDeviceAction[]>
  loadDevices: () => Promise<Array<{ id: string; name: string }>>
  loadInventory: (session: string) => Promise<HandlingInventory>
  loadOccupancies: () => Promise<ResourceOccupancy[]>
  loadManualAction: (id: string) => Promise<{ execution_job: ManualActionJob }>
  loadReview: (job: string) => Promise<HistoricalManualReviewContext>
  loadLocks: (task: string) => Promise<ExecutionLockSnapshot>
  /** 独立于普通 step/pause/resume/cancel 的 OS-only 恢复写操作。 */
  recoverJob: (job: string, operation: 'review' | 'settle-material-transfer', body: Record<string, unknown>, key: string) => Promise<unknown>
  unlockTask: (task: string, reason: string, key: string) => Promise<{ status: 'pending' | 'succeeded' | 'rejected'; result?: { reason?: string } }>
  confirmNode: (job: string, action: 'approve' | 'reject') => Promise<{ task: WorkflowTask; jobs: WorkflowNodeJob[] }>
  subscribe: (refresh: () => void, onError: (error: Error) => void) => WorkflowEventSubscription
}

/** 只有有明确 HTTP 拒绝证据时才能丢弃原请求；超时和 5xx 需保留幂等身份。 */
export function recoveryRequestDefinitive(error: unknown): boolean {
  return error instanceof ServiceError && error.status !== undefined &&
    error.status >= 400 && error.status < 500 && error.status !== 408
}

export function createWorkflowRecoveryPort(
  http: HttpClient, backend: BackendConfig, transport: WorkflowSseTransport,
  subscriptions: Set<WorkflowEventSubscription>
): WorkflowRecoveryPort {
  const read = async <T>(path: string, init?: RequestInit): Promise<T> =>
    strictRuntimeData<T>(await http.request(path, init))
  const write = <T>(path: string, body: unknown, key?: string): Promise<T> => read(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body)
  })
  const allPages = async <T>(path: string): Promise<T[]> => {
    const items: T[] = []
    for (let page = 1; page <= 100; page++) {
      const result = await read<{ items: T[]; total?: number; has_more?: boolean }>(`${path}?page=${page}&page_size=100`)
      if (!Array.isArray(result.items)) throw new Error('设备候选目录响应无效')
      items.push(...result.items)
      const more = result.has_more ?? (result.total !== undefined ? items.length < result.total : result.items.length >= 100)
      if (!more) return items
      if (!result.items.length) throw new Error('设备候选目录分页不完整')
    }
    throw new Error('设备候选目录超过读取上限')
  }
  const station = '/api/v1/stations/local'
  const id = encodeURIComponent
  return {
    scopeKey: JSON.stringify([backend.id, backend.apiUrl]),
    loadStation: () => read(`${station}/error-handling`),
    loadCommand: (command) => read(`${station}/control-commands/${id(command)}`),
    forceReleaseLock: async (task, lease, body) => {
      const result = await write<{ status: string; released_lock_uuids?: string[] }>(`/api/v1/workflow-tasks/${id(task)}/execution-locks/${id(lease)}/force-release`, body)
      if (!['released', 'already_released'].includes(result.status)) throw new Error('服务未确认执行锁已释放，请核对原请求结果')
      return result
    },
    submit: async (intent) => {
      // 浏览器恢复的请求不能越过工站恢复接口或改为任意 URL。
      if (!/^\/(errors\/[^/]+\/decision|sessions\/[^/]+\/(return|complete|manual-actions|inventory-corrections)|manual-actions\/[^/]+\/(stop|review)|control-commands\/[^/]+\/apply|resource-dispositions|resume)$/.test(intent.path)
        || /[?#]|\.\.|%2f/i.test(intent.path)) throw new Error('无效的工站处置操作')
      const command = await write<HandlingCommand>(`${station}${intent.path}`, intent.body, intent.key)
      if (!command || !command.command_uuid || !['PENDING', 'APPLIED', 'FAILED'].includes(command.status) || !command.result) {
        throw new Error('服务未返回可确认的处置命令状态，请按原请求继续确认')
      }
      return command
    },
    loadActions: (session, device) => read(`${station}/sessions/${id(session)}/devices/${id(device)}/actions`),
    loadDevices: async () => {
      // 与 OS 人工处置一致：选择有来源设备标识、且资源类型绑定动作模板的物料实例。
      // 几何、库位和在线状态不参与这个候选条件，无需额外读取 graph/devices。
      const [materials, templates] = await Promise.all([
        allPages<{ uuid: string; name?: string; resource_template_uuid?: string; meta_data?: { source_node_id?: string } }>('/api/v1/materials'),
        allPages<{ node_type?: string; resource_template?: { uuid?: string } }>('/api/v1/workflow-node-templates')
      ])
      const types = new Set(templates.filter((item) => !['condition', 'repeat_until'].includes(item.node_type || '')).map((item) => item.resource_template?.uuid).filter(Boolean))
      return materials.filter((item) => item.uuid && item.meta_data?.source_node_id && item.resource_template_uuid && types.has(item.resource_template_uuid))
        .map((item) => ({ id: item.uuid, name: `${item.name || item.uuid} · ${item.meta_data!.source_node_id}` }))
    },
    loadInventory: (session) => read(`${station}/sessions/${id(session)}/inventory`),
    loadOccupancies: () => read(`${station}/resource-dispositions`),
    loadManualAction: (command) => read(`${station}/manual-actions/${id(command)}`),
    loadReview: (job) => read(`${station}/manual-action-jobs/${id(job)}/review`),
    loadLocks: (task) => read(`/api/v1/workflow-tasks/${id(task)}/execution-locks`),
    recoverJob: (job, operation, body, key) => write(operation === 'review'
      ? `${station}/manual-action-jobs/${id(job)}/review`
      : `/api/v1/workflow-node-jobs/${id(job)}/settle-material-transfer`, body, key),
    unlockTask: async (task, reason, key) => {
      const command = await write<{ uuid: string; workflow_task_uuid: string; type: string; idempotency_key: string; status: 'pending' | 'succeeded' | 'rejected'; result?: { reason?: string } }>(`/api/v1/workflow-tasks/${id(task)}/commands`, {
        type: 'unlock_resources', idempotency_key: key, description: reason,
        meta_data: { source: 'unilab-workbench', confirmed_physical_safe: true }
      })
      if (!command.uuid || command.workflow_task_uuid !== task || command.type !== 'unlock_resources' || command.idempotency_key !== key || !['pending', 'succeeded', 'rejected'].includes(command.status)) {
        throw new Error('服务未返回可确认的解锁命令状态，请按原请求继续确认')
      }
      return command
    },
    confirmNode: (job, action) => write(`/api/v1/workflow-node-jobs/${id(job)}/manual-confirmation`, { action }),
    subscribe: (refresh, onError) => createWorkflowSseSubscription({
      transport, subscriptions,
      connectionErrorLabel: '异常处置事件连接失败', disconnectedMessage: '连接中断，恢复前暂停写操作',
      onOpen: refresh, onError, dedupeBeforeParse: true,
      acceptFrame: (frame) => ['station.error_handling.changed', 'workflow.runtime.changed', 'device_action_task.changed', 'manual_confirmation.required', 'manual_confirmation.resolved'].includes(frame.event),
      parseFrame: (frame) => {
        const data = JSON.parse(frame.data) as Record<string, unknown>
        if (frame.event === 'station.error_handling.changed' && data.station_id !== 'local') return null
        return frame
      },
      onEvent: refresh
    })
  }
}
