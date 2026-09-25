import type { WorkflowIntervention } from './model'

export interface EvidenceInterventionPort {
  listInterventions(input?: {
    readonly status?: string
    readonly limit?: number
  }): Promise<readonly WorkflowIntervention[]>

  getIntervention(interventionUuid: string): Promise<WorkflowIntervention>
}
