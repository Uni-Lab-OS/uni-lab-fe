import type { PublishedWorkflowRevision } from '../../domain/workflow-definition/model'
import type { BindingDraft, RunConfiguration } from '../../domain/run-preparation/model'

export type { BindingDraft, RunConfiguration } from '../../domain/run-preparation/model'

export interface RunPreparationState {
  readonly revision: PublishedWorkflowRevision
  readonly configuration: RunConfiguration
  readonly binding: BindingDraft
}
