import { describe, expect, it, vi } from 'vitest'

import {
  subscribeWorkbenchDeviceCardJointPreview
} from './workbench-desktop-device-card-api'

describe('Workbench desktop device-card bridge compatibility', () => {
  it('keeps the card panel mounted when an older preload has no joint-preview API', () => {
    const listener = vi.fn()

    expect(() => {
      const dispose = subscribeWorkbenchDeviceCardJointPreview({}, listener)
      dispose()
    }).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
