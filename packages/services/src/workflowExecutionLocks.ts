import type { WorkflowTaskCommand } from './workflowTaskContracts'

/** 服务端当前锁事实；can_release 仅代表旧的单租约释放资格。 */
export interface WorkflowTaskExecutionLock {
  uuid: string
  workflow_task_uuid: string
  workflow_node_job_uuid: string
  claim_uuid: string
  lock_key: string
  material_uuid: string | null
  site_uuid: string | null
  scope: string
  state: string
  fencing_token: number
  job_status: string
  claim_state: string
  can_release: boolean
  release_block_reason: string | null
}

export interface WorkflowTaskExecutionLocks {
  workflow_task_uuid: string
  task_status: string
  locks: WorkflowTaskExecutionLock[]
  active_device_tenancy_count: number
}

export interface WorkflowTaskResourceUnlockRequest {
  idempotency_key: string
  reason: string
  physical_safe_confirmed: boolean
}

export interface WorkflowTaskResourceUnlockCommand
  extends Omit<WorkflowTaskCommand, 'type'> {
  type: 'unlock_resources'
}

/** 释放整个异常终态任务的所有资源；不改变任务失败事实或物料位置。 */
export interface WorkflowExecutionLockPort {
  list: (taskUuid: string) => Promise<WorkflowTaskExecutionLocks>
  unlockResources: (
    taskUuid: string,
    request: WorkflowTaskResourceUnlockRequest
  ) => Promise<WorkflowTaskResourceUnlockCommand>
}
