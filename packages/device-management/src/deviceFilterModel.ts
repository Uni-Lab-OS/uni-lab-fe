import type { ManagedDevice } from './deviceCatalog'

export interface DeviceFilters {
  query: string
  status: 'all' | ManagedDevice['edgeStatus']
  lock: 'all' | 'locked' | 'unlocked'
}

/** 在完整目录上组合检索和状态筛选；未知锁状态不能当作未锁定。 */
export function filterDevices(
  devices: readonly ManagedDevice[],
  filters: DeviceFilters,
  lockedDeviceIds: ReadonlySet<string> | null
): ManagedDevice[] {
  const terms = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return devices.filter((device) => {
    if (filters.status !== 'all' && device.edgeStatus !== filters.status) return false
    if (filters.lock !== 'all') {
      if (lockedDeviceIds === null) return false
      if (lockedDeviceIds.has(device.id) !== (filters.lock === 'locked')) return false
    }
    const text = [
      device.displayName, device.machineName, device.deviceKey, device.id,
      ...device.actions.flatMap((action) => [action.actionName, action.displayName, action.label])
    ].join(' ').toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  })
}
