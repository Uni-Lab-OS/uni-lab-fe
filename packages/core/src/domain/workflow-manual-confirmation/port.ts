import type { ManualConfirmationAction, WorkflowManualConfirmationDecision } from './model'

/**
 * Manual confirmation is an OS-only interface. It is deliberately separate
 * from shared task commands because approve/reject acts on a node job's
 * durable confirmation record rather than the task runtime command stream.
 */
export interface WorkflowManualConfirmationPort {
  decide(
    jobUuid: string,
    action: ManualConfirmationAction,
  ): Promise<WorkflowManualConfirmationDecision>
}
