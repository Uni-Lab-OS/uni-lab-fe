import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { APP_SHELL_NAV_ITEMS } from '../AppShell'
import { DevicePanelModeSwitcher } from './DevicePanel'

/**
 * 验证设备自定义卡片已归入“仪器设备”页签组。
 *
 * @returns 无；断言失败时由 Vitest 报告。
 */
function verifiesDevicePanelTabs(): void {
  const markup = renderToStaticMarkup(
    <DevicePanelModeSwitcher mode="cards" onChange={vi.fn()} />
  )

  expect(markup).toContain('设备控制')
  expect(markup).toContain('自定义卡片')
  expect(markup).toContain('role="tablist"')
  expect(markup).toContain('aria-selected="true"')
  expect(APP_SHELL_NAV_ITEMS.map(item => item.label)).toContain('仪器设备')
  expect(APP_SHELL_NAV_ITEMS.map(item => item.label)).not.toContain('设备卡片')
}

/**
 * 注册仪器设备页签结构测试。
 *
 * @returns 无；断言失败时由 Vitest 报告。
 */
function registerDevicePanelTests(): void {
  it('在仪器设备下展示设备控制和自定义卡片', verifiesDevicePanelTabs)
}

describe('仪器设备工作面', registerDevicePanelTests)
