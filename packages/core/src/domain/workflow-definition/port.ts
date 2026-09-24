import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary
} from './model'

export interface WorkflowDefinitionPort {
  listPublishedRevisions(input?: {
    readonly page?: number
    readonly pageSize?: number
  }): Promise<readonly PublishedWorkflowRevisionSummary[]>

  getPublishedRevision(workflowUuid: string): Promise<PublishedWorkflowRevision>
}
