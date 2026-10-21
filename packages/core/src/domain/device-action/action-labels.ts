import type { DeviceActionPresentations } from './action-presentation'
import { buildDeviceNameDirectory, type DeviceNameDirectory } from './device-names'
import type { DeviceSummary } from './model'

/**
 * 设备动作显示名解析结果。调度时间线、时间计划、作业等运行时事实只携带设备身份与动作名
 * （如 robot / move_to_point），中文名来自设备包展示元数据与 OS 设备读模型。
 */
export interface DeviceActionDisplayLabel {
  /** 去掉设备前缀后的动作名（如 move_to_point）；调用方未给动作名时为空串。 */
  readonly actionName: string
  /**
   * 动作引用，供提示与排障：展示元数据的 ref（如 robot.move_to_point），否则为“设备.动作”，
   * 不知道设备时为动作名。
   */
  readonly ref: string
  /** 中文名；运行时事实未提供时回退为动作名。 */
  readonly label: string
  /** true 表示 label 来自运行时事实，而不是回退的动作名。 */
  readonly known: boolean
}

export interface DeviceActionLabelDirectory {
  /**
   * deviceId 可以是本地设备 ID（robot）、设备键或设备/物料 UUID；actionName 可以是动作名，
   * 也可以带设备前缀（robot.move_to_point、/devices/robot/move_to_point）。不知道设备时，
   * 只有各设备上同名动作的中文名一致才采用，否则回退动作名。
   */
  resolve(deviceId: string | null | undefined, actionName: string): DeviceActionDisplayLabel
}

interface ActionEntry {
  readonly label: string | null
  readonly ref: string
}

/**
 * 从运行时事实建立设备动作显示名目录：
 * 1. 设备包展示元数据（GET /api/v1/device-action-presentations 的
 *    devices[本地 ID].actions[动作].label，profile 声明 deviceAction.presentation 时提供）；
 * 2. OS 设备读模型的动作标签（DeviceSummary.actions[].label）。
 * 设备身份按设备名目录归并（本地 ID 与物料 UUID 视为同一设备）。标签等于动作名或动作引用时
 * 不视为显示名。不内置任何设备包的动作名表；都没有时回退为动作名。
 */
export function buildDeviceActionLabelDirectory(input: {
  readonly devices?: readonly DeviceSummary[] | null
  readonly presentations?: DeviceActionPresentations | null
  /** 已建好的设备名目录（须与本目录同源）；缺省时按同样的输入新建。 */
  readonly deviceNames?: Pick<DeviceNameDirectory, 'resolve'>
}): DeviceActionLabelDirectory {
  const deviceNames = input.deviceNames ?? buildDeviceNameDirectory(input)
  const index = new Map<string, Map<string, ActionEntry>>()
  const add = (
    deviceId: string,
    actionName: string,
    label: string | undefined,
    ref: string | undefined,
  ) => {
    const action = clean(actionName)
    if (!action) return
    const key = deviceNames.resolve(deviceId).key
    const actions = index.get(key) ?? new Map<string, ActionEntry>()
    index.set(key, actions)
    const actionRef = clean(ref) ?? `${deviceId}.${action}`
    const text = clean(label)
    const name = text && text !== action && text !== actionRef ? text : null
    const existing = actions.get(action)
    if (!existing) actions.set(action, { label: name, ref: actionRef })
    else if (existing.label === null && name) actions.set(action, { ...existing, label: name })
  }

  for (const [rawDevice, device] of Object.entries(input.presentations?.devices ?? {})) {
    const deviceId = clean(rawDevice)
    if (!deviceId) continue
    for (const [actionName, presentation] of Object.entries(device.actions)) {
      add(deviceId, actionName, presentation.label, presentation.ref)
    }
  }
  for (const device of input.devices ?? []) {
    const deviceId =
      clean(device.localDeviceId) ?? clean(device.deviceUuid) ?? clean(device.materialUuid)
    if (!deviceId) continue
    for (const action of device.actions) {
      add(deviceId, action.actionName, action.label, action.actionRef)
    }
  }

  const sameDevice = (left: string, right: string) =>
    left === right || deviceNames.resolve(left).key === deviceNames.resolve(right).key

  /** 不知道设备时：只有全部设备上同名动作的中文名一致（或只有一台设备有该动作）才采用。 */
  const anyDevice = (actionName: string): ActionEntry | undefined => {
    const found = [...index.values()]
      .map((actions) => actions.get(actionName))
      .filter((entry): entry is ActionEntry => entry !== undefined)
    const labels = new Set(found.map((entry) => entry.label))
    if (found.length === 0 || labels.size !== 1) return undefined
    return { label: found[0]!.label, ref: found.length === 1 ? found[0]!.ref : actionName }
  }

  return {
    resolve(rawDevice, rawAction) {
      const { deviceId, actionName } = splitActionName(rawDevice, rawAction, sameDevice)
      if (!actionName) return { actionName: '', ref: '', label: '', known: false }
      const device = deviceId ? deviceNames.resolve(deviceId) : null
      const entry = device ? index.get(device.key)?.get(actionName) : anyDevice(actionName)
      const prefix = device ? (device.aliases[0] ?? deviceId) : null
      const ref = entry?.ref ?? (prefix ? `${prefix}.${actionName}` : actionName)
      return entry?.label
        ? { actionName, ref, label: entry.label, known: true }
        : { actionName, ref, label: actionName, known: false }
    },
  }
}

export type NodeActionLabelSource = 'node' | 'action' | 'action_name' | 'placeholder'

export interface NodeActionLabel {
  /** 展示文字。 */
  readonly text: string
  readonly source: NodeActionLabelSource
  /** 原始动作引用（如 robot.move_to_point）；不知道动作时为 null。供提示与排障。 */
  readonly actionRef: string | null
}

/**
 * 节点/作业的展示名，按以下顺序取第一个可用的：
 * 1. 有意义的节点名（不只是原始动作名，例如作者写的中文标题）；
 * 2. 设备动作中文名（运行时事实）；
 * 3. 原始动作名；
 * 4. 调用方给的可读占位（如“待执行节点”）。
 * 节点名等于动作名或动作引用，或本身就是该设备上已知的动作时，视为原始动作名。
 * 计划条、摘要投影没有单独的动作名，节点名（OS 缺省取动作名）可直接按设备解析。
 */
export function resolveNodeActionLabel(
  facts: {
    readonly nodeName?: string | null
    readonly actionName?: string | null
    readonly deviceId?: string | null
  },
  actions: Pick<DeviceActionLabelDirectory, 'resolve'> | undefined,
  placeholder: string,
): NodeActionLabel {
  const nodeName = clean(facts.nodeName)
  const actionName = clean(facts.actionName)
  const lookup = (name: string): DeviceActionDisplayLabel => {
    if (actions) return actions.resolve(facts.deviceId, name)
    const split = splitActionName(facts.deviceId, name, (left, right) => left === right)
    const ref = split.deviceId ? `${split.deviceId}.${split.actionName}` : split.actionName
    return { actionName: split.actionName, ref, label: split.actionName, known: false }
  }
  const byAction = actionName ? lookup(actionName) : null
  const byName = nodeName ? lookup(nodeName) : null
  const rawName =
    byName !== null &&
    (byName.known ||
      (byAction !== null &&
        (nodeName === actionName ||
          nodeName === byAction.ref ||
          byName.actionName === byAction.actionName)))
  if (nodeName && !rawName) {
    return { text: nodeName, source: 'node', actionRef: byAction?.ref ?? null }
  }
  if (byAction?.known) return { text: byAction.label, source: 'action', actionRef: byAction.ref }
  if (byName?.known) return { text: byName.label, source: 'action', actionRef: byName.ref }
  if (byAction) return { text: byAction.label, source: 'action_name', actionRef: byAction.ref }
  if (byName) return { text: nodeName!, source: 'action_name', actionRef: byName.ref }
  return { text: placeholder, source: 'placeholder', actionRef: null }
}

/**
 * 拆出动作名：/devices/<设备>/<动作>（调度器的 device_action_key）或 <设备>.<动作>（动作引用）。
 * 点号前缀只有与给定设备是同一设备（或未给设备）时才当作设备，避免误拆带点的名称。
 */
function splitActionName(
  rawDevice: string | null | undefined,
  rawAction: string,
  sameDevice: (left: string, right: string) => boolean,
): { deviceId: string | null; actionName: string } {
  const device = clean(rawDevice) ?? null
  const action = clean(rawAction) ?? ''
  const path = /^\/?devices\/([^/]+)\/([^/]+)$/.exec(action)
  if (path) return { deviceId: device ?? path[1]!, actionName: path[2]! }
  const dot = action.indexOf('.')
  if (dot > 0 && dot < action.length - 1) {
    const prefix = action.slice(0, dot)
    if (device === null || sameDevice(device, prefix)) {
      return { deviceId: device ?? prefix, actionName: action.slice(dot + 1) }
    }
  }
  return { deviceId: device, actionName: action }
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
