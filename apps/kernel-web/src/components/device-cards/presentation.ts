import type { DeviceCatalogItem } from '@unilab/services'

export function deviceInstanceOptionLabel(
  device: Pick<DeviceCatalogItem, 'deviceId' | 'label' | 'online'>
): string {
  const deviceId = device.deviceId.trim()
  const label = device.label.trim()
  const identity = deviceId || '缺少 Device ID'
  const location = label && label !== deviceId ? `${label}，` : ''
  return `${identity}（${location}${device.online ? '在线' : '离线'}）`
}
