import { expect, it, vi } from 'vitest'

import { loadApplicationAfterRendererDefaults } from './applicationBootstrap'

/**
 * 提供不渲染内容的应用入口，供启动顺序测试识别模块身份。
 *
 * @returns 空 React 内容。
 */
function EmptyApplication(): null {
  return null
}

/**
 * 验证 Pascal 渲染默认值先于应用模块求值，防止可选后处理被错误启用。
 *
 * @returns Promise 完成时表示启动顺序符合 Desktop 与 Web 的共享渲染合同。
 */
async function appliesRendererDefaultsBeforeLoadingApplication(): Promise<void> {
  // 调用顺序冻结渲染兼容设置与应用模块求值的先后关系。
  const calls: string[] = []
  const applyDefaults = vi.fn(() => {
    calls.push('defaults')
  })
  const loadApplication = vi.fn(async () => {
    calls.push('application')
    return { default: EmptyApplication }
  })

  const application = await loadApplicationAfterRendererDefaults(
    loadApplication,
    applyDefaults
  )

  expect(application.default).toBe(EmptyApplication)
  expect(calls).toEqual(['defaults', 'application'])
}

it('先应用 Pascal 渲染默认值，再加载应用模块', appliesRendererDefaultsBeforeLoadingApplication)
