import type {
  DeviceCardBridge,
  DeviceCardDefinition
} from './contracts'

export function getDeviceCardBridge(): DeviceCardBridge {
  const bridge = globalThis.window?.unilabCard
  if (!bridge) {
    throw new Error(
      'Device Card Host 尚未注入。请通过 unilab-card dev 或 Electron 预览运行卡片。'
    )
  }
  return bridge
}

export function defineDeviceCard(
  definition: DeviceCardDefinition
): DeviceCardDefinition {
  return definition
}
