import type { DeviceCatalogItem } from '@unilab/services'

export function deviceInstanceOptionLabel(
  device: Pick<DeviceCatalogItem, 'deviceId' | 'label' | 'online'>
): string {
  const deviceId = device.deviceId.trim()
  const label = device.label.trim()
  const identity = label && label !== deviceId
    ? `${label} · ${deviceId || '缺少 Device ID'}`
    : deviceId || label || '缺少 Device ID'
  return `${identity} · ${device.online ? '在线' : '离线'}`
}
