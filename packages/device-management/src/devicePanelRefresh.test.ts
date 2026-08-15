import { describe, expect, it, vi } from 'vitest'

import { refreshDevicePanelState } from './devicePanelRefresh'

describe('device panel refresh', () => {
  it('refreshes the visible active Task together with devices and catalog', async () => {
    const refreshDevices = vi.fn(async () => undefined)
    const refreshCatalog = vi.fn(async () => true)
    const refreshTask = vi.fn(async () => true)

    await refreshDevicePanelState({
      refreshDevices,
      refreshCatalog,
      activeTask: { taskUuid: 'task-1', actionRef: 'device.action' },
      refreshTask
    })

    expect(refreshDevices).toHaveBeenCalledOnce()
    expect(refreshCatalog).toHaveBeenCalledOnce()
    expect(refreshTask).toHaveBeenCalledWith('task-1', 'device.action')
  })

  it('refreshes catalog data without inventing a Task read', async () => {
    const refreshTask = vi.fn(async () => false)

    await refreshDevicePanelState({
      refreshDevices: async () => undefined,
      refreshCatalog: async () => true,
      activeTask: null,
      refreshTask
    })

    expect(refreshTask).not.toHaveBeenCalled()
  })
})
