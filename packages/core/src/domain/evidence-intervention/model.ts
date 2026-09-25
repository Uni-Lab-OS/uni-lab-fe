export type WorkflowInterventionStatus = 'open' | 'selected' | 'superseded'
export type WorkflowInterventionDeliveryStatus = 'none' | 'pending' | 'accepted' | 'unknown'

export interface WorkflowInterventionOption {
  readonly id: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface WorkflowIntervention {
  readonly kind: 'workflow_intervention'
  readonly source: 'os' | 'fixture'
  readonly interventionUuid: string
  readonly workflowTaskUuid: string
  readonly workflowNodeJobUuid: string
  readonly edgeCommandUuid: string | null
  readonly revision: number
  readonly status: WorkflowInterventionStatus
  readonly options: readonly WorkflowInterventionOption[]
  readonly resumeControlStatus: string
  readonly selectedOptionId: string | null
  readonly selectedOption: Readonly<Record<string, unknown>>
  readonly deliveryStatus: WorkflowInterventionDeliveryStatus
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly openedAt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly decidedAt: string | null
  readonly deliveredAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}
