import type {
  DeviceCardJointPreviewFrame,
  DeviceCardRuntimeSnapshot
} from '@unilab/device-card-sdk'

/**
 * 把卡片输入约束为当前 Mock Material 的完整 SI 关节快照。
 * 该函数不发送设备命令，也不接受卡片指定目标 Material。
 */
export function createDeviceCardJointPreview(
  context: DeviceCardRuntimeSnapshot,
  input: unknown,
  now = Date.now()
): DeviceCardJointPreviewFrame {
  if (context.mode !== 'mock') {
    throw new Error('Live 模式禁止写入本地关节预览。')
  }
  const materialId = context.device.materialId?.trim()
  if (!materialId) {
    throw new Error('当前卡片没有可预览的 Material 实例。')
  }
  if (!isRecord(input)) throw new Error('关节预览必须是对象。')
  const entries = Object.entries(input)
  if (entries.length === 0) throw new Error('关节预览不能为空。')
  if (entries.length > 128) throw new Error('关节预览最多包含 128 个关节。')
  const jointStates = Object.fromEntries(entries.map(([rawName, rawValue]) => {
    const name = rawName.trim()
    if (!name || name.length > 200) throw new Error('关节名无效。')
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
      throw new Error(`关节 ${name} 的数值无效。`)
    }
    if (Math.abs(rawValue) > 1_000_000) {
      throw new Error(`关节 ${name} 的数值超出预览范围。`)
    }
    return [name, rawValue]
  }))
  return {
    materialId,
    jointStates,
    updatedAt: now
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
