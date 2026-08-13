import { describe, expect, it, vi } from 'vitest'

import { openSelectedDomainActivity } from './domain-activity-navigation'

describe('domain activity navigation', () => {
  /** 证明首次选中物料入口会直接打开主工作区，不会停留在宽大的 Theia 侧栏。 */
  it('forwards only the selected domain activity to the main workbench', () => {
    // 三个入口代表活动栏稳定身份；只有当前标题所有者可以触发打开操作。
    const device = { openInWorkbench: vi.fn() }
    const material = { openInWorkbench: vi.fn() }
    const workflow = { openInWorkbench: vi.fn() }
    const entries = [device, material, workflow] as const

    openSelectedDomainActivity(material, entries)
    openSelectedDomainActivity({ openInWorkbench: vi.fn() }, entries)
    openSelectedDomainActivity(null, entries)

    expect(material.openInWorkbench).toHaveBeenCalledOnce()
    expect(device.openInWorkbench).not.toHaveBeenCalled()
    expect(workflow.openInWorkbench).not.toHaveBeenCalled()
  })
})
