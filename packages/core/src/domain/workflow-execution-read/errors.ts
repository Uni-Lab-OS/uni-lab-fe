export type WorkflowExecutionReadErrorCode =
  | 'INVALID_TASK_RUNTIME_RESPONSE'
  | 'INVALID_NODE_JOB_RESPONSE'
  | 'INVALID_FEEDBACK_RESPONSE'
  | 'OS_REQUEST_REJECTED'
  | 'TASK_RUNTIME_NOT_FOUND'

export class WorkflowExecutionReadError extends Error {
  constructor(
    readonly code: WorkflowExecutionReadErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowExecutionReadError'
  }
}
