import type { RunPreparationState } from './state'
import type { NodeJobDetail } from '../../domain/run-preparation/model'

export interface RunPreparationViewModel extends RunPreparationState {
  readonly kind: 'run_preparation'
  readonly requirements: RunPreparationState['revision']['graph']['inventoryRequirements']
  readonly nodeJob: NodeJobDetail | null
}

export function toRunPreparationViewModel(
  state: RunPreparationState
): RunPreparationViewModel {
  return {
    kind: 'run_preparation',
    ...state,
    requirements: state.revision.graph.inventoryRequirements,
    nodeJob: null
  }
}
