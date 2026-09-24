export type WorkflowDefinitionRecord = Readonly<Record<string, unknown>>

export interface PublishedWorkflowListRequest {
  readonly page: number
  readonly pageSize: number
}

export interface PublishedWorkflowListResponse {
  readonly items: readonly WorkflowDefinitionRecord[]
}

export interface PublishedWorkflowResponse extends WorkflowDefinitionRecord {
  readonly uuid?: string
  readonly workflow_uuid?: string
  readonly name?: string
  readonly title?: string
  readonly revision?: number | WorkflowRevisionValue
  readonly workflow_type?: string
  readonly workflowType?: string
  readonly status?: string
  readonly description?: string
}

export interface WorkflowGraphResponse extends WorkflowDefinitionRecord {
  readonly workflow?: WorkflowDefinitionRecord
  readonly nodes?: readonly unknown[]
  readonly edges?: readonly unknown[]
  readonly node_templates?: readonly unknown[]
  readonly handle_templates?: readonly unknown[]
  readonly inventory_requirements?: readonly WorkflowDefinitionRecord[]
}

export interface WorkflowRevisionValue extends WorkflowDefinitionRecord {
  readonly number?: number
}
