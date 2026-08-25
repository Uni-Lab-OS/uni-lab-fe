import { describe, expect, it } from 'vitest'

import { shouldEnableWorkbenchUpdates } from './releaseChannel'

describe('Workbench release channel', () => {
  it('enables updates only for packaged production or isolated update-test builds', () => {
    expect(shouldEnableWorkbenchUpdates({
      isPackaged: true,
      releaseChannel: 'production',
      surfaceKind: 'workbench'
    })).toBe(true)
    expect(shouldEnableWorkbenchUpdates({
      isPackaged: true,
      releaseChannel: 'update-test',
      surfaceKind: 'workbench'
    })).toBe(true)
    expect(shouldEnableWorkbenchUpdates({
      isPackaged: true,
      releaseChannel: 'test',
      surfaceKind: 'workbench'
    })).toBe(false)
    expect(shouldEnableWorkbenchUpdates({
      isPackaged: false,
      releaseChannel: 'production',
      surfaceKind: 'workbench'
    })).toBe(false)
    expect(shouldEnableWorkbenchUpdates({
      isPackaged: true,
      releaseChannel: 'production',
      surfaceKind: 'kernel'
    })).toBe(false)
  })
})
