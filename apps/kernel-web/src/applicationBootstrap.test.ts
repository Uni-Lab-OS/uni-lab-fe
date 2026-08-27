import { expect, it, vi } from 'vitest'

import { loadApplicationAfterRendererDefaults } from './applicationBootstrap'

function EmptyApplication(): null {
  return null
}

it('先应用 Pascal 渲染默认值，再加载应用模块', async () => {
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
})
