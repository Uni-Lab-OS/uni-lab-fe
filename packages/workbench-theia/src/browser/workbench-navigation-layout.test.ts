import { afterEach, describe, expect, it, vi } from 'vitest'

import { observeWorkbenchNavigationLayout } from './workbench-navigation-layout'

function setup() {
  let resized: () => void = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe = observe
    disconnect = disconnect
  })
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const size = { clientWidth: 0, clientHeight: 0 }
  const panel = { node: size as HTMLElement, fit: vi.fn() }
  const activityBar = { update: vi.fn() }
  const layout = observeWorkbenchNavigationLayout(panel, activityBar)
  return {
    panel, activityBar, layout, observe, disconnect,
    resize(width: number, height: number) {
      size.clientWidth = width
      size.clientHeight = height
      resized()
    },
    paint() {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(0))
    }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('workbench navigation visibility layout', () => {
  it('remeasures navigation after the startup gate restores a hidden panel', () => {
    const test = setup()
    expect(test.observe).toHaveBeenCalledWith(test.panel.node)
    test.resize(0, 0)
    test.paint()
    expect(test.activityBar.update).not.toHaveBeenCalled()

    test.resize(196, 900)
    test.paint()
    expect(test.panel.fit).toHaveBeenCalledOnce()
    expect(test.activityBar.update).toHaveBeenCalledOnce()
    expect(test.panel.fit.mock.invocationCallOrder[0])
      .toBeLessThan(test.activityBar.update.mock.invocationCallOrder[0])

    // 再次经过入口页，即使恢复到相同尺寸，也要清除零高度的溢出结果。
    test.resize(0, 0)
    test.paint()
    test.resize(196, 900)
    test.paint()
    expect(test.activityBar.update).toHaveBeenCalledTimes(2)
  })

  it('handles initially visible panels and coalesces file pane or window resizing', () => {
    const test = setup()
    test.resize(196, 900)
    test.resize(460, 900)
    test.resize(460, 700)
    test.paint()
    expect(test.panel.fit).toHaveBeenCalledOnce()
    expect(test.activityBar.update).toHaveBeenCalledOnce()
  })

  it('cancels measurement when the panel becomes hidden before the next frame', () => {
    const test = setup()
    test.resize(196, 900)
    test.resize(0, 0)
    test.paint()
    expect(test.panel.fit).not.toHaveBeenCalled()
    expect(test.activityBar.update).not.toHaveBeenCalled()
  })

  it('disconnects and cancels pending layout when the application stops', () => {
    const test = setup()
    test.resize(196, 900)
    test.layout.dispose()
    test.paint()
    expect(test.disconnect).toHaveBeenCalledOnce()
    expect(test.panel.fit).not.toHaveBeenCalled()
    expect(test.activityBar.update).not.toHaveBeenCalled()
  })
})
