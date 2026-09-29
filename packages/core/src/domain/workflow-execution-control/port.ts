import type {
  WorkflowTaskCommandReceipt,
  WorkflowTaskCommandRequest
} from '../workflow-execution-read/model'

export interface WorkflowExecutionControlPort {
  sendTaskCommand(
    taskUuid: string,
    request: WorkflowTaskCommandRequest
  ): Promise<WorkflowTaskCommandReceipt>
}
