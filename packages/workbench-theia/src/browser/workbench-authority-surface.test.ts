import { describe, expect, it } from 'vitest'
import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { authoritySurfaceSnapshot } from './workbench-authority-surface'

describe('authoritySurfaceSnapshot', () => {
  const ready = { phase: 'ready', identity: { backendUrl: 'http://local' } } as WorkbenchSessionSnapshot
  const starting = { phase: 'starting', identity: null } as WorkbenchSessionSnapshot

  it('keeps the last ready surface mounted while switching', () => {
    expect(authoritySurfaceSnapshot(starting, ready, true)).toBe(ready)
  })

  it('shows the current snapshot after switching finishes', () => {
    expect(authoritySurfaceSnapshot(starting, ready, false)).toBe(starting)
  })
})
