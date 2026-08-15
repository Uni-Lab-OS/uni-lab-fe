import type { OnlineDevice } from '@unilab/services'

export interface ManagedDevice extends OnlineDevice {
  displayName: string
  displayDetail: string
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
    .map((device) => ({
      ...device,
      displayName: device.machineName,
      displayDetail: ''
    }))
}
