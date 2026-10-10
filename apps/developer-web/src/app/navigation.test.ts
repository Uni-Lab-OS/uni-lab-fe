import { describe, expect, it, vi } from 'vitest'
import { navigateTo, routeFromPath } from './navigation'

describe('developer-web navigation', () => {
  it.each([
    ['/devices', 'devices'], ['/reagents', 'reagents'], ['/materials/x', 'materials'], ['/workflows', 'workflows'], ['/tasks', 'tasks'], ['/', 'overview'], ['/unknown', 'overview'],
  ])('maps %s to %s', (path, expected) => expect(routeFromPath(path)).toBe(expected))

  it('pushes the route and emits popstate', () => {
    const listener = vi.fn()
    window.addEventListener('popstate', listener)
    navigateTo('workflows', '?id=wf-1')
    expect(window.location.pathname).toBe('/workflows')
    expect(window.location.search).toBe('?id=wf-1')
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener('popstate', listener)
  })
})
