import type { WorkflowRecoveryFact } from '../workflow-execution-read/model'

/**
 * OS-only recovery seam. 具体的 reconciliation / lock release 合同冻结前，Core
 * 只保留读取边界，页面不得根据锁字段自行推导释放资格。
 */
export interface WorkflowExecutionRecoveryPort {
  getTaskRecovery(taskUuid: string): Promise<WorkflowRecoveryFact>
}
