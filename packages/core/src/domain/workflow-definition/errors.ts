export type WorkflowDefinitionErrorCode =
  | 'INVALID_WORKFLOW_DEFINITION'
  | 'WORKFLOW_NOT_PUBLISHED'
  | 'UNSUPPORTED_WORKFLOW_TYPE'
  | 'WORKFLOW_IDENTITY_DRIFT'
  | 'WORKFLOW_REVISION_DRIFT'

export class WorkflowDefinitionError extends Error {
  readonly code: WorkflowDefinitionErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: WorkflowDefinitionErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message)
    this.name = 'WorkflowDefinitionError'
    this.code = code
    this.details = details
  }
}
