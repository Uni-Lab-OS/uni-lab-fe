import type { DeviceActionPresentations } from './action-presentation'
import type { DeviceSummary } from './model'

/**
 * 设备显示名解析结果。调度时间线、时间计划等运行时事实只携带设备身份
 * （本地设备 ID 如 robot，或设备物料 UUID），显示名来自 OS 设备读模型与设备包展示元数据。
 */
export interface DeviceDisplayName {
  /** 调用方传入的原始设备身份，原样保留供提示与排障。 */
  readonly id: string
  /** 同一台设备的归并键：已知设备取物料 UUID（缺失时取本地 ID），未知设备为原始身份。 */
  readonly key: string
  /** 中文显示名；OS 未提供时回退为本地设备 ID，再回退为原始身份。 */
  readonly name: string
  /** true 表示 name 来自 OS 提供的显示名，而不是回退的设备身份。 */
  readonly known: boolean
  /** 同一设备的全部已知身份（本地 ID、设备键、物料 UUID），供提示原始 ID。 */
  readonly aliases: readonly string[]
}

export interface DeviceNameDirectory {
  resolve(id: string): DeviceDisplayName
}

interface DirectoryEntry {
  readonly key: string
  readonly localId: string | null
  readonly aliases: string[]
  name: string | null
}

/**
 * 从运行时事实建立设备显示名目录：
 * 1. OS 设备读模型（GET /api/v1/devices 的 material.name，或本地设备目录的 name）；
 * 2. 设备包展示元数据（GET /api/v1/device-action-presentations 的 devices[本地 ID].label）。
 * 前者是设备实例名，优先；后者补齐实例名缺失的设备。名称等于设备身份时不视为显示名。
 * 不内置任何设备包的名称表；两个来源都没有时由调用方显示原始身份。
 */
export function buildDeviceNameDirectory(input: {
  readonly devices?: readonly DeviceSummary[] | null
  readonly presentations?: DeviceActionPresentations | null
}): DeviceNameDirectory {
  const index = new Map<string, DirectoryEntry>()
  const claim = (entry: DirectoryEntry) => {
    for (const alias of entry.aliases) if (!index.has(alias)) index.set(alias, entry)
  }

  for (const device of input.devices ?? []) {
    const localId = clean(device.localDeviceId) ?? null
    const aliases = unique([localId, device.deviceKey, device.deviceUuid, device.materialUuid])
    if (aliases.length === 0) continue
    const existing = aliases.map((alias) => index.get(alias)).find(Boolean)
    const label = clean(device.label)
    const name = label && !aliases.includes(label) ? label : null
    if (existing) {
      for (const alias of aliases)
        if (!existing.aliases.includes(alias)) existing.aliases.push(alias)
      existing.name ??= name
      claim(existing)
      continue
    }
    claim({
      key: clean(device.deviceUuid) ?? clean(device.materialUuid) ?? localId ?? aliases[0]!,
      localId,
      aliases,
      name,
    })
  }

  for (const [deviceId, presentation] of Object.entries(input.presentations?.devices ?? {})) {
    const id = clean(deviceId)
    if (!id) continue
    const label = clean(presentation.label)
    const name = label && label !== id ? label : null
    const existing = index.get(id)
    if (existing) {
      existing.name ??= name
      continue
    }
    claim({ key: id, localId: id, aliases: [id], name })
  }

  return {
    resolve(raw: string): DeviceDisplayName {
      const id = clean(raw) ?? raw
      const entry = index.get(id)
      if (!entry) return { id: raw, key: id, name: id, known: false, aliases: id ? [id] : [] }
      return {
        id: raw,
        key: entry.key,
        name: entry.name ?? entry.localId ?? id,
        known: entry.name !== null,
        aliases: [...entry.aliases],
      }
    },
  }
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  const result: string[] = []
  for (const value of values) {
    const text = clean(value)
    if (text && !result.includes(text)) result.push(text)
  }
  return result
}
