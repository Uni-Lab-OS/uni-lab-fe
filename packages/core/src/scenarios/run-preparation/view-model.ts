import type { RunPreparationState } from './state'
import type {
  NodeJobDetail,
  ResourceCandidate,
  ResourceCandidateIssue,
} from '../../domain/run-preparation/model'

export interface RunPreparationViewModel extends RunPreparationState {
  readonly kind: 'run_preparation'
  readonly requirements: RunPreparationState['revision']['graph']['inventoryRequirements']
  readonly candidates: readonly ResourceCandidate[]
  readonly candidateIssues: readonly ResourceCandidateIssue[]
  readonly nodeJob: NodeJobDetail | null
}

export function toRunPreparationViewModel(state: RunPreparationState): RunPreparationViewModel {
  return {
    kind: 'run_preparation',
    ...state,
    requirements: state.revision.graph.inventoryRequirements,
    candidates: [],
    candidateIssues: [],
    nodeJob: null,
  }
}
