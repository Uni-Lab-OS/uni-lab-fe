import { describe, expect, it, vi } from 'vitest'

import { DeviceCardVisibilityController } from './deviceCardVisibility'

describe('DeviceCardVisibilityController', () => {
  it('keeps the native card hidden until every blocking overlay closes', () => {
    const view = { setVisible: vi.fn() }
    const controller = new DeviceCardVisibilityController()
    controller.attach(view)

    controller.setOccluded('local-runtime-dialog', true)
    controller.setOccluded('local-runtime-log-dialog', true)
    controller.setOccluded('local-runtime-dialog', false)

    expect(view.setVisible.mock.calls).toEqual([
      [true],
      [false]
    ])

    controller.setOccluded('local-runtime-log-dialog', false)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('applies an existing occlusion to a newly attached card without reload', () => {
    const controller = new DeviceCardVisibilityController()
    const first = { setVisible: vi.fn() }
    const second = { setVisible: vi.fn() }

    controller.setOccluded('local-runtime-log-toolbar', true)
    controller.attach(first)
    controller.detach(first)
    controller.attach(second)

    expect(first.setVisible).toHaveBeenCalledWith(false)
    expect(second.setVisible).toHaveBeenCalledWith(false)

    controller.setOccluded('local-runtime-log-toolbar', false)
    expect(second.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('is idempotent and rejects invalid overlay source identities', () => {
    const view = { setVisible: vi.fn() }
    const controller = new DeviceCardVisibilityController()
    controller.attach(view)
    view.setVisible.mockClear()

    controller.setOccluded('local-runtime-dialog', true)
    controller.setOccluded('local-runtime-dialog', true)
    expect(view.setVisible).toHaveBeenCalledTimes(1)

    expect(() => controller.setOccluded('', true)).toThrow(/source/)
    expect(() => controller.setOccluded('x'.repeat(129), true)).toThrow(/source/)
  })
})
