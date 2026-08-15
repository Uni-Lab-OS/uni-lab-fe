import { describe, expect, it } from 'vitest'

import {
  clearWorkbenchDeviceStatusStreamNotice,
  workbenchDeviceStatusStreamErrorNotice,
  type WorkbenchDeviceCardNotice
} from './workbench-device-card-support'

describe('设备卡实时状态提示', () => {
  it('Mock 模式下忽略只影响 Live 状态的 WebSocket 错误', () => {
    expect(workbenchDeviceStatusStreamErrorNotice(
      null,
      '设备状态 WebSocket 连接出错',
      false
    )).toBeNull()
  })

  it('Live 模式断线后显示警告，重连成功后清除该警告', () => {
    const warning = workbenchDeviceStatusStreamErrorNotice(
      null,
      '设备状态 WebSocket 连接出错',
      true
    )

    expect(warning).toMatchObject({
      kind: 'warning',
      source: 'device-status-stream',
      text: '设备状态 WebSocket 连接出错，Live 状态可能暂时不更新。'
    })
    expect(clearWorkbenchDeviceStatusStreamNotice(warning)).toBeNull()
  })

  it('重连成功时保留与设备状态流无关的提示', () => {
    const unrelated: WorkbenchDeviceCardNotice = {
      kind: 'error',
      text: '卡片动作执行失败。'
    }

    expect(clearWorkbenchDeviceStatusStreamNotice(unrelated)).toBe(unrelated)
    expect(workbenchDeviceStatusStreamErrorNotice(
      unrelated,
      '设备状态 WebSocket 连接出错',
      true
    )).toBe(unrelated)
  })
})
