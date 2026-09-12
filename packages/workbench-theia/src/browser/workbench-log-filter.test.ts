import { describe, expect, it, vi } from 'vitest'
import { installLogFilterDismissal, closeLogFilterOnFocusExit, logFilterSelectionQuery, selectedLogFilters, logFilterSummary } from './workbench-log-filter'

describe('compact log selection', () => {
  it('defaults to all, clears explicitly, and keeps heartbeat independent with a fixed limit', () => {
    expect(logFilterSummary(['error'])).toBe('ERROR')
    expect(logFilterSummary(['heartbeat'])).toBe('Ping / Pong 心跳')
    expect(logFilterSummary(['warning'])).toBe('WARN')
    expect(logFilterSummary(['critical'])).toBe('FATAL')
    expect(selectedLogFilters({ limit: 500, heartbeat: true })).toHaveLength(9)
    expect(logFilterSelectionQuery([])).toEqual({ levels: [], heartbeat: false, limit: 500 })
    expect(logFilterSelectionQuery(['error', 'heartbeat'])).toEqual({ levels: ['error'], heartbeat: true, limit: 500 })
    expect(logFilterSelectionQuery(['heartbeat'])).toEqual({ levels: [], heartbeat: true, limit: 500 })
  })
  it('keeps the menu open during label-click null focus and closes only on a known outside focus', () => {
    const inside = {} as Node
    const outside = {} as Node
    const element = { open: true, contains: (target: Node) => target === inside } as HTMLDetailsElement
    closeLogFilterOnFocusExit(element, null)
    expect(element.open).toBe(true)
    closeLogFilterOnFocusExit(element, inside)
    expect(element.open).toBe(true)
    closeLogFilterOnFocusExit(element, outside)
    expect(element.open).toBe(false)
  })
  it('closes on Escape with focus restored, ignores inner clicks and removes listeners on disposal', () => {
    const document = new EventTarget()
    const element = new EventTarget() as EventTarget & {
      open: boolean; ownerDocument: EventTarget; contains: (target: unknown) => boolean; querySelector: () => { focus: () => void }
    }
    const focus = vi.fn()
    Object.assign(element, { open: true, ownerDocument: document, contains: (target: unknown) => target === element, querySelector: () => ({ focus }) })
    const dispose = installLogFilterDismissal(element as unknown as HTMLDetailsElement)
    const escape = new Event('keydown', { cancelable: true })
    Object.defineProperty(escape, 'key', { value: 'Escape' })
    element.dispatchEvent(escape)
    expect(element.open).toBe(false)
    expect(escape.defaultPrevented).toBe(true)
    expect(focus).toHaveBeenCalledOnce()
    element.open = true
    const inside = new Event('pointerdown')
    Object.defineProperty(inside, 'target', { value: element })
    document.dispatchEvent(inside)
    expect(element.open).toBe(true)
    document.dispatchEvent(new Event('pointerdown'))
    expect(element.open).toBe(false)
    dispose()
    element.open = true
    document.dispatchEvent(new Event('pointerdown'))
    element.dispatchEvent(escape)
    expect(element.open).toBe(true)
  })
})
