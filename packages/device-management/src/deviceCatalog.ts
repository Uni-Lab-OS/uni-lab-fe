import type {
  DeviceEdgeStatus,
  DeviceExecutionOccupancy,
  OnlineDevice
} from '@unilab/services'

export interface ManagedDevice extends OnlineDevice {
  edgeStatus: DeviceEdgeStatus
  dispatchable: boolean
  dispatchBlockReason: string | null
  executionOccupancies: DeviceExecutionOccupancy[] | null
  displayName: string
  displayDetail: string
}

const UNKNOWN_COMMAND_PREFIX = 'unresolved_unknown_command:'

/**
 * 从现有派发阻断原因中读取设备明确声明的未知终态（UNKNOWN）命令身份。
 *
 * @param reason 设备目录现有的 `dispatchBlockReason` 值。
 * @returns 去重后的命令身份；其他阻断原因返回空数组。
 * @throws 不抛出异常；空片段被忽略，原始 wire 值不会被修改。
 */
export function unresolvedUnknownCommandIds(reason: string | null): string[] {
  if (!reason?.startsWith(UNKNOWN_COMMAND_PREFIX)) return []
  return Array.from(new Set(
    reason.slice(UNKNOWN_COMMAND_PREFIX.length)
      .split(',')
      .map((commandId) => commandId.trim())
      .filter((commandId) => commandId.startsWith('workflow-node-job:'))
  ))
}

/**
 * 解析通用动作页当前设备；保留用户选择，否则优先使用定制卡片匹配设备。
 */
export function preferredManagedDevice(
  devices: readonly ManagedDevice[],
  selectedDeviceId: string | null,
  preferredDeviceId?: string
): ManagedDevice | null {
  return devices.find((device) => device.id === selectedDeviceId)
    ?? devices.find((device) => device.id === preferredDeviceId)
    ?? devices[0]
    ?? null
}

/**
 * 把 Edge 目录转换为仪器设备菜单模型，并排除仅供系统调度的宿主节点。
 *
 * @param edgeDevices Edge 实时返回的设备目录。
 * @returns 保留设备身份和在线状态的可展示仪器设备列表。
 * @throws 不抛出异常。
 * @safety 只执行内存映射，不修改设备状态或发送动作。
 */
export function presentEdgeDevices(
  edgeDevices: readonly OnlineDevice[]
): ManagedDevice[] {
  return edgeDevices
    .filter((device) => (
      device.id !== 'host_node' &&
      device.deviceKey !== 'host_node' &&
      !device.deviceKey.endsWith('/host_node')
    ))
    .map((device) => {
      const edgeStatus = device.edgeStatus ?? (
        device.online ? 'online' : 'offline'
      )
      return {
        ...device,
        online: edgeStatus === 'online',
        edgeStatus,
        dispatchable: device.dispatchable ?? device.online,
        dispatchBlockReason: device.dispatchBlockReason ?? null,
        executionOccupancies: device.executionOccupancies ?? null,
        displayName: device.machineName,
        displayDetail: ''
      }
    })
}
