import type { WorkflowActionHandleTemplate } from './workflowActionCatalogTypes'
import type { WorkflowSchemaProjection } from './workflowActionCatalogProjection'
import {
  allowlistValue,
  closedRecord,
  invalidCatalog,
  jsonEquals,
  recordValue,
  sameStringSet,
  sameStrings,
  uniqueStringArray
} from './workflowActionCatalogWire'

/** 解析 goal/result 对象 envelope；参数是原始值，返回属性 schema 与必填键，开放或不一致结构时关闭失败。 */
export function objectEnvelope(raw: unknown): {
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

/** 验证全部已发布工作流连接点；参数是连接点与冻结合同，返回已对齐白名单的连接点，数量、方向或 schema 不一致时关闭失败。 */
export function validatePublishedHandles(
  handles: WorkflowActionHandleTemplate[],
  contract: WorkflowSchemaProjection
): WorkflowActionHandleTemplate[] {
  const aligned = alignPublishedHandlesWithContract(handles, contract)
  if (aligned.length !== contract.inputOrder.length +
    contract.outputOrder.length + 2) invalidCatalog()
  let index = 0
  for (const name of contract.inputOrder) {
    const handle = aligned[index++]
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
    const handle = aligned[index++]
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
  validateReadyHandle(aligned[index++], 'target')
  validateReadyHandle(aligned[index], 'source')
  return aligned
}

/**
 * 以冻结合同 schema 对齐物料占位符（ResourceSlot）白名单。
 *
 * Local Domain 重建后资源模板 UUID 可能重写，OS 会更新合同 schema，但连接点
 * wire 上的白名单可能仍保留发布快照中的旧 UUID。仅在两侧都是 ResourceSlot 时
 * 以 schema 白名单为准；其它 value schema 破坏仍失败关闭。
 */
export function alignPublishedHandlesWithContract(
  handles: WorkflowActionHandleTemplate[],
  contract: WorkflowSchemaProjection
): WorkflowActionHandleTemplate[] {
  return handles.map((handle) => {
    if (handle.structuralRole === 'ready') return handle
    const schema = handle.ioType === 'target'
      ? contract.inputSchemas[handle.handleKey]
      : handle.ioType === 'source'
        ? contract.outputSchemas[handle.handleKey]
        : undefined
    if (!schema) return handle
    const schemaSlot = resourceSlotSchema(schema)
    const handleSlot = resourceSlotSchema(handle.valueSchema)
    if (!schemaSlot || !handleSlot) return handle
    const allowlist = schemaAllowlist(schema)
    if (sameAllowlist(handle.allowedResourceTemplateUuids, allowlist)) {
      return handle
    }
    return {
      ...handle,
      valueSchema: rewriteResourceSlotAllowlist(handle.valueSchema, allowlist),
      allowedResourceTemplateUuids: allowlist
    }
  })
}

/** 在 ResourceSlot schema 树中重写白名单；保持其余字段不变。 */
function rewriteResourceSlotAllowlist(
  schema: Record<string, unknown>,
  allowlist: string[] | null
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...schema }
  if (next.$slot === 'ResourceSlot') {
    if (allowlist === null) delete next.allowed_resource_template_uuids
    else next.allowed_resource_template_uuids = [...allowlist]
    return next
  }
  if (next.items && typeof next.items === 'object' && !Array.isArray(next.items)) {
    next.items = rewriteResourceSlotAllowlist(
      next.items as Record<string, unknown>,
      allowlist
    )
  }
  if (Array.isArray(next.anyOf)) {
    next.anyOf = next.anyOf.map((member) =>
      member && typeof member === 'object' && !Array.isArray(member)
        ? rewriteResourceSlotAllowlist(member as Record<string, unknown>, allowlist)
        : member
    )
  }
  return next
}

/** 验证业务连接点；参数包含连接点、名称、方向、数据源、schema 与必填性，无返回值，不一致时关闭失败。 */
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

/** 取得连接点值 schema；参数是冻结属性 schema，返回移除 default 的副本，不主动抛错。 */
function handleValueSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const value = { ...schema }
  delete value.default
  return value
}

/** 验证 ready 结构连接点；参数是可选连接点与方向，无返回值，结构语义不精确时关闭失败。 */
function validateReadyHandle(
  handle: WorkflowActionHandleTemplate | undefined,
  ioType: 'source' | 'target'
): void {
  const common = Boolean(
    handle &&
    handle.handleKey === 'ready' &&
    handle.ioType === ioType &&
    !handle.required &&
    handle.editorControl === 'variable_selector' &&
    handle.allowedResourceTemplateUuids === null &&
    !handle.implicitPassthrough &&
    handle.structuralRole === 'ready'
  )
  const legacy = Boolean(
    handle &&
    handle.dataSource === 'dependency' &&
    handle.dataKey === 'ready' &&
    handle.valueType === 'boolean' &&
    jsonEquals(handle.valueSchema, { type: 'boolean' })
  )
  const canonical = Boolean(
    handle &&
    handle.dataSource === null &&
    handle.dataKey === null &&
    handle.valueType === 'default' &&
    jsonEquals(handle.valueSchema, {})
  )
  if (!common || (!legacy && !canonical)) invalidCatalog()
}

/** 解析物料占位符（ResourceSlot）资源模板白名单；参数是属性 schema，返回 UUID 数组或 null，非法时关闭失败。 */
function schemaAllowlist(schema: Record<string, unknown>): string[] | null {
  const slot = resourceSlotSchema(schema)
  if (slot) {
    const raw = slot.allowed_resource_template_uuids
    return raw === undefined ? null : allowlistValue(raw)
  }
  return null
}

/** 定位嵌套物料占位符（ResourceSlot）schema；参数是属性 schema，返回命中对象或 null，不主动抛错。 */
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

/** 推导工作流值类型；参数是冻结属性 schema，返回 wire type，缺失基础类型时关闭失败。 */
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

/** 比较两个白名单；参数是可空 UUID 数组，返回顺序与内容完全一致性，不主动抛错。 */
function sameAllowlist(left: string[] | null, right: string[] | null): boolean {
  return left === null
    ? right === null
    : right !== null && sameStrings(left, right)
}

/** 核对字符串映射键；参数是映射与期望顺序，返回键集合一致性，映射无效时关闭失败。 */
export function stringMapMatches(
  raw: Record<string, unknown>,
  order: string[]
): boolean {
  return sameStringSet(Object.keys(raw), order) &&
    order.every((name) => raw[name] === name)
}

/** 核对默认值；参数是默认值映射与冻结合同，返回默认值合法性，结构无效时关闭失败。 */
export function defaultsMatch(
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
