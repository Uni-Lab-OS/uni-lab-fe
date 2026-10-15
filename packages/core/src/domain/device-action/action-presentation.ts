import { DeviceActionError } from './errors'
import type { DeviceActionParameter } from './parameters'

/**
 * 设备动作展示元数据：由设备包随 OS 控制台提供（能力 deviceAction.presentation）。
 * 只影响表单、分组与结果展示，不改变下发的参数名与动作合同；缺失时回退 OS Schema。
 */
export type DeviceActionCategory =
  | 'read'
  | 'compute'
  | 'actuate'
  | 'configure'
  | 'safety'
  | 'debug'
  | 'flow'
  | 'hook'

/** 设备页分组顺序：先查看，再驱动；流程辅助与资源钩子最后且默认收起。 */
export const DEVICE_ACTION_CATEGORY_ORDER: readonly DeviceActionCategory[] = [
  'read',
  'actuate',
  'configure',
  'compute',
  'safety',
  'debug',
  'flow',
  'hook',
]

export interface DeviceActionCategoryInfo {
  readonly label: string
  /** 下发前须二次确认（驱动机构、写参数、停止、调试）。 */
  readonly confirm: boolean
  /** false 表示由流程调用，不建议从设备页手动下发。 */
  readonly manual: boolean
}

export interface DeviceActionOption {
  readonly value: unknown
  readonly label: string
}

export interface DeviceActionParameterPresentation {
  readonly name: string
  readonly label: string
  readonly type: string
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly options: readonly DeviceActionOption[]
  readonly minimum?: number
  readonly maximum?: number
  readonly unit: string
  readonly help: string
}

export interface DeviceActionResultField {
  readonly name: string
  readonly label: string
  readonly type: string
}

export interface DeviceActionPresentation {
  readonly ref: string
  readonly label: string
  readonly hint: string
  readonly desc: string
  readonly kind: string
  readonly station: string
  readonly actionCode: number
  readonly plcLink: string
  readonly modes: readonly string[]
  readonly category: DeviceActionCategory
  readonly confirm: boolean
  readonly manual: boolean
  readonly executable: boolean
  readonly params: readonly DeviceActionParameterPresentation[]
  readonly resultFields: readonly DeviceActionResultField[]
}

export interface DeviceActionDevicePresentation {
  readonly label: string
  readonly actions: Readonly<Record<string, DeviceActionPresentation>>
}

export interface DeviceActionPresentations {
  readonly version: number
  readonly controlMode: string
  readonly categories: Readonly<Record<DeviceActionCategory, DeviceActionCategoryInfo>>
  readonly devices: Readonly<Record<string, DeviceActionDevicePresentation>>
}

const CATEGORIES = new Set<string>(DEVICE_ACTION_CATEGORY_ORDER)

/** 解析设备包返回的展示元数据；形状不符时整体拒绝，避免半解析的元数据误导操作员。 */
export function decodeDeviceActionPresentations(value: unknown): DeviceActionPresentations {
  const payload = record(value, 'presentation')
  const version = payload.version
  if (version !== 1) {
    throw invalid(`不支持的动作展示元数据版本：${String(version)}`)
  }
  const categoriesRaw = record(payload.categories, 'presentation.categories')
  const categories = {} as Record<DeviceActionCategory, DeviceActionCategoryInfo>
  for (const key of DEVICE_ACTION_CATEGORY_ORDER) {
    const info = record(categoriesRaw[key], `presentation.categories.${key}`)
    categories[key] = {
      label: text(info.label, `categories.${key}.label`),
      confirm: info.confirm === true,
      manual: info.manual !== false,
    }
  }
  const devicesRaw = record(payload.devices, 'presentation.devices')
  const devices: Record<string, DeviceActionDevicePresentation> = {}
  for (const [deviceKey, deviceRaw] of Object.entries(devicesRaw)) {
    const device = record(deviceRaw, `devices.${deviceKey}`)
    const actionsRaw = record(device.actions, `devices.${deviceKey}.actions`)
    const actions: Record<string, DeviceActionPresentation> = {}
    for (const [actionName, actionRaw] of Object.entries(actionsRaw)) {
      actions[actionName] = decodeAction(actionRaw, `${deviceKey}.${actionName}`)
    }
    devices[deviceKey] = { label: optionalText(device.label) ?? deviceKey, actions }
  }
  return {
    version,
    controlMode: optionalText(payload.control_mode) ?? '',
    categories,
    devices,
  }
}

export function findActionPresentation(
  presentations: DeviceActionPresentations | undefined,
  deviceKey: string,
  actionName: string,
): DeviceActionPresentation | undefined {
  return presentations?.devices[deviceKey]?.actions[actionName]
}

/**
 * 把展示元数据并入 OS Schema 推导出的参数：标题、说明、范围、枚举与默认值。
 * 参数集合与顺序仍以 OS Schema 为准（即实际下发的参数），元数据只补充展示信息。
 */
export function applyActionPresentation(
  parameters: readonly DeviceActionParameter[],
  presentation: DeviceActionPresentation | undefined,
): readonly DeviceActionParameter[] {
  if (!presentation) return parameters
  const byName = new Map(presentation.params.map((param) => [param.name, param]))
  return parameters.map((parameter) => {
    const meta = byName.get(parameter.name)
    if (!meta) return parameter
    const schema: Record<string, unknown> = { ...parameter.schema, title: meta.label }
    if (meta.minimum !== undefined) schema.minimum = meta.minimum
    if (meta.maximum !== undefined) schema.maximum = meta.maximum
    if (meta.unit) schema['x-unit'] = meta.unit
    if (meta.options.length) {
      schema.enum = meta.options.map((option) => option.value)
      schema['x-enum-labels'] = meta.options.map((option) => option.label)
    }
    const description = [meta.help, meta.unit && !meta.help.includes(meta.unit) ? `单位：${meta.unit}` : '']
      .filter(Boolean)
      .join('；')
    const defaultValue =
      parameter.defaultValue !== undefined ? parameter.defaultValue : meta.defaultValue
    return {
      ...parameter,
      schema,
      title: meta.label,
      ...(description || parameter.description
        ? { description: description || parameter.description }
        : {}),
      ...(defaultValue !== undefined && defaultValue !== null ? { defaultValue } : {}),
    }
  })
}

export interface DeviceActionResultEntry {
  readonly name: string
  readonly label: string
  readonly value: unknown
}

/** 按元数据的字段顺序与中文名展示返回值；未声明的字段追加在后并保留原名。 */
export function describeActionResult(
  returnInfo: Readonly<Record<string, unknown>> | undefined,
  presentation: DeviceActionPresentation | undefined,
): readonly DeviceActionResultEntry[] {
  if (!returnInfo) return []
  const declared = presentation?.resultFields ?? []
  const entries: DeviceActionResultEntry[] = declared
    .filter((field) => Object.prototype.hasOwnProperty.call(returnInfo, field.name))
    .map((field) => ({ name: field.name, label: field.label, value: returnInfo[field.name] }))
  const seen = new Set(entries.map((entry) => entry.name))
  for (const [name, value] of Object.entries(returnInfo)) {
    if (!seen.has(name)) entries.push({ name, label: name, value })
  }
  return entries
}

export interface DeviceActionGroup<T> {
  readonly category: DeviceActionCategory
  readonly info: DeviceActionCategoryInfo
  readonly actions: readonly T[]
}

/** 按类别分组设备动作；没有元数据的动作归入“驱动机构”，按最保守的方式确认。 */
export function groupActionsByCategory<T extends { readonly actionName: string }>(
  actions: readonly T[],
  presentations: DeviceActionPresentations,
  deviceKey: string,
): readonly DeviceActionGroup<T>[] {
  const buckets = new Map<DeviceActionCategory, T[]>()
  for (const action of actions) {
    const category =
      findActionPresentation(presentations, deviceKey, action.actionName)?.category ?? 'actuate'
    buckets.set(category, [...(buckets.get(category) ?? []), action])
  }
  return DEVICE_ACTION_CATEGORY_ORDER.filter((category) => buckets.has(category)).map(
    (category) => ({
      category,
      info: presentations.categories[category],
      actions: buckets.get(category)!,
    }),
  )
}

function decodeAction(value: unknown, path: string): DeviceActionPresentation {
  const action = record(value, path)
  const category = text(action.category, `${path}.category`)
  if (!CATEGORIES.has(category)) throw invalid(`${path} 的类别未知：${category}`)
  return {
    ref: text(action.ref, `${path}.ref`),
    label: text(action.label, `${path}.label`),
    hint: optionalText(action.hint) ?? '',
    desc: optionalText(action.desc) ?? '',
    kind: optionalText(action.kind) ?? '',
    station: optionalText(action.station) ?? '',
    actionCode: typeof action.action_code === 'number' ? action.action_code : 0,
    plcLink: optionalText(action.plc_link) ?? '',
    modes: Array.isArray(action.modes) ? action.modes.filter(isString) : [],
    category: category as DeviceActionCategory,
    confirm: action.confirm === true,
    manual: action.manual !== false,
    executable: action.executable !== false,
    params: list(action.params, `${path}.params`).map((item, index) =>
      decodeParam(item, `${path}.params[${index}]`),
    ),
    resultFields: list(action.result_fields, `${path}.result_fields`).map((item, index) => {
      const field = record(item, `${path}.result_fields[${index}]`)
      return {
        name: text(field.name, `${path}.result_fields[${index}].name`),
        label: optionalText(field.label) ?? text(field.name, 'name'),
        type: optionalText(field.type) ?? '',
      }
    }),
  }
}

function decodeParam(value: unknown, path: string): DeviceActionParameterPresentation {
  const param = record(value, path)
  const name = text(param.name, `${path}.name`)
  const options = Array.isArray(param.options)
    ? param.options.map((item, index) => {
        const option = record(item, `${path}.options[${index}]`)
        return { value: option.value, label: optionalText(option.label) ?? String(option.value) }
      })
    : []
  return {
    name,
    label: optionalText(param.label) ?? name,
    type: optionalText(param.type) ?? 'string',
    required: param.required === true,
    ...(param.default !== undefined && param.default !== null ? { defaultValue: param.default } : {}),
    options,
    ...(typeof param.minimum === 'number' ? { minimum: param.minimum } : {}),
    ...(typeof param.maximum === 'number' ? { maximum: param.maximum } : {}),
    unit: optionalText(param.unit) ?? '',
    help: optionalText(param.help) ?? '',
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${path} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function list(value: unknown, path: string): readonly unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw invalid(`${path} 必须是数组`)
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${path} 必须是非空字符串`)
  return value
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function invalid(message: string): DeviceActionError {
  return new DeviceActionError('INVALID_DEVICE_CATALOG', `设备动作展示元数据无效：${message}`)
}
