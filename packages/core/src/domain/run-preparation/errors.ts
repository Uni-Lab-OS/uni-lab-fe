export type RunPreparationErrorCode =
  | 'INVALID_RUN_PREPARATION_RESPONSE'
  | 'UNMAPPED_RESOURCE_SELECTION'
  | 'RUN_NOT_ACCEPTED'

export class RunPreparationError extends Error {
  readonly code: RunPreparationErrorCode

  constructor(code: RunPreparationErrorCode, message: string) {
    super(message)
    this.name = 'RunPreparationError'
    this.code = code
  }
}
