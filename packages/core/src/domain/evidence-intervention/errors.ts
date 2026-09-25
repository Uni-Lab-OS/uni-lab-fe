export type EvidenceInterventionErrorCode =
  | 'INVALID_INTERVENTION_RESPONSE'
  | 'OS_REQUEST_REJECTED'

export class EvidenceInterventionError extends Error {
  constructor(
    readonly code: EvidenceInterventionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EvidenceInterventionError'
  }
}
