import type { DeviceSummary } from '../../domain/device-action/model'
import type { WorkflowIntervention } from '../../domain/evidence-intervention/model'
import type {
  TaskRuntimeDetail,
  TaskRuntimePresentation,
  TaskRuntimePresentationPage,
  TaskJobSummary,
} from '../../domain/workflow-execution-read/model'

export interface LaboratoryOperationsQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly status?: string
  readonly cleanupStatus?: string
  readonly view?: string
  readonly terminalLimit?: number
  readonly interventionStatus?: string
  readonly interventionLimit?: number
}

export interface LaboratoryOperationsViewModel {
  readonly kind: 'laboratory_operations'
  readonly query: LaboratoryOperationsQuery
  readonly tasks: readonly TaskRuntimePresentation[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly devices: readonly DeviceSummary[]
  readonly interventions: readonly WorkflowIntervention[]
  readonly selectedTaskUuid: string | null
  readonly selectedTask: TaskRuntimeDetail | null
  readonly selectedJobs: readonly TaskJobSummary[]
  readonly selectedInterventionUuid: string | null
  readonly selectedIntervention: WorkflowIntervention | null
}

export function createLaboratoryOperationsViewModel(
  query: LaboratoryOperationsQuery,
  tasks: TaskRuntimePresentationPage,
  devices: readonly DeviceSummary[],
  interventions: readonly WorkflowIntervention[],
): LaboratoryOperationsViewModel {
  return {
    kind: 'laboratory_operations',
    query,
    tasks: tasks.items,
    total: tasks.total,
    page: tasks.page,
    pageSize: tasks.pageSize,
    devices,
    interventions,
    selectedTaskUuid: null,
    selectedTask: null,
    selectedJobs: [],
    selectedInterventionUuid: null,
    selectedIntervention: null,
  }
}
