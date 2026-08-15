import { describe, expect, it, vi } from 'vitest'

import {
  setWorkbenchDeviceCardSurfaceOccluded,
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

  it('hides the native card for a blocking overlay and restores it on cleanup', () => {
    const setOccluded = vi.fn(() => Promise.resolve())
    const cleanup = setWorkbenchDeviceCardSurfaceOccluded(
      { setOccluded },
      'environment-manager'
    )

    expect(setOccluded).toHaveBeenNthCalledWith(
      1,
      'environment-manager',
      true
    )

    cleanup()

    expect(setOccluded).toHaveBeenNthCalledWith(
      2,
      'environment-manager',
      false
    )
  })

  it('keeps browser and older preload environments compatible', () => {
    expect(() => {
      setWorkbenchDeviceCardSurfaceOccluded(
        {},
        'environment-manager'
      )()
    }).not.toThrow()
  })
})
