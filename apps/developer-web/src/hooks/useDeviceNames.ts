import { useMemo } from 'react'
import { buildDeviceNameDirectory, type DeviceNameDirectory } from '@unilab-fe/core'
import { useBackendQuery } from './useBackendQuery'
import { useDeviceActionPresentations } from './useDeviceActionPresentations'

/**
 * 设备显示名目录：OS 设备读模型（与设备页共用 devices 查询缓存）加设备包展示元数据。
 * 读取失败或尚未返回时目录为空，调用方显示原始设备身份，不阻塞页面。
 */
export function useDeviceNames(): DeviceNameDirectory {
  const devices = useBackendQuery('devices', (backend) => backend.core.deviceActions.listDevices())
  const { presentations } = useDeviceActionPresentations()
  return useMemo(
    () => buildDeviceNameDirectory({ devices: devices.data, presentations }),
    [devices.data, presentations],
  )
}
