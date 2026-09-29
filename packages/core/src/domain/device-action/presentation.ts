import type { DeviceSummary } from './model'

export type DeviceOccupancyStatus = 'occupied' | 'idle' | 'unknown'
export type DeviceDispatchStatus = 'offline' | 'blocked' | 'available' | 'unknown'

export function deviceDispatchStatus(
  device: Pick<DeviceSummary, 'online' | 'dispatchable'>
): DeviceDispatchStatus {
  if (device.online === false) return 'offline'
  if (device.dispatchable === false) return 'blocked'
  if (device.online === true && device.dispatchable === true) return 'available'
  return 'unknown'
}

/**
 * 将设备动作与执行占用投影成可供场景展示的占用状态。
 *
 * realtime 占用记录优先；没有占用记录时，只有所有动作都明确报告 busy
 * 状态才能判定为空闲，否则保持未知。
 */
export function deviceOccupancyStatus(
  device: Pick<DeviceSummary, 'actions' | 'executionOccupancies'>
): DeviceOccupancyStatus {
  const hasOccupancy = (device.executionOccupancies?.length ?? 0) > 0 ||
    device.actions.some((action) => action.isBusy === true)
  if (hasOccupancy) return 'occupied'

  return device.actions.every((action) => action.busyStatusKnown)
    ? 'idle'
    : 'unknown'
}
