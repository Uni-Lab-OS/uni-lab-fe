export type ManualConfirmationAction = 'approve' | 'reject'

/** OS-only decision receipt for a pending manual confirmation node job. */
export interface WorkflowManualConfirmationDecision {
  readonly kind: 'workflow_manual_confirmation_decision'
  readonly source: 'os'
  readonly jobUuid: string
  readonly action: ManualConfirmationAction
  readonly raw: Readonly<Record<string, unknown>>
}
