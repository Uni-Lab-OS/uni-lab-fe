export type WorkflowJsonValue =
  | null
  | boolean
  | number
  | string
  | WorkflowJsonValue[]
  | { [key: string]: WorkflowJsonValue }

export type WorkflowValueSchema =
  | {
      type: 'string'
      enum?: string[]
      'x-unilabos-enum-labels'?: string[]
      minLength?: number
      maxLength?: number
      'x-unilabos-editor-control'?: 'site_selector'
    }
  | {
      type: 'integer' | 'number'
      enum?: number[]
      'x-unilabos-enum-labels'?: string[]
      minimum?: number
      maximum?: number
    }
  | {
      type: 'boolean'
      enum?: boolean[]
      'x-unilabos-enum-labels'?: string[]
    }
  | { type: 'object' }
  | {
      type: 'array'
      items: Exclude<WorkflowValueSchema, { type: 'array' }>
      minItems?: number
      maxItems?: number
    }
  | {
      $slot: 'ResourceSlot'
      allowed_resource_template_uuids?: string[]
    }
  | {
      anyOf: [
        Exclude<WorkflowValueSchema, { anyOf: unknown }>,
        { type: 'null' }
      ]
    }

export interface WorkflowInputDescriptor {
  name: string
  schema: WorkflowValueSchema
  required: boolean
  default?: WorkflowJsonValue
  title?: string
  description?: string
}

export interface WorkflowOutputDescriptor {
  name: string
  schema: WorkflowValueSchema
  title?: string
  description?: string
  implicit: boolean
}

export interface WorkflowInputContract {
  version: 1
  parameters: WorkflowInputDescriptor[]
}

export interface WorkflowOutputContract {
  version: 1
  outputs: WorkflowOutputDescriptor[]
}

export type WorkflowOutputBinding =
  | { kind: 'workflow_input'; parameter: string }
  | {
      kind: 'node_output'
      workflow_node_uuid: string
      source_handle_uuid: string
    }

export interface WorkflowIoMetadata {
  input_contract: WorkflowInputContract
  output_contract: WorkflowOutputContract
  output_bindings: Record<string, WorkflowOutputBinding>
}

export function decodeWorkflowIoMetadata(value: unknown): WorkflowIoMetadata {
  const metadata = record(value)
  const inputContract = decodeInputContract(metadata.input_contract)
  const outputContract = decodeOutputContract(metadata.output_contract)
  const rawBindings = record(metadata.output_bindings)
  const outputNames = new Set(outputContract.outputs.map(({ name }) => name))
  if (!sameKeys(rawBindings, outputNames)) invalid()

  const outputBindings: Record<string, WorkflowOutputBinding> = {}
  for (const [name, value] of Object.entries(rawBindings)) {
    outputBindings[name] = decodeOutputBinding(value)
  }
  return {
    input_contract: inputContract,
    output_contract: outputContract,
    output_bindings: outputBindings
  }
}

function decodeInputContract(value: unknown): WorkflowInputContract {
  const contract = exactRecord(value, ['version', 'parameters'])
  if (contract.version !== 1 || !Array.isArray(contract.parameters)) invalid()
  const names = new Set<string>()
  const parameters = contract.parameters.map((value) => {
    const descriptor = record(value)
    if (!hasExactOptionalKeys(
      descriptor,
      ['name', 'schema', 'required'],
      ['default', 'title', 'description']
    )) invalid()
    const name = nonEmptyString(descriptor.name)
    if (names.has(name) || typeof descriptor.required !== 'boolean') invalid()
    names.add(name)
    optionalString(descriptor.title)
    optionalString(descriptor.description)
    const schema = decodeValueSchema(descriptor.schema, true, true)
    const hasDefault = Object.hasOwn(descriptor, 'default')
    const nullable = 'anyOf' in schema
    if (
      (descriptor.required && (hasDefault || nullable)) ||
      (!descriptor.required && !hasDefault) ||
      (!descriptor.required && nullable && descriptor.default !== null) ||
      (!descriptor.required && !nullable && descriptor.default === null)
    ) invalid()
    if (
      hasDefault &&
      !isWorkflowDefaultValue(schema, descriptor.default)
    ) invalid()
    return descriptor as unknown as WorkflowInputDescriptor
  })
  return { version: 1, parameters }
}

function decodeOutputContract(value: unknown): WorkflowOutputContract {
  const contract = exactRecord(value, ['version', 'outputs'])
  if (contract.version !== 1 || !Array.isArray(contract.outputs)) invalid()
  const names = new Set<string>()
  const outputs = contract.outputs.map((value) => {
    const descriptor = record(value)
    if (!hasExactOptionalKeys(
      descriptor,
      ['name', 'schema'],
      ['title', 'description', 'implicit']
    )) invalid()
    const name = nonEmptyString(descriptor.name)
    if (names.has(name)) invalid()
    names.add(name)
    optionalString(descriptor.title)
    optionalString(descriptor.description)
    if (
      descriptor.implicit !== undefined &&
      typeof descriptor.implicit !== 'boolean'
    ) invalid()
    decodeValueSchema(descriptor.schema, true, true)
    return {
      ...descriptor,
      implicit: descriptor.implicit ?? false
    } as unknown as WorkflowOutputDescriptor
  })
  return { version: 1, outputs }
}

function decodeOutputBinding(value: unknown): WorkflowOutputBinding {
  const binding = record(value)
  if (binding.kind === 'workflow_input') {
    if (!sameKeys(binding, new Set(['kind', 'parameter']))) invalid()
    return {
      kind: 'workflow_input',
      parameter: nonEmptyString(binding.parameter)
    }
  }
  if (binding.kind === 'node_output') {
    if (!sameKeys(
      binding,
      new Set(['kind', 'workflow_node_uuid', 'source_handle_uuid'])
    )) invalid()
    return {
      kind: 'node_output',
      workflow_node_uuid: nonEmptyString(binding.workflow_node_uuid),
      source_handle_uuid: nonEmptyString(binding.source_handle_uuid)
    }
  }
  return invalid()
}

function decodeValueSchema(
  value: unknown,
  allowArray: boolean,
  allowNullable: boolean
): WorkflowValueSchema {
  const schema = record(value)
  if (Object.hasOwn(schema, 'anyOf')) {
    if (
      !allowNullable ||
      !sameKeys(schema, new Set(['anyOf'])) ||
      !Array.isArray(schema.anyOf) ||
      schema.anyOf.length !== 2
    ) invalid()
    const nullMember = exactRecord(schema.anyOf[1], ['type'])
    if (nullMember.type !== 'null') invalid()
    decodeValueSchema(schema.anyOf[0], true, false)
    return schema as unknown as WorkflowValueSchema
  }
  if (Object.hasOwn(schema, '$slot')) {
    if (!hasExactOptionalKeys(
      schema,
      ['$slot'],
      ['allowed_resource_template_uuids']
    ) || schema.$slot !== 'ResourceSlot') invalid()
    if (schema.allowed_resource_template_uuids !== undefined) {
      if (
        !Array.isArray(schema.allowed_resource_template_uuids) ||
        schema.allowed_resource_template_uuids.length === 0
      ) invalid()
      const identities = new Set<string>()
      for (const item of schema.allowed_resource_template_uuids) {
        const identity = canonicalUuid(item)
        if (identities.has(identity)) invalid()
        identities.add(identity)
      }
    }
    return schema as unknown as WorkflowValueSchema
  }

  const kind = schema.type
  const optionalByKind: Record<string, string[]> = {
    string: [
      'enum',
      'minLength',
      'maxLength',
      'x-unilabos-enum-labels',
      'x-unilabos-editor-control'
    ],
    integer: ['enum', 'minimum', 'maximum', 'x-unilabos-enum-labels'],
    number: ['enum', 'minimum', 'maximum', 'x-unilabos-enum-labels'],
    boolean: ['enum', 'x-unilabos-enum-labels'],
    object: [],
    array: ['items', 'minItems', 'maxItems']
  }
  if (typeof kind !== 'string' || !(kind in optionalByKind)) invalid()
  if (kind === 'array' && !allowArray) invalid()
  if (!hasExactOptionalKeys(schema, ['type'], optionalByKind[kind] ?? [])) {
    invalid()
  }
  if (kind === 'array') {
    if (!Object.hasOwn(schema, 'items')) invalid()
    decodeValueSchema(schema.items, false, false)
  }
  validateSchemaConstraints(schema, kind)
  return schema as unknown as WorkflowValueSchema
}

function validateSchemaConstraints(
  schema: Record<string, unknown>,
  kind: string
): void {
  if (kind === 'integer' || kind === 'number') {
    const minimum = optionalNumberBound(schema.minimum, kind)
    const maximum = optionalNumberBound(schema.maximum, kind)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      invalid()
    }
  }
  if (kind === 'string') {
    const minimum = optionalLengthBound(schema.minLength)
    const maximum = optionalLengthBound(schema.maxLength)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      invalid()
    }
    if (
      schema['x-unilabos-editor-control'] !== undefined &&
      schema['x-unilabos-editor-control'] !== 'site_selector'
    ) invalid()
  }
  if (kind === 'array') {
    const minimum = optionalLengthBound(schema.minItems)
    const maximum = optionalLengthBound(schema.maxItems)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      invalid()
    }
  }
  const enumLabels = schema['x-unilabos-enum-labels']
  if (schema.enum === undefined) {
    if (enumLabels !== undefined) invalid()
    return
  }
  if (
    !['string', 'integer', 'number', 'boolean'].includes(kind) ||
    !Array.isArray(schema.enum) ||
    schema.enum.length === 0
  ) invalid()
  const members = new Set<unknown>()
  for (const member of schema.enum) {
    if (!isScalarKind(kind, member) || members.has(member)) invalid()
    members.add(member)
    if (!satisfiesConstraints(schema, kind, member)) invalid()
  }
  if (enumLabels !== undefined) {
    if (
      !Array.isArray(enumLabels) ||
      enumLabels.length !== schema.enum.length ||
      enumLabels.some((label) =>
        typeof label !== 'string' || !label || label.trim() !== label
      ) ||
      new Set(enumLabels).size !== enumLabels.length
    ) invalid()
  }
}

function optionalNumberBound(
  value: unknown,
  kind: 'integer' | 'number'
): number | undefined {
  if (value === undefined) return undefined
  if (!isScalarKind(kind, value)) invalid()
  return value as number
}

function optionalLengthBound(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid()
  }
  return value
}

function isWorkflowDefaultValue(
  schema: WorkflowValueSchema,
  value: unknown
): value is WorkflowJsonValue {
  if (!isWorkflowJsonValue(value)) return false
  if ('anyOf' in schema) {
    return value === null || isWorkflowDefaultValue(schema.anyOf[0], value)
  }
  if ('$slot' in schema) return false
  if (value === null) return false
  const kind = schema.type
  if (kind === 'object') {
    return typeof value === 'object' && !Array.isArray(value)
  }
  if (kind === 'array') {
    return Array.isArray(value) &&
      satisfiesConstraints(schema, kind, value) &&
      value.every((item) => isWorkflowDefaultValue(schema.items, item))
  }
  return isScalarKind(kind, value) &&
    satisfiesConstraints(schema, kind, value)
}

function isScalarKind(kind: string, value: unknown): boolean {
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'integer') {
    return typeof value === 'number' &&
      Number.isFinite(value) && Number.isInteger(value)
  }
  if (kind === 'number') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  return false
}

function satisfiesConstraints(
  schema: Record<string, unknown>,
  kind: string,
  value: unknown
): boolean {
  if (kind === 'integer' || kind === 'number') {
    const numeric = value as number
    if (schema.minimum !== undefined && numeric < (schema.minimum as number)) {
      return false
    }
    if (schema.maximum !== undefined && numeric > (schema.maximum as number)) {
      return false
    }
  } else if (kind === 'string') {
    const length = Array.from(value as string).length
    if (schema.minLength !== undefined && length < (schema.minLength as number)) {
      return false
    }
    if (schema.maxLength !== undefined && length > (schema.maxLength as number)) {
      return false
    }
  } else if (kind === 'array') {
    const length = (value as unknown[]).length
    if (schema.minItems !== undefined && length < (schema.minItems as number)) {
      return false
    }
    if (schema.maxItems !== undefined && length > (schema.maxItems as number)) {
      return false
    }
  }
  return schema.enum === undefined ||
    (schema.enum as unknown[]).some((member) => Object.is(member, value))
}

function canonicalUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value === '00000000-0000-0000-0000-000000000000' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) invalid()
  return value
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  const result = record(value)
  if (!sameKeys(result, new Set(keys))) invalid()
  return result
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function hasExactOptionalKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[]
): boolean {
  const keys = new Set(Object.keys(value))
  return required.every((key) => keys.has(key)) &&
    [...keys].every((key) => required.includes(key) || optional.includes(key))
}

function sameKeys(
  value: Record<string, unknown>,
  expected: Set<string>
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) invalid()
  return value
}

function optionalString(value: unknown): void {
  if (value !== undefined && typeof value !== 'string') invalid()
}

function isWorkflowJsonValue(value: unknown): value is WorkflowJsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isWorkflowJsonValue)
  if (value && typeof value === 'object') {
    return Object.values(value).every(isWorkflowJsonValue)
  }
  return false
}

function invalid(): never {
  throw new TypeError('Invalid Workflow I/O contract')
}
