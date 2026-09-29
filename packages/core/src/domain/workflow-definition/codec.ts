import {
  WorkflowDefinitionError,
  type WorkflowDefinitionErrorCode
} from './errors'
import type {
  InventoryRequirement,
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary,
  PublishedWorkflowType,
  WorkflowRevisionStatus,
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
  const root = asRecord(unwrapEnvelope(value), 'workflow list')
  const items = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.data)
      ? root.data
      : []
  const identities = new Set<string>()
  return items.map((item, index) => {
    const summary = decodeSummary(asRecord(item, `items[${index}]`), `items[${index}]`)
    if (identities.has(summary.workflowUuid)) {
      throw definitionError('INVALID_WORKFLOW_DEFINITION', `duplicate workflow uuid: ${summary.workflowUuid}`)
    }
    identities.add(summary.workflowUuid)
    return summary
  })
}

export function decodePublishedWorkflow(
  summaryValue: PublishedWorkflowResponse,
  graphValue: WorkflowGraphResponse
): PublishedWorkflowRevision {
  const summary = decodeSummary(
    asRecord(unwrapEnvelope(summaryValue), 'workflow'),
    'workflow'
  )
  const graph = decodeGraph(graphValue)
  const graphWorkflow = graph.workflow
  const graphUuid = optionalString(graphWorkflow.uuid)
  if (graphUuid !== undefined && graphUuid !== summary.workflowUuid) {
    throw new WorkflowDefinitionError(
      'WORKFLOW_IDENTITY_DRIFT',
      'Workflow summary and graph identities differ'
    )
  }
  const graphRevision = optionalRevision(graphWorkflow.revision)
  if (graphRevision !== undefined && graphRevision !== summary.revision) {
    throw new WorkflowDefinitionError(
      'WORKFLOW_REVISION_DRIFT',
      'Workflow summary and graph revisions differ'
    )
  }
  for (const requirement of graph.inventoryRequirements) {
    if (requirement.workflowUuid !== undefined && requirement.workflowUuid !== summary.workflowUuid) {
      throw new WorkflowDefinitionError(
        'WORKFLOW_IDENTITY_DRIFT',
        `Inventory requirement ${requirement.uuid} belongs to another workflow`
      )
    }
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
  const status = decodeWorkflowStatus(value.status, `${path}.status`)
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
    status,
    ...(description === undefined ? {} : { description })
  }
}

function decodeWorkflowType(value: unknown, path: string): PublishedWorkflowType {
  if (value === 'workflow' || value === 'experiment_operation') return value
  // SZLab 的完整工作流目录使用 normal 表示普通工作流；统一到前端展示类型。
  if (value === 'normal') return 'workflow'
  throw definitionError(
    'UNSUPPORTED_WORKFLOW_TYPE',
    `${path} is missing or unsupported`
  )
}

function decodeWorkflowStatus(value: unknown, path: string): WorkflowRevisionStatus {
  if (value === undefined) return 'published'
  if (value === 'published' || value === 'source') return value
  throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path} is unsupported`)
}

function decodeGraph(value: WorkflowGraphResponse): WorkflowGraph {
  const root = asRecord(unwrapEnvelope(value), 'workflow graph') as WorkflowGraphResponse
  const workflow = asRecord(root.workflow, 'graph.workflow')
  const inputParameters = decodeInputParameters(workflow)
  const nodes = recordArray(root.nodes, 'graph.nodes')
  const edges = recordArray(root.edges, 'graph.edges')
  const nodeTemplates = recordArray(root.node_templates, 'graph.node_templates')
  const handleTemplates = recordArray(root.handle_templates, 'graph.handle_templates')
  const requirements = Array.isArray(root.inventory_requirements)
    ? root.inventory_requirements.map((item, index) =>
        decodeRequirement(asRecord(item, `graph.inventory_requirements[${index}]`), index)
      )
    : []
  return {
    workflow,
    inputParameters,
    nodes,
    edges,
    nodeTemplates,
    handleTemplates,
    inventoryRequirements: requirements
  }
}

function decodeInputParameters(
  workflow: WorkflowDefinitionRecord
): readonly {
  name: string
  required: boolean
  schema: WorkflowDefinitionRecord
  defaultValue?: unknown
  title?: string
  description?: string
}[] {
  const metadata = asOptionalRecord(workflow.meta_data)
  const unilab = asOptionalRecord(metadata?.unilab)
  const contract = asOptionalRecord(unilab?.input_contract)
  if (contract?.parameters === undefined) return []
  if (!Array.isArray(contract.parameters)) {
    throw definitionError(
      'INVALID_WORKFLOW_DEFINITION',
      'graph.workflow.meta_data.unilab.input_contract.parameters must be an array'
    )
  }
  const names = new Set<string>()
  return contract.parameters.map((value, index) => {
    const path = `graph.workflow.meta_data.unilab.input_contract.parameters[${index}]`
    const parameter = asRecord(value, path)
    const name = requiredString(parameter.name, `${path}.name`)
    if (names.has(name)) {
      throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path}.name is duplicated`)
    }
    names.add(name)
    const schema = asOptionalRecord(parameter.schema)
    if (!schema) {
      throw definitionError('INVALID_WORKFLOW_DEFINITION', `${path}.schema must be an object`)
    }
    const result = {
      name,
      required: booleanValue(parameter.required, `${path}.required`),
      schema,
      ...(Object.prototype.hasOwnProperty.call(parameter, 'default')
        ? { defaultValue: parameter.default }
        : Object.prototype.hasOwnProperty.call(schema, 'default')
          ? { defaultValue: schema.default }
          : {}),
      ...(optionalString(parameter.title ?? schema.title) === undefined
        ? {}
        : { title: optionalString(parameter.title ?? schema.title) }),
      ...(optionalString(parameter.description ?? schema.description) === undefined
        ? {}
        : { description: optionalString(parameter.description ?? schema.description) })
    }
    return result
  })
}

function unwrapEnvelope(value: unknown): unknown {
  const root = asOptionalRecord(value)
  if (!root || (!('data' in root) && root.code === undefined && root.error === undefined)) {
    return value
  }
  if (root.code !== undefined && root.code !== 0 && root.code !== '0') {
    throw definitionError(
      'INVALID_WORKFLOW_DEFINITION',
      optionalString(asOptionalRecord(root.error)?.message ?? asOptionalRecord(root.error)?.msg ?? root.message)
        ?? `Workflow request rejected with code ${String(root.code)}`
    )
  }
  return root.data
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

function optionalRevision(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined
  const record = asOptionalRecord(value)
  if (record?.number === undefined) return undefined
  return typeof record.number === 'number' && Number.isInteger(record.number) && record.number > 0
    ? record.number
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
