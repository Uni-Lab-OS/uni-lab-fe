import type {
  DeviceAction,
  DeviceActionInputSchema,
  WorkflowActionCatalogSnapshot,
  WorkflowActionNodeTemplate
} from '@unilab/services'

export type DeviceActionArgumentDraft = Record<string, string | boolean>

export interface SelectedDeviceActionProjection {
  action: DeviceAction | null
  template: WorkflowActionNodeTemplate | null
}

/**
 * 绑定设备动作声明与同资源模板的权威动作模板，并生成参数表单投影。
 *
 * @param catalog 当前动作目录快照。
 * @param action Edge 为选中设备声明的动作。
 * @param resourceTemplateUuid 设备物料所属资源模板（ResourceTemplate）UUID。
 * @returns 同时包含匹配模板和展示动作的稳定投影。
 */
export function projectSelectedDeviceAction(
  catalog: WorkflowActionCatalogSnapshot | null,
  action: DeviceAction | null,
  resourceTemplateUuid?: string
): SelectedDeviceActionProjection {
  const template = catalog && action
    ? matchDeviceActionTemplate(catalog, action, resourceTemplateUuid)
    : null
  return {
    action: action ? projectDeviceActionTemplate(action, template) : null,
    template
  }
}

/**
 * 为参数草稿生成按 Backend、设备和动作合同代际隔离的存储键。
 *
 * @param backendId 当前 Backend profile 身份。
 * @param backendApiUrl 当前 Backend 权威地址。
 * @param deviceId 选中设备实例的稳定身份。
 * @param action 已投影参数合同的设备动作。
 * @param template 已匹配的动作节点模板。
 * @param fingerprint 可选动作目录代际指纹。
 * @returns 可持久化键；设备或动作未就绪时返回 null。
 */
export function deviceActionDraftStorageKey(
  backendId: string,
  backendApiUrl: string,
  device: { id: string } | null,
  action: DeviceAction | null,
  template: WorkflowActionNodeTemplate | null,
  fingerprint?: string
): string | null {
  if (!device || !action) return null
  return [
    'unilab',
    'device-action-draft',
    backendId,
    backendApiUrl,
    device.id,
    action.actionRef,
    template ? template.uuid : 'unmatched',
    fingerprint || 'unversioned'
  ].join(':')
}

/**
 * 在动作目录（Catalog）中按设备资源模板、动作名称和动作类型唯一匹配动作模板。
 *
 * @param catalog 已校验的动作目录快照。
 * @param action Edge 或 Backend 为设备实例声明的动作。
 * @param resourceTemplateUuid 可选资源模板（ResourceTemplate）UUID；存在时必须精确匹配。
 * @returns 唯一动作模板；缺失或冲突时返回 null 并关闭运行入口。
 */
export function matchDeviceActionTemplate(
  catalog: WorkflowActionCatalogSnapshot,
  action: DeviceAction,
  resourceTemplateUuid?: string
): WorkflowActionNodeTemplate | null {
  const matches = catalog.actionTemplates.filter((template) =>
    template.name === action.actionName &&
    template.actionType === action.typeName &&
    (
      resourceTemplateUuid === undefined ||
      template.resourceTemplateUuid === resourceTemplateUuid
    )
  )
  return matches.length === 1 ? matches[0] ?? null : null
}

/**
 * 将类型化动作模板投影为设备页参数表单使用的动作视图。
 *
 * @param action 设备实例声明的动作身份和当前占用状态。
 * @param template 与设备资源模板、动作名称和类型唯一匹配的动作模板。
 * @returns 带参数 Schema 的新动作视图；合同无效时保留空参数并由就绪性检查关闭失败。
 */
export function projectDeviceActionTemplate(
  action: DeviceAction,
  template: WorkflowActionNodeTemplate | null
): DeviceAction {
  if (!template) return action
  const inputSchema = projectDeviceActionInputSchema(template)
  return {
    ...action,
    displayName: template.displayName,
    label: template.displayName,
    schema: inputSchema === null ? null : template.schema,
    inputSchema: inputSchema ?? {}
  }
}

/**
 * 从动作合同的 goal、目标连接点和 goal_default 构造参数表单 Schema。
 *
 * @param template 已校验身份的工作流节点模板（WorkflowNodeTemplate）。
 * @returns 可安全编辑的字段映射；合同缺失、字段不一致或控件不支持时返回 null。
 */
export function projectDeviceActionInputSchema(
  template: WorkflowActionNodeTemplate
): Record<string, DeviceActionInputSchema> | null {
  const schema = record(template.schema)
  const contract = schema ? actionInputContract(schema) : null
  if (
    !contract ||
    Object.keys(template.goalDefault).some(
      (name) => !contract.inputOrder.includes(name)
    )
  ) return null

  // `targetHandles` 是动作输入的稳定合同投影；ready 等结构连接点不属于参数。
  const targetHandles = template.handles.filter((handle) =>
    handle.ioType === 'target' && handle.structuralRole === null
  )
  if (contract.typed && targetHandles.length !== contract.inputOrder.length) {
    return null
  }

  const result: Record<string, DeviceActionInputSchema> = {}
  for (const name of contract.inputOrder) {
    const property = record(contract.properties[name])
    const matches = contract.typed
      ? targetHandles.filter((handle) =>
          handle.dataSource === 'goal' && handle.dataKey === name
        )
      : []
    const handle = contract.typed && matches.length === 1
      ? matches[0]
      : undefined
    if (
      !property ||
      (contract.typed && (
        !handle ||
        handle.editorControl !== 'variable_selector' ||
        handle.implicitPassthrough ||
        handle.required !== contract.required.includes(name)
      ))
    ) return null
    const projected = projectInputField(
      name,
      property,
      handle?.displayName ?? name,
      handle?.valueSchema ?? property,
      contract.required.includes(name),
      template.goalDefault
    )
    if (!projected) return null
    result[name] = projected
  }
  return result
}

/**
 * 判断设备单动作调试（D1A）是否不涉及物料占位符（ResourceSlot）或库位（Site）。
 *
 * @param template 已匹配的动作模板。
 * @returns 仅包含普通变量参数且无隐式物料传递时返回 true。
 */
export function supportsD1AS1(
  template: WorkflowActionNodeTemplate
): boolean {
  const typed = record(template.schema['x-unilabos-action-contract']) !== null
  return (!typed || template.handles.every((handle) =>
    handle.editorControl !== 'material_port' &&
    handle.editorControl !== 'site_selector' &&
    !handle.implicitPassthrough &&
    !containsUnsupportedContract(handle.valueSchema)
  )) && !containsUnsupportedContract(template.schema)
}

/**
 * 按参数 Schema 严格序列化设备单动作调试（D1A）表单。
 *
 * @param action 已投影参数合同的设备动作。
 * @param draft 用户当前输入草稿。
 * @returns 可提交给 Backend 的规范 JSON 参数对象。
 * @throws 必填项缺失、数字越界或结构化 JSON 类型不匹配时抛出可行动错误。
 */
export function serializeDeviceActionInput(
  action: DeviceAction,
  draft: DeviceActionArgumentDraft,
  template?: WorkflowActionNodeTemplate
): Record<string, unknown> {
  const allowedNames = template
    ? new Set(Object.keys(template.goal))
    : null
  return Object.fromEntries(
    Object.entries(action.inputSchema).flatMap(([name, schema]) => {
      // The live Device catalog may expose routing helpers such as
      // `unilabos_device_id` that are not part of the frozen Action contract.
      // DeviceActionRun validation is closed (`additionalProperties: false`),
      // so only submit fields owned by the selected workflow template.
      if (allowedNames && !allowedNames.has(name)) return []
      const value = draft[name]
      if (value === '' || value === undefined) {
        if (schema.required) throw new Error(`${fieldLabel(name, schema)} 为必填项`)
        if (schema.default !== undefined && schema.default !== null) {
          return [[name, parseField(name, schema, draftDefaultValue(schema))]]
        }
        return []
      }
      return [[name, parseField(name, schema, value)]]
    })
  )
}

/**
 * 将单个动作输入属性收窄为现有表单能够无歧义编辑的字段合同。
 *
 * @param name 参数稳定名称。
 * @param property 动作 goal 中的 JSON Schema 属性。
 * @param handleLabel 目标连接点的人类可读名称。
 * @param handleSchema 目标连接点保存的值 Schema，用于交叉校验基础类型。
 * @param required 参数是否为必填项。
 * @param goalDefault Backend 保存的动作默认参数映射。
 * @returns 表单字段 Schema；包含不支持的类型或非法约束时返回 null。
 */
function projectInputField(
  name: string,
  property: Record<string, unknown>,
  handleLabel: string,
  handleSchema: Record<string, unknown>,
  required: boolean,
  goalDefault: Record<string, unknown>
): DeviceActionInputSchema | null {
  const type = inputType(property)
  if (!type || inputType(handleSchema) !== type) return null
  const field: DeviceActionInputSchema = {
    type,
    title: optionalString(property.title) ?? (handleLabel || name),
    required
  }
  const description = optionalString(property.description)
  if (description) field.description = description
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    field.enum = [...property.enum]
  }
  const minimum = finiteNumber(property.minimum)
  const maximum = finiteNumber(property.maximum)
  if (minimum !== undefined) field.minimum = minimum
  if (maximum !== undefined) field.maximum = maximum
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    return null
  }
  if (Object.prototype.hasOwnProperty.call(goalDefault, name)) {
    field.default = goalDefault[name]
  } else if (Object.prototype.hasOwnProperty.call(property, 'default')) {
    field.default = property.default
  }
  return field
}

interface DeviceActionInputContract {
  typed: boolean
  properties: Record<string, unknown>
  inputOrder: string[]
  required: string[]
}

/**
 * 读取类型化动作合同或 Backend 当前公开的平面参数 Schema。
 *
 * @param schema 动作模板保存的 JSON Schema。
 * @returns 参数属性、顺序和必填集合；结构不闭合时返回 null。
 */
function actionInputContract(
  schema: Record<string, unknown>
): DeviceActionInputContract | null {
  const extension = record(schema['x-unilabos-action-contract'])
  if (extension) {
    const envelopeProperties = record(schema.properties)
    const goal = record(envelopeProperties?.goal)
    const properties = record(goal?.properties)
    const inputOrder = stringArray(extension.input_order)
    const required = stringArray(goal?.required)
    if (
      schema.type !== 'object' ||
      goal?.type !== 'object' ||
      goal.additionalProperties !== false ||
      !properties ||
      !inputOrder ||
      !required ||
      !sameStringSet(Object.keys(properties), inputOrder) ||
      required.some((name) => !inputOrder.includes(name))
    ) return null
    return { typed: true, properties, inputOrder, required }
  }

  const properties = record(schema.properties)
  const required = schema.required === undefined
    ? []
    : stringArray(schema.required)
  if (
    schema.type !== 'object' ||
    !properties ||
    !required ||
    required.some((name) => !(name in properties))
  ) return null
  return {
    typed: false,
    properties,
    inputOrder: Object.keys(properties),
    required
  }
}

/**
 * 读取当前表单支持的 JSON Schema 基础类型，并兼容带 null 的 anyOf 可选值。
 *
 * @param schema 未信任的字段 Schema。
 * @returns 支持的基础类型；无法唯一确定时返回 null。
 */
function inputType(schema: Record<string, unknown>): string | null {
  const alternatives: Record<string, unknown>[] = []
  if (Array.isArray(schema.anyOf)) {
    for (const value of schema.anyOf) {
      const alternative = record(value)
      if (alternative) alternatives.push(alternative)
    }
  }
  const candidates = [schema, ...alternatives]
  const supported = candidates
    .map((candidate) => candidate.type)
    .filter((value): value is string =>
      typeof value === 'string' && value !== 'null'
    )
  const unique = [...new Set(supported)]
  return unique.length === 1 && [
    'string',
    'number',
    'integer',
    'boolean',
    'array',
    'object'
  ].includes(unique[0]!)
    ? unique[0]!
    : null
}

/** 将未知值收窄为普通 JSON 对象；参数为候选值，返回对象或 null。 */
function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** 将未知值收窄为无重复字符串数组；参数为候选值，返回副本或 null。 */
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null
  }
  const result = value as string[]
  return new Set(result).size === result.length ? [...result] : null
}

/** 比较两个字符串集合；参数为左右数组，返回忽略顺序后的精确相等性。 */
function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}

/** 读取非空字符串；参数为候选值，返回裁剪值或 undefined。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 读取有限数字约束；参数为候选值，返回数字或 undefined。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

function draftDefaultValue(
  schema: DeviceActionInputSchema
): string | boolean {
  if (schema.type === 'boolean') return Boolean(schema.default)
  if (schema.type === 'object' || schema.type === 'array') {
    return JSON.stringify(schema.default)
  }
  return String(schema.default)
}

function parseField(
  name: string,
  schema: DeviceActionInputSchema,
  value: string | boolean
): unknown {
  const label = fieldLabel(name, schema)
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${label} 必须是布尔值`)
    return value
  }
  if (typeof value !== 'string') throw new Error(`${label} 的输入格式不正确`)
  if (schema.type === 'integer') {
    const parsed = Number(value)
    if (!Number.isInteger(parsed)) throw new Error(`${label} 必须是整数`)
    assertNumberRange(label, schema, parsed)
    return parsed
  }
  if (schema.type === 'number') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`${label} 必须是数字`)
    assertNumberRange(label, schema, parsed)
    return parsed
  }
  if (schema.type === 'array' || schema.type === 'object') {
    let parsed: unknown
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      throw new Error(`${label} 必须是有效 JSON`)
    }
    if (schema.type === 'array' && !Array.isArray(parsed)) {
      throw new Error(`${label} 必须是数组`)
    }
    if (
      schema.type === 'object' &&
      (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      throw new Error(`${label} 必须是对象`)
    }
    return parsed
  }
  return value
}

function assertNumberRange(
  label: string,
  schema: DeviceActionInputSchema,
  value: number
): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`${label} 不能小于 ${schema.minimum}`)
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new Error(`${label} 不能大于 ${schema.maximum}`)
  }
}

function fieldLabel(name: string, schema: DeviceActionInputSchema): string {
  return schema.title || name
}

function containsUnsupportedContract(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsupportedContract)
  if (!value || typeof value !== 'object') return value === 'ResourceSlot'
  const record = value as Record<string, unknown>
  if (
    record.$slot === 'ResourceSlot' ||
    record.editor_control === 'material_port' ||
    record.editor_control === 'site_selector' ||
    record.implicit_passthrough === true
  ) {
    return true
  }
  return Object.values(record).some(containsUnsupportedContract)
}
