import { describe, expect, it } from 'vitest'

import { isRobotDevice } from '../device/DevicePanelPresentation'
import { filterPoints } from './RobotPointWorkbench'
import { POINTS } from './robotPointFixture'

describe('机械臂点位管理投影', () => {
  /** 验证搜索条件同时匹配稳定点位标识、名称和用途。 */
  it('按稳定点位标识、名称和用途筛选目录', () => {
    expect(filterPoints(POINTS, 's04.p01.pick.interact', 'all'))
      .toHaveLength(1)
    expect(filterPoints(POINTS, '取板交互点', 'all'))
      .toHaveLength(1)
    expect(filterPoints(POINTS, '交互点', 'all').length).toBeGreaterThan(0)
    expect(filterPoints(POINTS, '', 'draft').every(
      (point) => point.state === 'draft'
    )).toBe(true)
  })

  /** 验证只有具备明确机械臂身份的设备显示点位配置入口。 */
  it('只为机械臂设备开放点位配置入口', () => {
    const baseDevice = {
      id: 'device-1',
      deviceKey: '/devices/device-1',
      namespace: '/devices',
      displayName: '通用设备',
      displayDetail: 'Edge',
      machineName: 'edge-host',
      materialUuid: 'material-device-1',
      online: true,
      actions: []
    }
    expect(isRobotDevice({
      ...baseDevice,
      id: 'robot-arm-1',
      displayName: '主机械臂'
    })).toBe(true)
    expect(isRobotDevice(baseDevice)).toBe(false)
  })
})
