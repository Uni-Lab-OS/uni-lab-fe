import type { DeviceCatalogItem, DeviceStatus } from '@unilab/services'

export function buildDeviceCardRuntimeState(
  device: DeviceCatalogItem,
  statusMap: ReadonlyMap<string, DeviceStatus>
): Record<string, unknown> {
  const live = statusMap.get(device.deviceId)?.status ?? {}

  return {
    ...live,
    online: device.online,
    actionBusy: Object.fromEntries(
      device.actions.map((action) => [action.actionName, action.isBusy])
    )
  }
}
