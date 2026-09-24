export type PublishedWorkflowType = 'workflow' | 'experiment_operation'

export interface PublishedWorkflowRevisionSummary {
  readonly source: 'os' | 'fixture'
  readonly workflowUuid: string
  readonly name: string
  readonly revision: number
  readonly workflowType: PublishedWorkflowType
  readonly status: 'published'
  readonly description?: string
}

export interface WorkflowGraph {
  readonly workflow: Readonly<Record<string, unknown>>
  readonly nodes: readonly Readonly<Record<string, unknown>>[]
  readonly edges: readonly Readonly<Record<string, unknown>>[]
  readonly nodeTemplates: readonly Readonly<Record<string, unknown>>[]
  readonly handleTemplates: readonly Readonly<Record<string, unknown>>[]
  readonly inventoryRequirements: readonly InventoryRequirement[]
}

export interface InventoryRequirement {
  readonly uuid: string
  readonly workflowUuid?: string
  readonly consumeNodeUuid: string
  readonly requirementKey: string
  readonly targetType: string
  readonly requiredQuantity: number
  readonly quantityUnit: string
  readonly allowSplit: boolean
  readonly description?: string
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface PublishedWorkflowRevision extends PublishedWorkflowRevisionSummary {
  readonly kind: 'published_revision'
  readonly graph: WorkflowGraph
}
