import type { WorkflowExecutionReadPort } from '../workflow-execution-read/port'
import { deriveWorkflowDebugFacts } from '../workflow-execution-read/debug-facts'
import type { WorkflowRecoveryFact } from '../workflow-execution-read/model'
import type { WorkflowExecutionRecoveryPort } from './port'

/**
 * 读取型 recovery adapter。它只暴露 OS 已返回的恢复事实；没有 OS 的
 * reconciliation/release 合同时，不提供任何写操作。
 */
export class WorkflowExecutionRecoveryClient implements WorkflowExecutionRecoveryPort {
  constructor(private readonly executionRead: WorkflowExecutionReadPort) {}

  async getTaskRecovery(taskUuid: string): Promise<WorkflowRecoveryFact> {
    const [task, jobs] = await Promise.all([
      this.executionRead.getTaskDetail(taskUuid),
      this.executionRead.listTaskJobs(taskUuid),
    ])
    return deriveWorkflowDebugFacts(task, jobs).recovery
  }
}
