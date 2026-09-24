import type { RunPreparationState } from './state'

export interface RunPreparationViewModel extends RunPreparationState {
  readonly kind: 'run_preparation'
  readonly requirements: RunPreparationState['revision']['graph']['inventoryRequirements']
}

export function toRunPreparationViewModel(
  state: RunPreparationState
): RunPreparationViewModel {
  return {
    kind: 'run_preparation',
    ...state,
    requirements: state.revision.graph.inventoryRequirements
  }
}
