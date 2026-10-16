import type { RequestTransport } from '../../transport/request'
import type { WorkflowExecutionReadPort } from '../workflow-execution-read/port'
import { deriveWorkflowDebugFacts } from '../workflow-execution-read/debug-facts'
import type { WorkflowRecoveryFact } from '../workflow-execution-read/model'
import type {
  TaskExecutionLocks,
  TaskResourceUnlockReceipt,
  UncertainJobResolutionReceipt,
  WorkflowExecutionRecoveryPort,
} from './port'

/**
 * Recovery adapter：读取只暴露 OS 已返回的恢复事实；写入只有 OS 的
 * resolve-uncertain 合同，回执受理不等于作业已结算。
 */
export class WorkflowExecutionRecoveryClient implements WorkflowExecutionRecoveryPort {
  constructor(
    private readonly executionRead: WorkflowExecutionReadPort,
    private readonly transport: RequestTransport | null = null,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async getTaskRecovery(taskUuid: string): Promise<WorkflowRecoveryFact> {
    const [task, jobs] = await Promise.all([
      this.executionRead.getTaskDetail(taskUuid),
      this.executionRead.listTaskJobs(taskUuid),
    ])
    return deriveWorkflowDebugFacts(task, jobs).recovery
  }

  async resolveUncertainJob(
    jobUuid: string,
    reason: string,
  ): Promise<UncertainJobResolutionReceipt> {
    const normalized = reason.trim()
    if (!normalized) throw new Error('请填写现场核对结论')
    if (!this.transport) throw new Error('当前装配未提供恢复写入通道')
    const response = await this.transport.request<unknown>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-node-jobs/${encodeURIComponent(jobUuid)}/resolve-uncertain`,
      body: { resolution: 'canceled', reason: normalized },
    })
    const raw = asRecord(response.data) ?? {}
    const data = asRecord(raw.data) ?? raw
    return {
      kind: 'uncertain_job_resolution',
      source: 'os',
      jobUuid,
      resolutionCommandUuid:
        typeof data.resolution_command_uuid === 'string' ? data.resolution_command_uuid : null,
      pendingEdgeConfirmation: data.pending_edge_confirmation === true,
      created: data.created === true,
      raw: data,
    }
  }

  async listTaskExecutionLocks(taskUuid: string): Promise<TaskExecutionLocks> {
    if (!this.transport) throw new Error('当前装配未提供恢复读取通道')
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/execution-locks`,
    })
    const raw = asRecord(response.data) ?? {}
    const data = asRecord(raw.data) ?? raw
    const locks = Array.isArray(data.locks) ? data.locks : []
    return {
      taskStatus: text(data.task_status),
      activeDeviceTenancyCount:
        typeof data.active_device_tenancy_count === 'number' ? data.active_device_tenancy_count : 0,
      locks: locks.flatMap((item) => {
        const lock = asRecord(item)
        if (!lock || typeof lock.uuid !== 'string') return []
        return [
          {
            uuid: lock.uuid,
            lockKey: text(lock.lock_key),
            scope: text(lock.scope),
            state: text(lock.state),
            jobUuid: text(lock.workflow_node_job_uuid),
            jobStatus: text(lock.job_status),
            canRelease: lock.can_release === true,
            releaseBlockReason:
              typeof lock.release_block_reason === 'string' ? lock.release_block_reason : null,
          },
        ]
      }),
    }
  }

  async unlockTaskResources(
    taskUuid: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<TaskResourceUnlockReceipt> {
    const normalized = reason.trim()
    if (!normalized) throw new Error('请填写现场处置说明')
    if (!this.transport) throw new Error('当前装配未提供恢复写入通道')
    const response = await this.transport.request<unknown>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/commands`,
      body: {
        type: 'unlock_resources',
        idempotency_key: idempotencyKey,
        description: normalized,
        meta_data: { confirmed_physical_safe: true },
      },
    })
    const raw = asRecord(response.data) ?? {}
    const data = asRecord(raw.data) ?? raw
    const result = asRecord(data.result) ?? {}
    const status = text(data.status)
    return {
      kind: 'task_resource_unlock',
      commandUuid: typeof data.uuid === 'string' ? data.uuid : null,
      status,
      rejectReason: status === 'rejected' ? text(result.reason) || '未说明原因' : null,
      result,
    }
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}
