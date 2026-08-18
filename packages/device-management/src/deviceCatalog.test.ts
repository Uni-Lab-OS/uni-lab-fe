import { describe, expect, it } from 'vitest'

import { presentEdgeDevices } from './deviceCatalog'

describe('Edge device catalog', () => {
  it('does not create default devices when Edge reports nothing', () => {
    expect(presentEdgeDevices([])).toEqual([])
  })

  /**
   * 验证系统宿主节点不会伪装成可操作仪器设备。
   *
   * @returns 无返回值；通过空展示列表断言系统节点过滤边界。
   * @throws 系统节点泄漏到设备菜单时由断言报告失败。
   * @safety 只转换内存中的目录夹具，不访问真实设备或执行动作。
   */
  it('hides the system host node from the instrument device list', () => {
    expect(presentEdgeDevices([{
      id: '10000000-0000-4000-8000-000000000001',
      materialUuid: '10000000-0000-4000-8000-000000000001',
      deviceKey: 'host_node',
      namespace: '20000000-0000-4000-8000-000000000001',
      machineName: 'host_node',
      online: true,
      actions: []
    }])).toEqual([])
  })

  it('presents every Edge device without overriding its identity', () => {
    const devices = presentEdgeDevices([
      {
        id: 'robot',
        materialUuid: '10000000-0000-4000-8000-000000000002',
        deviceKey: '/cell/robot',
        namespace: '/cell',
        machineName: '机械臂',
        online: true,
        actions: []
      },
      {
        id: 'pump',
        materialUuid: '10000000-0000-4000-8000-000000000003',
        deviceKey: '/cell/pump',
        namespace: '/cell',
        machineName: '注射泵',
        online: true,
        actions: []
      }
    ])

    expect(devices.map((device) => device.id)).toEqual(['robot', 'pump'])
    expect(devices[0]).toMatchObject({
      displayName: '机械臂',
      displayDetail: '',
      online: true,
      edgeStatus: 'online',
      dispatchable: true,
      dispatchBlockReason: null,
      executionOccupancies: null,
      deviceKey: '/cell/robot'
    })
    expect(devices[1]).toMatchObject({
      displayName: '注射泵',
      displayDetail: ''
    })
  })

  it('keeps Edge connectivity separate from scheduling and execution occupancy', () => {
    const [device] = presentEdgeDevices([{
      id: 'pump',
      materialUuid: '10000000-0000-4000-8000-000000000003',
      deviceKey: '/cell/pump',
      namespace: '/cell',
      machineName: '注射泵',
      online: true,
      edgeStatus: 'online',
      dispatchable: false,
      dispatchBlockReason: 'unresolved_unknown_command:workflow-node-job:old-job',
      executionOccupancies: [{
        workflowNodeJobUuid: '90000000-0000-4000-8000-000000000001',
        workflowTaskUuid: null,
        leaseUuid: null,
        actionName: 'dose',
        state: 'uncertain',
        acquiredAt: null
      }],
      actions: []
    }])

    expect(device).toMatchObject({
      online: true,
      edgeStatus: 'online',
      dispatchable: false,
      executionOccupancies: [{ state: 'uncertain' }]
    })
  })
})
