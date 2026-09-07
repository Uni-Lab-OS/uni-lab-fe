import { describe, expect, it } from 'vitest'

import { runModeAfterDebugMarkerChange } from './debugRunModeIntent'

describe('debug marker run intent', () => {
  it('switches marker additions to a real debug launch without changing removals', () => {
    expect(runModeAfterDebugMarkerChange('normal', false)).toBe('debug')
    expect(runModeAfterDebugMarkerChange('step', false)).toBe('debug')
    expect(runModeAfterDebugMarkerChange('debug', true)).toBe('debug')
    expect(runModeAfterDebugMarkerChange('normal', true)).toBe('normal')
  })
})
