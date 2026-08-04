import type { HttpClient } from './http'
import { ServiceError } from './errors'

const DETAIL_REQUEST_BATCH_SIZE = 8

export type WorkflowActionEditorControl =
  | 'material_port'
  | 'site_selector'
  | 'variable_selector'

export interface WorkflowActionHandleTemplate {
  uuid: string
  workflowNodeTemplateUuid: string
  handleKey: string
  ioType: 'source' | 'target'
  displayName: string
  valueType: string
  required: boolean
  dataSource: string | null
  dataKey: string | null
  valueSchema: Record<string, unknown>
  editorControl: WorkflowActionEditorControl
  allowedResourceTemplateUuids: string[] | null
  implicitPassthrough: boolean
  structuralRole: 'ready' | null
  wireValue?: Record<string, unknown>
}

export interface WorkflowActionNodeTemplate {
  uuid: string
  resourceTemplateUuid: string
  name: string
  displayName: string
  actionClass: string | null
  actionType: string
  schema: Record<string, unknown>
  goal: Record<string, unknown>
  goalDefault: Record<string, unknown>
  handles: WorkflowActionHandleTemplate[]
  wireValue?: Record<string, unknown>
}

export interface WorkflowPublishedSource {
  kind: 'package'
  definitionFqid: string
  module: string
  symbol: string
  packageCatalogDigest: string
  definitionContentHash: string
}

export interface WorkflowPublishedNodeTemplate {
  uuid: string
  resourceTemplateUuid: string
  name: string
  displayName: string
  workflowClass: string
  workflowUuid: string
  workflowRevision: number
  appliedSourceHash: string
  contractDigest: string
  compositionAllowTransparent: boolean
  inputOrder: string[]
  outputOrder: string[]
  schema: Record<string, unknown>
  goal: Record<string, unknown>
  goalDefault: Record<string, unknown>
  result: Record<string, unknown>
  source: WorkflowPublishedSource
  handles: WorkflowActionHandleTemplate[]
  wireValue?: Record<string, unknown>
}

export interface WorkflowExecutableCatalogSnapshot {
  authorityId: string
  authorityKind: 'local' | 'backend'
  fingerprint: string
  actionTemplates: WorkflowActionNodeTemplate[]
  workflowTemplates: WorkflowPublishedNodeTemplate[]
}

export type WorkflowActionCatalogSnapshot = WorkflowExecutableCatalogSnapshot

export async function loadWorkflowActionCatalog(
  http: HttpClient,
  signal?: AbortSignal
): Promise<WorkflowExecutableCatalogSnapshot> {
  const summaries: Record<string, unknown>[] = []
  let authority: ReturnType<typeof authorityValue> | null = null
  let fingerprint: string | null = null
  let total: number | null = null
  let page = 1
  do {
    const list = catalogEnvelope(await http.request<unknown>(
      `/api/v1/workflow-node-templates?page=${page}&page_size=100`,
      { signal }
    ))
    const pageAuthority = authorityValue(list.authority)
    const pageFingerprint = fingerprintValue(list.catalog_fingerprint)
    const pageTotal = nonNegativeInteger(list.total)
    if (
      positiveInteger(list.page) !== page ||
      positiveInteger(list.page_size) > 100 ||
      (authority && !sameAuthority(authority, pageAuthority)) ||
      (fingerprint && fingerprint !== pageFingerprint) ||
      (total !== null && total !== pageTotal)
    ) {
      invalidCatalog()
    }
    authority ??= pageAuthority
    fingerprint ??= pageFingerprint
    total ??= pageTotal
    const items = recordArray(list.items)
    if (summaries.length + items.length > total) invalidCatalog()
    summaries.push(...items)
    if (summaries.length < total && items.length === 0) invalidCatalog()
    page += 1
  } while (summaries.length < (total ?? 0))
  if (!authority || !fingerprint || summaries.length !== total) {
    invalidCatalog()
  }
  const nodeUuids = new Set<string>()
  const summaryValues = summaries.map((summary) => {
    const uuid = uuidValue(summary.uuid)
    if (nodeUuids.has(uuid)) invalidCatalog()
    nodeUuids.add(uuid)
    const resource = recordValue(summary.resource_template)
    return {
      uuid,
      name: stringValue(summary.name),
      displayName: stringValue(summary.display_name),
      actionType: stringValue(summary.type),
      nodeType: stringValue(summary.node_type),
      resourceTemplateUuid: uuidValue(resource.uuid)
    }
  })

  const projected = await mapInBatches(summaryValues, async (
    summary
  ): Promise<
    WorkflowActionNodeTemplate | WorkflowPublishedNodeTemplate | null
  > => {
    const data = catalogEnvelope(await http.request<unknown>(
      `/api/v1/workflow-node-templates/${encodeURIComponent(summary.uuid)}`,
      { signal }
    ))
    if (
      !sameAuthority(authority, authorityValue(data.authority)) ||
      fingerprintValue(data.catalog_fingerprint) !== fingerprint
    ) {
      invalidCatalog()
    }
    const template = recordValue(data.template)
    const uuid = uuidValue(template.uuid)
    const resourceTemplateUuid = uuidValue(template.resource_template_uuid)
    if (
      uuid !== summary.uuid ||
      resourceTemplateUuid !== summary.resourceTemplateUuid ||
      stringValue(template.name) !== summary.name ||
      stringValue(template.display_name) !== summary.displayName ||
      stringValue(template.type) !== summary.actionType ||
      stringValue(template.node_type) !== summary.nodeType
    ) {
      invalidCatalog()
    }
    const rawSchema = template.schema
    const actionSchema = typedActionSchema(rawSchema)
    const workflowSchema = typedWorkflowSchema(rawSchema)
    if (actionSchema && workflowSchema) invalidCatalog()
    if (workflowSchema) {
      return projectPublishedWorkflow(
        template,
        recordArray(data.handles),
        summary,
        workflowSchema
      )
    }
    if (!actionSchema) return null
    return attachWireValue({
      uuid,
      resourceTemplateUuid,
      name: summary.name,
      displayName: summary.displayName,
      actionClass: nullableString(template.class),
      actionType: summary.actionType,
      schema: actionSchema,
      goal: recordValue(template.goal),
      goalDefault: recordValue(template.goal_default),
      handles: recordArray(data.handles).map((handle) =>
        projectHandle(handle, uuid)
      )
    }, template)
  })
  const actionTemplates = projected.filter(
    (value): value is WorkflowActionNodeTemplate =>
      value !== null && 'actionType' in value
  )
  const workflowTemplates = projected.filter(
    (value): value is WorkflowPublishedNodeTemplate =>
      value !== null && 'workflowUuid' in value
  )

  const handleUuids = new Set<string>()
  for (const detail of [...actionTemplates, ...workflowTemplates]) {
    for (const handle of detail.handles) {
      if (handleUuids.has(handle.uuid)) invalidCatalog()
      handleUuids.add(handle.uuid)
    }
  }
  return {
    authorityId: authority.authorityId,
    authorityKind: authority.kind,
    fingerprint,
    actionTemplates,
    workflowTemplates
  }
}

async function mapInBatches<Input, Output>(
  values: Input[],
  project: (value: Input) => Promise<Output>
): Promise<Output[]> {
  const projected: Output[] = []
  for (let index = 0; index < values.length; index += DETAIL_REQUEST_BATCH_SIZE) {
    projected.push(...await Promise.all(
      values.slice(index, index + DETAIL_REQUEST_BATCH_SIZE).map(project)
    ))
  }
  return projected
}

interface WorkflowSchemaProjection {
  schema: Record<string, unknown>
  workflowUuid: string
  workflowRevision: number
  appliedSourceHash: string
  contractDigest: string
  compositionAllowTransparent: boolean
  inputOrder: string[]
  outputOrder: string[]
  inputSchemas: Record<string, Record<string, unknown>>
  outputSchemas: Record<string, Record<string, unknown>>
  requiredInputs: Set<string>
}

function projectPublishedWorkflow(
  template: Record<string, unknown>,
  rawHandles: Record<string, unknown>[],
  summary: {
    uuid: string
    name: string
    displayName: string
    actionType: string
    nodeType: string
    resourceTemplateUuid: string
  },
  contract: WorkflowSchemaProjection
): WorkflowPublishedNodeTemplate {
  if (
    summary.actionType !== 'workflow' ||
    summary.nodeType !== 'workflow' ||
    summary.name !== `workflow:${contract.workflowUuid}`
  ) invalidCatalog()
  const unilab = closedRecord(
    recordValue(template.meta_data).unilab,
    ['framework_owner_only', 'workflow_source']
  )
  if (unilab.framework_owner_only !== true) invalidCatalog()
  const rawSource = closedRecord(unilab.workflow_source, [
    'kind',
    'definition_fqid',
    'module',
    'symbol',
    'package_catalog_digest',
    'definition_content_hash'
  ])
  const module = absoluteModule(rawSource.module)
  const symbol = identifierValue(rawSource.symbol)
  const workflowClass = stringValue(template.class)
  if (workflowClass !== `${module}:${symbol}` || rawSource.kind !== 'package') {
    invalidCatalog()
  }
  const source: WorkflowPublishedSource = {
    kind: 'package',
    definitionFqid: stringValue(rawSource.definition_fqid),
    module,
    symbol,
    packageCatalogDigest: digestValue(rawSource.package_catalog_digest),
    definitionContentHash: digestValue(rawSource.definition_content_hash)
  }
  const handles = orderPublishedHandles(
    rawHandles.map((handle) => projectHandle(handle, summary.uuid)),
    contract
  )
  validatePublishedHandles(handles, contract)
  const goal = recordValue(template.goal)
  const goalDefault = recordValue(template.goal_default)
  const result = recordValue(template.result)
  if (
    !stringMapMatches(goal, contract.inputOrder) ||
    !stringMapMatches(result, contract.outputOrder) ||
    !defaultsMatch(goalDefault, contract)
  ) invalidCatalog()
  return attachWireValue({
    uuid: summary.uuid,
    resourceTemplateUuid: summary.resourceTemplateUuid,
    name: summary.name,
    displayName: summary.displayName,
    workflowClass,
    workflowUuid: contract.workflowUuid,
    workflowRevision: contract.workflowRevision,
    appliedSourceHash: contract.appliedSourceHash,
    contractDigest: contract.contractDigest,
    compositionAllowTransparent: contract.compositionAllowTransparent,
    inputOrder: contract.inputOrder,
    outputOrder: contract.outputOrder,
    schema: contract.schema,
    goal,
    goalDefault,
    result,
    source,
    handles
  }, template)
}

function orderPublishedHandles(
  handles: WorkflowActionHandleTemplate[],
  contract: WorkflowSchemaProjection
): WorkflowActionHandleTemplate[] {
  const unique = (
    handleKey: string,
    ioType: 'source' | 'target'
  ): WorkflowActionHandleTemplate => {
    const matches = handles.filter((handle) =>
      handle.handleKey === handleKey && handle.ioType === ioType
    )
    if (matches.length !== 1) invalidCatalog()
    return matches[0] as WorkflowActionHandleTemplate
  }
  const ordered = [
    ...contract.inputOrder.map((name) => unique(name, 'target')),
    ...contract.outputOrder.map((name) => unique(name, 'source')),
    unique('ready', 'target'),
    unique('ready', 'source')
  ]
  if (
    ordered.length !== handles.length ||
    new Set(ordered.map((handle) => handle.uuid)).size !== handles.length
  ) invalidCatalog()
  return ordered
}

function projectHandle(
  raw: Record<string, unknown>,
  parentUuid: string
): WorkflowActionHandleTemplate {
  const uuid = uuidValue(raw.uuid)
  const workflowNodeTemplateUuid = uuidValue(
    raw.workflow_node_template_uuid
  )
  if (workflowNodeTemplateUuid !== parentUuid) invalidCatalog()
  const ioType = stringValue(raw.io_type)
  if (ioType !== 'source' && ioType !== 'target') invalidCatalog()
  if (typeof raw.required !== 'boolean') invalidCatalog()
  const unilab = recordValue(recordValue(raw.meta_data).unilab)
  const control = stringValue(unilab.editor_control)
  if (
    control !== 'material_port' &&
    control !== 'site_selector' &&
    control !== 'variable_selector'
  ) {
    invalidCatalog()
  }
  const allowlist = allowlistValue(unilab.allowed_resource_template_uuids)
  return attachWireValue({
    uuid,
    workflowNodeTemplateUuid,
    handleKey: stringValue(raw.handle_key),
    ioType,
    displayName: stringValue(raw.display_name),
    valueType: stringValue(raw.type),
    required: raw.required,
    dataSource: nullableString(raw.data_source),
    dataKey: nullableString(raw.data_key),
    valueSchema: recordValue(unilab.value_schema),
    editorControl: control,
    allowedResourceTemplateUuids: allowlist,
    implicitPassthrough: booleanValue(unilab.implicit_passthrough),
    structuralRole: structuralRoleValue(unilab.structural_role)
  }, raw)
}

function attachWireValue<T extends object>(
  value: T,
  wireValue: Record<string, unknown>
): T & { wireValue: Record<string, unknown> } {
  Object.defineProperty(value, 'wireValue', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { ...wireValue }
  })
  return value as T & { wireValue: Record<string, unknown> }
}

function typedActionSchema(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const schema = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(
    schema,
    'x-unilabos-action-contract'
  )) return null
  const extension = recordValue(schema['x-unilabos-action-contract'])
  if (extension.version !== 1) invalidCatalog()
  const inputOrder = stringArray(extension.input_order)
  const outputOrder = stringArray(extension.output_order)
  if (
    new Set(inputOrder).size !== inputOrder.length ||
    new Set(outputOrder).size !== outputOrder.length
  ) {
    invalidCatalog()
  }
  return schema
}

function typedWorkflowSchema(raw: unknown): WorkflowSchemaProjection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const schema = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(
    schema,
    'x-unilabos-workflow-contract'
  )) return null
  requireKeys(schema, [
    'type',
    'additionalProperties',
    'properties',
    'required',
    'x-unilabos-workflow-contract'
  ])
  if (schema.type !== 'object' || schema.additionalProperties !== false) {
    invalidCatalog()
  }
  const properties = closedRecord(schema.properties, ['goal', 'result'])
  const required = stringArray(schema.required)
  if (!sameStringSet(required, ['goal', 'result'])) invalidCatalog()
  const goal = objectEnvelope(properties.goal)
  const result = objectEnvelope(properties.result)
  const extension = closedRecord(schema['x-unilabos-workflow-contract'], [
    'version',
    'compatibility_version',
    'workflow_uuid',
    'workflow_revision',
    'applied_source_hash',
    'contract_digest',
    'composition_allow_transparent',
    'input_order',
    'output_order'
  ])
  if (extension.version !== 1 || extension.compatibility_version !== 1) {
    invalidCatalog()
  }
  const inputOrder = uniqueStringArray(extension.input_order)
  const outputOrder = uniqueStringArray(extension.output_order)
  if (
    !sameStringSet(inputOrder, Object.keys(goal.properties)) ||
    !sameStringSet(outputOrder, Object.keys(result.properties))
  ) invalidCatalog()
  return {
    schema,
    workflowUuid: uuidValue(extension.workflow_uuid),
    workflowRevision: positiveInteger(extension.workflow_revision),
    appliedSourceHash: digestValue(extension.applied_source_hash),
    contractDigest: digestValue(extension.contract_digest),
    compositionAllowTransparent: booleanValue(
      extension.composition_allow_transparent
    ),
    inputOrder,
    outputOrder,
    inputSchemas: goal.properties,
    outputSchemas: result.properties,
    requiredInputs: new Set(goal.required)
  }
}

function objectEnvelope(raw: unknown): {
  properties: Record<string, Record<string, unknown>>
  required: string[]
} {
  const value = closedRecord(raw, [
    'type',
    'additionalProperties',
    'properties',
    'required'
  ])
  if (value.type !== 'object' || value.additionalProperties !== false) {
    invalidCatalog()
  }
  const properties = recordValue(value.properties)
  const normalized: Record<string, Record<string, unknown>> = {}
  for (const [name, property] of Object.entries(properties)) {
    if (!name) invalidCatalog()
    normalized[name] = recordValue(property)
  }
  const required = uniqueStringArray(value.required)
  if (required.some((name) => !(name in normalized))) invalidCatalog()
  return { properties: normalized, required }
}

function validatePublishedHandles(
  handles: WorkflowActionHandleTemplate[],
  contract: WorkflowSchemaProjection
): void {
  if (handles.length !== contract.inputOrder.length +
    contract.outputOrder.length + 2) invalidCatalog()
  let index = 0
  for (const name of contract.inputOrder) {
    const handle = handles[index++]
    if (!handle) invalidCatalog()
    validateBusinessHandle(
      handle,
      name,
      'target',
      'goal',
      contract.inputSchemas[name],
      contract.requiredInputs.has(name)
    )
  }
  for (const name of contract.outputOrder) {
    const handle = handles[index++]
    if (!handle) invalidCatalog()
    validateBusinessHandle(
      handle,
      name,
      'source',
      'result',
      contract.outputSchemas[name],
      false
    )
  }
  validateReadyHandle(handles[index++], 'target')
  validateReadyHandle(handles[index], 'source')
}

function validateBusinessHandle(
  handle: WorkflowActionHandleTemplate,
  name: string,
  ioType: 'source' | 'target',
  dataSource: 'goal' | 'result',
  schema: Record<string, unknown> | undefined,
  required: boolean
): void {
  if (
    !schema ||
    handle.handleKey !== name ||
    handle.ioType !== ioType ||
    handle.dataSource !== dataSource ||
    handle.dataKey !== name ||
    handle.required !== required ||
    handle.structuralRole !== null ||
    handle.valueType !== workflowValueType(schema) ||
    handle.editorControl !== (
      resourceSlotSchema(schema) ? 'material_port' : 'variable_selector'
    ) ||
    !jsonEquals(handle.valueSchema, handleValueSchema(schema)) ||
    !sameAllowlist(handle.allowedResourceTemplateUuids, schemaAllowlist(schema))
  ) invalidCatalog()
}

function handleValueSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const value = { ...schema }
  delete value.default
  return value
}

function validateReadyHandle(
  handle: WorkflowActionHandleTemplate | undefined,
  ioType: 'source' | 'target'
): void {
  if (
    !handle ||
    handle.handleKey !== 'ready' ||
    handle.ioType !== ioType ||
    handle.dataSource !== 'dependency' ||
    handle.dataKey !== 'ready' ||
    handle.valueType !== 'boolean' ||
    handle.required ||
    handle.editorControl !== 'variable_selector' ||
    handle.allowedResourceTemplateUuids !== null ||
    handle.implicitPassthrough ||
    handle.structuralRole !== 'ready' ||
    !jsonEquals(handle.valueSchema, { type: 'boolean' })
  ) invalidCatalog()
}

function schemaAllowlist(schema: Record<string, unknown>): string[] | null {
  const slot = resourceSlotSchema(schema)
  if (slot) {
    const raw = slot.allowed_resource_template_uuids
    return raw === undefined ? null : allowlistValue(raw)
  }
  return null
}

function resourceSlotSchema(
  schema: Record<string, unknown>
): Record<string, unknown> | null {
  if (schema.$slot === 'ResourceSlot') return schema
  if (schema.items && typeof schema.items === 'object' &&
    !Array.isArray(schema.items)) {
    const nested = resourceSlotSchema(schema.items as Record<string, unknown>)
    if (nested) return nested
  }
  if (Array.isArray(schema.anyOf)) {
    for (const member of schema.anyOf) {
      if (member && typeof member === 'object' && !Array.isArray(member)) {
        const nested = resourceSlotSchema(member as Record<string, unknown>)
        if (nested) return nested
      }
    }
  }
  return null
}

function workflowValueType(schema: Record<string, unknown>): string {
  const members = Array.isArray(schema.anyOf) ? schema.anyOf : []
  const base = members.find((member) =>
    member && typeof member === 'object' && !Array.isArray(member) &&
    (member as Record<string, unknown>).type !== 'null'
  ) as Record<string, unknown> | undefined ?? schema
  if (base.type === 'array') return 'array'
  if (resourceSlotSchema(base)) return 'ResourceSlot'
  return typeof base.type === 'string' ? base.type : 'object'
}

function sameAllowlist(left: string[] | null, right: string[] | null): boolean {
  return left === null
    ? right === null
    : right !== null && sameStrings(left, right)
}

function stringMapMatches(
  raw: Record<string, unknown>,
  order: string[]
): boolean {
  return sameStringSet(Object.keys(raw), order) &&
    order.every((name) => raw[name] === name)
}

function defaultsMatch(
  defaults: Record<string, unknown>,
  contract: WorkflowSchemaProjection
): boolean {
  const expected = contract.inputOrder.filter((name) =>
    Object.prototype.hasOwnProperty.call(contract.inputSchemas[name], 'default')
  )
  return sameStringSet(Object.keys(defaults), expected) && expected.every((name) =>
    jsonEquals(defaults[name], contract.inputSchemas[name]?.default)
  )
}

function closedRecord(raw: unknown, keys: string[]): Record<string, unknown> {
  const value = recordValue(raw)
  requireKeys(value, keys)
  return value
}

function requireKeys(raw: Record<string, unknown>, keys: string[]): void {
  if (!sameStrings(Object.keys(raw).sort(), [...keys].sort())) invalidCatalog()
}

function uniqueStringArray(raw: unknown): string[] {
  const values = stringArray(raw)
  if (new Set(values).size !== values.length) invalidCatalog()
  return values
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((value) => right.includes(value))
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonEquals(item, right[index]))
  }
  if (
    !left || typeof left !== 'object' ||
    !right || typeof right !== 'object'
  ) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return sameStrings(leftKeys, rightKeys) && leftKeys.every((key) =>
    jsonEquals(leftRecord[key], rightRecord[key])
  )
}

function digestValue(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) invalidCatalog()
  return value
}

function absoluteModule(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(value)) invalidCatalog()
  return value
}

function identifierValue(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^(?:[_\p{ID_Start}])(?:[_\p{ID_Continue}])*$/u.test(value)) {
    invalidCatalog()
  }
  return value
}

function catalogEnvelope(raw: unknown): Record<string, unknown> {
  const envelope = recordValue(raw)
  if (
    envelope.code !== 0 ||
    !Object.prototype.hasOwnProperty.call(envelope, 'data') ||
    Object.prototype.hasOwnProperty.call(envelope, 'error')
  ) {
    invalidCatalog()
  }
  return recordValue(envelope.data)
}

function authorityValue(raw: unknown): {
  authorityId: string
  kind: 'local' | 'backend'
} {
  const authority = recordValue(raw)
  const authorityId = stringValue(authority.authority_id)
  const kind = stringValue(authority.kind)
  if (kind !== 'local' && kind !== 'backend') invalidCatalog()
  return { authorityId, kind }
}

function sameAuthority(
  left: { authorityId: string; kind: string },
  right: { authorityId: string; kind: string }
): boolean {
  return left.authorityId === right.authorityId && left.kind === right.kind
}

function fingerprintValue(raw: unknown): string {
  const value = stringValue(raw)
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) invalidCatalog()
  return value
}

function uuidValue(raw: unknown): string {
  const value = stringValue(raw)
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    invalidCatalog()
  }
  return value.toLowerCase()
}

function allowlistValue(raw: unknown): string[] | null {
  if (raw === null) return null
  const values = stringArray(raw).map(uuidValue)
  if (values.length === 0 || new Set(values).size !== values.length) {
    invalidCatalog()
  }
  return values
}

function recordValue(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidCatalog()
  return raw as Record<string, unknown>
}

function recordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) invalidCatalog()
  return raw.map(recordValue)
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    invalidCatalog()
  }
  return raw as string[]
}

function stringValue(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) invalidCatalog()
  return raw
}

function nullableString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  return stringValue(raw)
}

function booleanValue(raw: unknown): boolean {
  if (typeof raw !== 'boolean') invalidCatalog()
  return raw
}

function nonNegativeInteger(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    invalidCatalog()
  }
  return raw
}

function positiveInteger(raw: unknown): number {
  const value = nonNegativeInteger(raw)
  if (value === 0) invalidCatalog()
  return value
}

function structuralRoleValue(raw: unknown): 'ready' | null {
  if (raw === undefined || raw === null) return null
  if (raw !== 'ready') invalidCatalog()
  return raw
}

function invalidCatalog(): never {
  throw new ServiceError({
    code: 'INVALID_API_RESPONSE',
    message: 'Workflow Action Catalog 返回了无效响应',
    retryable: false
  })
}
