import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { DeviceCatalogItem, DeviceStatus } from '@unilab/services'

import {
  WorkbenchDeviceModeSwitcher,
  buildWorkbenchDeviceCardAuthoringContext,
  buildWorkbenchDeviceCardRuntimeState
} from './workbench-device-cards'

describe('Workbench 设备自定义卡片', () => {
  it('在仪器设备域公开设备控制和自定义卡片两个页签', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDeviceModeSwitcher mode="cards" onChange={vi.fn()} />
    )

    expect(markup).toContain('设备控制')
    expect(markup).toContain('自定义卡片')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-selected="true"')
  })

  it('按正式契约解码容器状态并附加 Host 状态', () => {
    const statusMap = new Map<string, DeviceStatus>([[
      'robot-1',
      {
        deviceId: 'robot-1',
        status: {
          pose: '{"x":1,"y":2}',
          untyped: '{"secret":true}'
        },
        timestamp: 1
      }
    ]])

    expect(buildWorkbenchDeviceCardRuntimeState(device(), statusMap)).toEqual({
      pose: { x: 1, y: 2 },
      untyped: '{"secret":true}',
      online: true,
      actionBusy: { move: false }
    })
  })

  it('从 OS 设备目录生成中立的卡片开发上下文', () => {
    const context = buildWorkbenchDeviceCardAuthoringContext(device(), {
      pose: { x: 1, y: 2 }
    })

    expect(context.deviceId).toBe('robot-1')
    expect(context.deviceTypeId).toBe('robot')
    expect(context.actions).toEqual([
      expect.objectContaining({ action: 'move', label: '移动' })
    ])
    expect(context.sampleState).toEqual(expect.objectContaining({
      pose: { x: 1, y: 2 }
    }))
  })
})

/** 构造测试使用的设备目录条目。 */
function device(): DeviceCatalogItem {
  return {
    deviceId: 'robot-1',
    materialUuid: 'material-1',
    deviceTypeId: 'robot',
    deviceKey: 'robot-key',
    namespace: 'fixture',
    label: '机械臂 1',
    online: true,
    stateSchema: {
      pose: { type: 'object', source: 'driver', status: 'resolved' }
    },
    actions: [{
      actionName: 'move',
      actionRef: 'robot.move',
      label: '移动',
      typeName: 'Move',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      riskLevel: 'normal',
      isBusy: false
    }]
  }
}
