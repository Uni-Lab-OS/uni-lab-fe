import type { ActionDefinition } from './model'

export interface DeviceActionParameter {
  readonly name: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly required: boolean
  readonly title: string
  readonly description?: string
  readonly defaultValue?: unknown
}

/** 将设备包的 action schema 与 handles 合并为稳定的表单参数顺序。 */
export function deviceActionParameters(
  definition?: ActionDefinition
): readonly DeviceActionParameter[] {
  if (!definition) return []
  return buildDeviceActionParameters(
    definition.schema,
    definition.goalDefault,
    definition.handles.filter(
      (handle) => handle.ioType === 'target' && handle.dataSource === 'goal'
    )
  )
}

/** 设备目录没有对应 workflow-node-template 时，使用设备包下发的 inputSchema。 */
export function deviceActionParametersFromSchema(
  schema: Readonly<Record<string, unknown>>
): readonly DeviceActionParameter[] {
  return buildDeviceActionParameters(schema, {}, [])
}

function buildDeviceActionParameters(
  schema: Readonly<Record<string, unknown>>,
  goalDefault: Readonly<Record<string, unknown>>,
  handles: readonly {
    readonly handleKey: string
    readonly displayName: string
    readonly required: boolean
    readonly valueSchema: Readonly<Record<string, unknown>>
  }[]
): readonly DeviceActionParameter[] {
  const properties = asRecord(schema.properties) ?? {}
  const required = new Set(stringArray(schema.required))
  const orderedNames = [
    ...handles.map((handle) => handle.handleKey),
    ...Object.keys(properties)
  ].filter((name, index, names) => names.indexOf(name) === index)

  return orderedNames.map((name) => {
    const handle = handles.find((item) => item.handleKey === name)
    const parameterSchema = {
      ...(handle?.valueSchema ?? {}),
      ...(asRecord(properties[name]) ?? {})
    }
    const defaultValue = Object.prototype.hasOwnProperty.call(goalDefault, name)
      ? goalDefault[name]
      : parameterSchema.default
    return {
      name,
      schema: parameterSchema,
      required: required.has(name) || handle?.required === true,
      title: stringValue(parameterSchema.title) ?? handle?.displayName ?? name,
      description: stringValue(parameterSchema.description),
      ...(defaultValue !== undefined ? { defaultValue } : {})
    }
  })
}

export function deviceActionDefaults(
  parameters: readonly DeviceActionParameter[]
): Record<string, unknown> {
  return Object.fromEntries(
    parameters
      .filter((parameter) => parameter.defaultValue !== undefined)
      .map((parameter) => [
        parameter.name,
        formValue(parameter, parameter.defaultValue)
      ])
  )
}

/** 将表单值还原成 OS action run 所需的 goal 对象。 */
export function normalizeDeviceActionParameters(
  values: Readonly<Record<string, unknown>>,
  parameters: readonly DeviceActionParameter[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const parameter of parameters) {
    if (!Object.prototype.hasOwnProperty.call(values, parameter.name)) {
      if (parameter.required) throw new Error('请输入' + parameter.title)
      continue
    }
    const value = values[parameter.name]
    if (value === undefined || value === null || value === '') {
      if (parameter.required) throw new Error('请输入' + parameter.title)
      continue
    }
    if (isDeviceActionResourceParameter(parameter)) {
      result[parameter.name] =
        typeof value === 'string' ? { uuid: value.trim() } : value
      continue
    }
    if (isDeviceActionStructuredParameter(parameter)) {
      if (typeof value !== 'string') {
        result[parameter.name] = value
        continue
      }
      try {
        result[parameter.name] = JSON.parse(value) as unknown
      } catch {
        throw new Error('参数“' + parameter.title + '”必须是合法 JSON')
      }
      continue
    }
    result[parameter.name] = value
  }
  return result
}

export function isDeviceActionResourceParameter(
  parameter: DeviceActionParameter
): boolean {
  return (
    parameter.schema.$slot === 'ResourceSlot' ||
    parameter.schema['x-unilabos-material-lock'] === true
  )
}

export function isDeviceActionStructuredParameter(
  parameter: DeviceActionParameter
): boolean {
  const type = schemaType(parameter.schema)
  return type === 'object' || type === 'array'
}

function formValue(
  parameter: DeviceActionParameter,
  value: unknown
): unknown {
  if (isDeviceActionResourceParameter(parameter)) {
    const record = asRecord(value)
    return record && typeof record.uuid === 'string' ? record.uuid : value
  }
  if (
    isDeviceActionStructuredParameter(parameter) &&
    typeof value === 'object' &&
    value !== null
  ) {
    return JSON.stringify(value, null, 2)
  }
  return value
}

function schemaType(
  schema: Readonly<Record<string, unknown>>
): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) {
    return schema.type.find(
      (item): item is string =>
        typeof item === 'string' && item !== 'null'
    )
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
