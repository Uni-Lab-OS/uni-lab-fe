import { describe, expect, it } from 'vitest'

import { shouldSubscribeDeviceStatus } from './useDeviceStatus'

/**
 * 验证旧设备状态 WebSocket 只在设备相关工作台可见时建立。
 *
 * 参数：无。返回：无。异常：策略越过工作流或连接门禁时由 Vitest 失败。
 */
function verifiesDeviceStatusSubscriptionScope(): void {
  const connected = {
    backendEnabled: true,
    connection: 'connected' as const,
    canSubscribeStatus: true
  }

  expect(shouldSubscribeDeviceStatus({ ...connected, section: 'device' }))
    .toBe(true)
  expect(shouldSubscribeDeviceStatus({ ...connected, section: 'workflow' }))
    .toBe(false)
  expect(shouldSubscribeDeviceStatus({ ...connected, section: 'material' }))
    .toBe(false)
  expect(shouldSubscribeDeviceStatus({
    ...connected,
    section: 'device',
    connection: 'disconnected'
  })).toBe(false)
}

/**
 * 注册设备状态订阅范围测试。
 *
 * @returns 无。
 * @throws 策略断言失败时由 Vitest 报告。
 */
function registerDeviceStatusSubscriptionScopeTests(): void {
  it('工作流页面不建立旧设备状态 WebSocket',
    verifiesDeviceStatusSubscriptionScope)
}

describe('设备状态实时订阅范围', registerDeviceStatusSubscriptionScopeTests)
