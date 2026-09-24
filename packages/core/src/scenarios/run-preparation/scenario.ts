import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { RunPreparationPort } from '../../domain/run-preparation/port'
import type { RunPreparationState } from './state'
import {
  toRunPreparationViewModel,
  type RunPreparationViewModel
} from './view-model'

export interface RunPreparationScenario {
  load(workflowUuid: string, state: Omit<RunPreparationState, 'revision'>): Promise<RunPreparationViewModel>
  requestPreflight(state: RunPreparationState): ReturnType<RunPreparationPort['requestPreflight']>
  submitRun(state: RunPreparationState): ReturnType<RunPreparationPort['submitRun']>
}

export function createRunPreparationScenario(
  workflowDefinitions: WorkflowDefinitionPort,
  runPreparation: RunPreparationPort
): RunPreparationScenario {
  return {
    async load(workflowUuid, state) {
      const revision = await workflowDefinitions.getPublishedRevision(workflowUuid)
      return toRunPreparationViewModel({ ...state, revision })
    },
    requestPreflight: (state) => runPreparation.requestPreflight(
      state.revision.workflowUuid,
      state.configuration,
      state.binding
    ),
    submitRun: (state) => runPreparation.submitRun(
      state.revision.workflowUuid,
      state.configuration,
      state.binding
    )
  }
}
