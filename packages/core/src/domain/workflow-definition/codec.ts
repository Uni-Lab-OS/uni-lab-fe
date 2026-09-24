import {
  WorkflowDefinitionError,
  type WorkflowDefinitionErrorCode
} from './errors'
import type {
  InventoryRequirement,
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary,
  PublishedWorkflowType,
  WorkflowGraph
} from './model'
import type {
  PublishedWorkflowResponse,
  WorkflowDefinitionRecord,
  WorkflowGraphResponse
} from './api'

export function decodePublishedWorkflowList(
  value: unknown
): readonly PublishedWorkflowRevisionSummary[] {
  const root = asRecord(value, 'workflow list')
  const items = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.data)
      ? root.data
      : []
  return items.map((item, index) => decodeSummary(asRecord(item, `items[${index}]`), `items[${index}]`))
}

export function decodePublishedWorkflow(
  summaryValue: PublishedWorkflowResponse,
  graphValue: WorkflowGraphResponse
): PublishedWorkflowRevision {
  const summary = decodeSummary(summaryValue, 'workflow')
  const graph = decodeGraph(graphValue)
  const graphWorkflow = graph.workflow
  const graphUuid = optionalString(graphWorkflow.uuid)
  if (graphUuid !== undefined && graphUuid !== summary.workflowUuid) {
    throw new WorkflowDefinitionError(
      'WORKFLOW_IDENTITY_DRIFT',
      'Workflow summary and graph identities differ'
    )
  }
  return {
    kind: 'published_revision',
    ...summary,
    graph
  }
}

function decodeSummary(
  value: WorkflowDefinitionRecord,
  path: string
): PublishedWorkflowRevisionSummary {
  const workflowUuid = requiredString(value.uuid ?? value.workflow_uuid, `${path}.uuid`)
  const name = requiredString(value.name ?? value.title, `${path}.name`)
  const status = optionalString(value.status)
  if (status !== undefined && status !== 'published') {
    throw definitionError('WORKFLOW_NOT_PUBLISHED', `${path}.status is not published`)
  }
  const revision = positiveInteger(
    value.revision ?? asOptionalRecord(value.revision)?.number,
    `${path}.revision`
  )
  const workflowType = decodeWorkflowType(
    value.workflow_type ?? value.workflowType,
    `${path}.workflow_type`
  )
  const description = optionalString(value.description)
  return {
    source: 'os',
    workflowUuid,
    name,
    revision,
    workflowType,
    status: 'published',
    ...(description === undefined ? {} : { description })
  }
}

function decodeWorkflowType(value: unknown, path: string): PublishedWorkflowType {
  if (value === 'workflow' || value === 'experiment_operation') return value
  throw definitionError(
    'UNSUPPORTED_WORKFLOW_TYPE',
    `${path} is missing or unsupported`
  )
}

function decodeGraph(value: WorkflowGraphResponse): WorkflowGraph {
  const workflow = asRecord(value.workflow, 'graph.workflow')
  const nodes = recordArray(value.nodes, 'graph.nodes')
  const edges = recordArray(value.edges, 'graph.edges')
  const nodeTemplates = recordArray(value.node_templates, 'graph.node_templates')
  const handleTemplates = recordArray(value.handle_templates, 'graph.handle_templates')
  const requirements = Array.isArray(value.inventory_requirements)
    ? value.inventory_requirements.map((item, index) =>
        decodeRequirement(asRecord(item, `graph.inventory_requirements[${index}]`), index)
      )
    : []
  return {
    workflow,
    nodes,
    edges,
    nodeTemplates,
    handleTemplates,
    inventoryRequirements: requirements
  }
}

function decodeRequirement(value: WorkflowDefinitionRecord, index: number): InventoryRequirement {
  const path = `graph.inventory_requirements[${index}]`
  return {
    uuid: requiredString(value.uuid, `${path}.uuid`),
    ...(optionalString(value.workflow_uuid) === undefined
      ? {}
      : { workflowUuid: optionalString(value.workflow_uuid) }),
    consumeNodeUuid: requiredString(value.consume_node_uuid, `${path}.consume_node_uuid`),
    requirementKey: requiredString(value.requirement_key, `${path}.requirement_key`),
    targetType: requiredString(value.target_type, `${path}.target_type`),
    requiredQuantity: finiteNumber(value.required_quantity, `${path}.required_quantity`),
    quantityUnit: requiredString(value.quantity_unit, `${path}.quantity_unit`),
    allowSplit: booleanValue(value.allow_split, `${path}.allow_split`),
    ...(optionalString(value.description) === undefined
      ? {}
      : { description: optionalString(value.description) }),
    metadata: asOptionalRecord(value.meta_data) ?? {}
  }
}

function recordArray(value: unknown, path: string): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be an array`)
  return value.map((item, index) => asRecord(item, `${path}[${index}]`))
}

function asRecord(value: unknown, path: string): WorkflowDefinitionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be an object`)
  }
  return value as WorkflowDefinitionRecord
}

function asOptionalRecord(value: unknown): WorkflowDefinitionRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as WorkflowDefinitionRecord
    : undefined
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value)
  if (result === undefined) throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be a string`)
  return result
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be a positive integer`)
  }
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be a finite number`)
  }
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} must be a boolean`)
  }
  return value
}

function definitionError(code: WorkflowDefinitionErrorCode, message: string): WorkflowDefinitionError {
  return new WorkflowDefinitionError(code, message)
}
