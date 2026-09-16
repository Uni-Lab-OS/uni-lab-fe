import { describe, expect, it } from 'vitest'
import { presentEdgeDevices } from './deviceCatalog'
import { filterDevices, type DeviceFilters } from './deviceFilterModel'

const devices = presentEdgeDevices([
  { id: 'pump', materialUuid: 'pump', deviceKey: 'Island_Pump', namespace: '',
    machineName: '注射泵', online: true, edgeStatus: 'online', actions: [] },
  { id: 'robot', materialUuid: 'robot', deviceKey: 'Island_Robot', namespace: '',
    machineName: '机械臂', online: false, edgeStatus: 'registered', actions: [] },
  { id: 'balance', materialUuid: 'balance', deviceKey: 'Balance', namespace: '',
    machineName: '天平', online: false, edgeStatus: 'offline', actions: [] }
])
const all: DeviceFilters = { query: '', status: 'all', lock: 'all' }
const locked = new Set(['pump'])

describe('仪器设备检索', () => {
  it('组合名称、标识和状态筛选，检索忽略大小写及多余空格', () => {
    expect(filterDevices(devices, { ...all, query: '  ISLAND   注射 ' }, locked)
      .map((device) => device.id)).toEqual(['pump'])
    expect(filterDevices(devices, { ...all, query: 'island', status: 'registered' }, locked)
      .map((device) => device.id)).toEqual(['robot'])
    expect(filterDevices(devices, { ...all, status: 'offline', lock: 'locked' }, locked))
      .toEqual([])
  })

  it('已锁定和未锁定互斥，锁状态未知时不展示为未锁定', () => {
    expect(filterDevices(devices, { ...all, lock: 'locked' }, locked)
      .map((device) => device.id)).toEqual(['pump'])
    expect(filterDevices(devices, { ...all, lock: 'unlocked' }, locked)
      .map((device) => device.id)).toEqual(['robot', 'balance'])
    expect(filterDevices(devices, { ...all, lock: 'unlocked' }, null)).toEqual([])
    expect(filterDevices(devices, all, null)).toEqual(devices)
  })

  it('可通过动作名称找到仪器，不改变完整目录', () => {
    const catalog = [{ ...devices[0]!, actions: [{
      actionName: 'reconnect_tcp', actionRef: 'pump.reconnect_tcp', displayName: '重新连接',
      label: '重新连接', typeName: 'Command', isBusy: false, currentJobId: null,
      schema: null, inputSchema: {}, outputSchema: {}, riskLevel: 'normal' as const
    }] }, ...devices.slice(1)]
    expect(filterDevices(catalog, { ...all, query: 'RECONNECT' }, locked)
      .map((device) => device.id)).toEqual(['pump'])
    expect(filterDevices(catalog, { ...all, query: '不存在' }, locked)).toEqual([])
    expect(catalog).toHaveLength(3)
  })
})
