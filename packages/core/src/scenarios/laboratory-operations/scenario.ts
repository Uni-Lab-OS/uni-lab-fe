import type { DeviceActionPort } from '../../domain/device-action/port'
import type { EvidenceInterventionPort } from '../../domain/evidence-intervention/port'
import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import {
  createLaboratoryOperationsViewModel,
  type LaboratoryOperationsQuery,
  type LaboratoryOperationsViewModel
} from './view-model'

export interface LaboratoryOperationsScenario {
  load(query?: LaboratoryOperationsQuery): Promise<LaboratoryOperationsViewModel>
  inspectTask(
    viewModel: LaboratoryOperationsViewModel,
    taskUuid: string
  ): Promise<LaboratoryOperationsViewModel>
  inspectIntervention(
    viewModel: LaboratoryOperationsViewModel,
    interventionUuid: string
  ): Promise<LaboratoryOperationsViewModel>
}

export function createLaboratoryOperationsScenario(
  executionRead: WorkflowExecutionReadPort,
  deviceActions: DeviceActionPort,
  interventions: EvidenceInterventionPort
): LaboratoryOperationsScenario {
  return {
    async load(query = {}) {
      const [tasks, devices, interventionItems] = await Promise.all([
        executionRead.listTaskPresentations({
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          cleanupStatus: query.cleanupStatus,
          view: query.view,
          terminalLimit: query.terminalLimit
        }),
        deviceActions.listDevices(),
        interventions.listInterventions({
          status: query.interventionStatus,
          limit: query.interventionLimit
        })
      ])
      return createLaboratoryOperationsViewModel(query, tasks, devices, interventionItems)
    },

    async inspectTask(viewModel, taskUuid) {
      const [task, jobs] = await Promise.all([
        executionRead.getTaskDetail(taskUuid),
        executionRead.listTaskJobs(taskUuid)
      ])
      return {
        ...viewModel,
        selectedTaskUuid: taskUuid,
        selectedTask: task,
        selectedJobs: jobs
      }
    },

    async inspectIntervention(viewModel, interventionUuid) {
      const intervention = await interventions.getIntervention(interventionUuid)
      return {
        ...viewModel,
        selectedInterventionUuid: interventionUuid,
        selectedIntervention: intervention
      }
    }
  }
}
