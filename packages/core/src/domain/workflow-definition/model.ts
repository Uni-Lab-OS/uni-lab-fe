export type PublishedWorkflowType = 'workflow' | 'experiment_operation'
export type WorkflowRevisionStatus = 'published' | 'source'

export interface PublishedWorkflowRevisionSummary {
  readonly source: 'os' | 'fixture'
  readonly workflowUuid: string
  readonly name: string
  readonly revision: number
  readonly workflowType: PublishedWorkflowType
  readonly status: WorkflowRevisionStatus
  readonly description?: string
}

export interface WorkflowGraph {
  readonly workflow: Readonly<Record<string, unknown>>
  /** 工作流包声明的运行入参合同。 */
  readonly inputParameters?: readonly WorkflowInputParameter[]
  readonly nodes: readonly Readonly<Record<string, unknown>>[]
  readonly edges: readonly Readonly<Record<string, unknown>>[]
  readonly nodeTemplates: readonly Readonly<Record<string, unknown>>[]
  readonly handleTemplates: readonly Readonly<Record<string, unknown>>[]
  readonly inventoryRequirements: readonly InventoryRequirement[]
}

export interface WorkflowInputParameter {
  readonly name: string
  readonly required: boolean
  readonly schema: Readonly<Record<string, unknown>>
  readonly defaultValue?: unknown
  readonly title?: string
  readonly description?: string
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
