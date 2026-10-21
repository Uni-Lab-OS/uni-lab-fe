import { useMemo } from 'react'
import {
  buildDeviceActionLabelDirectory,
  buildDeviceNameDirectory,
  type DeviceActionLabelDirectory,
  type DeviceNameDirectory,
} from '@unilab-fe/core'
import { useBackendQuery } from './useBackendQuery'
import { useDeviceActionPresentations } from './useDeviceActionPresentations'

export interface DeviceDirectory {
  /** 设备显示名（OS 设备读模型实例名，缺失时用设备包展示元数据）。 */
  readonly names: DeviceNameDirectory
  /** 设备动作中文名（设备包展示元数据，缺失时用 OS 设备读模型的动作标签）。 */
  readonly actions: DeviceActionLabelDirectory
}

/**
 * 设备与设备动作的显示名目录：OS 设备读模型（与设备页共用 devices 查询缓存）加设备包展示元数据
 * （与设备详情页共用缓存）。读取失败或尚未返回时目录为空，调用方显示原始设备身份与动作名，
 * 不阻塞页面。
 */
export function useDeviceDirectory(): DeviceDirectory {
  const devices = useBackendQuery('devices', (backend) => backend.core.deviceActions.listDevices())
  const { presentations } = useDeviceActionPresentations()
  return useMemo(() => {
    const names = buildDeviceNameDirectory({ devices: devices.data, presentations })
    const actions = buildDeviceActionLabelDirectory({
      devices: devices.data,
      presentations,
      deviceNames: names,
    })
    return { names, actions }
  }, [devices.data, presentations])
}

/** 只需要设备显示名时使用；与 useDeviceDirectory 共用同一批查询。 */
export function useDeviceNames(): DeviceNameDirectory {
  return useDeviceDirectory().names
}
