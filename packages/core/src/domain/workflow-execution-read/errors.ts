export type WorkflowExecutionReadErrorCode =
  | 'INVALID_TASK_RUNTIME_RESPONSE'
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

