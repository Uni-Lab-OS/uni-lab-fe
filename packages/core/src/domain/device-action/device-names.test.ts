import { describe, expect, it } from 'vitest'
import { decodeDeviceActionPresentations } from './action-presentation'
import { decodeAuthoringDeviceCatalog, decodeDeviceList } from './codec'
import { buildDeviceNameDirectory } from './device-names'

const ROBOT_UUID = 'c4190b68-adb6-5c82-952f-f1ef5a37804b'
const PUMP_UUID = 'b2ef57a6-3ec3-5601-bda8-4ee1a26e9f18'

const osDevices = decodeDeviceList({
  code: 0,
  data: [
    {
      material: { uuid: ROBOT_UUID, resource_template_uuid: 'tpl-robot', name: '机械臂' },
      binding: { local_id: 'robot', edge_uuid: 'edge-1', name: 'robot' },
    },
    {
      // 物料没有名称时 label 回退为 local_id，不能当作显示名。
      material: { uuid: PUMP_UUID, resource_template_uuid: 'tpl-pump' },
      binding: { local_id: 'pump', edge_uuid: 'edge-1' },
    },
  ],
})

const categories = Object.fromEntries(
  ['read', 'compute', 'actuate', 'configure', 'safety', 'debug', 'flow', 'hook'].map((key) => [
    key,
    { label: key },
  ]),
)
const presentations = decodeDeviceActionPresentations({
  version: 1,
  categories,
  devices: {
    pump: { label: '真空泵', actions: {} },
    rail: { label: '地轨', actions: {} },
    vision: { label: 'vision', actions: {} },
  },
})

describe('buildDeviceNameDirectory', () => {
  it('resolves local device ids and material UUIDs to the OS material name', () => {
    const directory = buildDeviceNameDirectory({ devices: osDevices })
    expect(directory.resolve('robot')).toMatchObject({
      id: 'robot',
      key: ROBOT_UUID,
      name: '机械臂',
      known: true,
    })
    expect(directory.resolve(ROBOT_UUID)).toMatchObject({ key: ROBOT_UUID, name: '机械臂' })
    expect(directory.resolve('robot').aliases).toEqual(['robot', ROBOT_UUID])
  })

  it('fills missing instance names from device package presentation labels', () => {
    const directory = buildDeviceNameDirectory({ devices: osDevices, presentations })
    // pump 的物料无名称，展示元数据补上；按 UUID 查询同样得到中文名并归并到同一设备。
    expect(directory.resolve('pump')).toMatchObject({ key: PUMP_UUID, name: '真空泵', known: true })
    expect(directory.resolve(PUMP_UUID)).toMatchObject({ key: PUMP_UUID, name: '真空泵' })
    // 只出现在展示元数据中的设备也能解析。
    expect(directory.resolve('rail')).toMatchObject({ key: 'rail', name: '地轨', known: true })
  })

  it('falls back to the local id or the raw id when OS provides no display name', () => {
    const directory = buildDeviceNameDirectory({ devices: osDevices, presentations })
    expect(directory.resolve('vision')).toMatchObject({ name: 'vision', known: false })
    expect(directory.resolve('staging_a')).toEqual({
      id: 'staging_a',
      key: 'staging_a',
      name: 'staging_a',
      known: false,
      aliases: ['staging_a'],
    })
    // 只知道 UUID 与本地 ID、没有中文名时，显示本地 ID 而不是 UUID。
    const bare = buildDeviceNameDirectory({ devices: osDevices })
    expect(bare.resolve(PUMP_UUID)).toMatchObject({ name: 'pump', known: false, key: PUMP_UUID })
    expect(buildDeviceNameDirectory({}).resolve('robot')).toMatchObject({ name: 'robot' })
  })

  it('reads names from the local authoring device catalog fallback', () => {
    const devices = decodeAuthoringDeviceCatalog({
      code: 0,
      data: {
        items: [
          {
            id: 'photoscrape',
            materialUuid: '1b1208c9-df79-5caa-b35d-3f3aa74e5785',
            deviceKey: '/devices/photoscrape/photoscrape',
            name: '拍照与刮板工位',
            actions: [],
          },
        ],
      },
    })
    const directory = buildDeviceNameDirectory({ devices })
    expect(directory.resolve('photoscrape')).toMatchObject({
      name: '拍照与刮板工位',
      key: '1b1208c9-df79-5caa-b35d-3f3aa74e5785',
      known: true,
    })
  })
})
