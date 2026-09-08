import { describe, expect, it, vi } from 'vitest'

import { WorkbenchPrivateStatePreferenceContribution } from './workbench-private-state-preferences'

describe('WorkbenchPrivateStatePreferenceContribution', () => {
  it('keeps runtime logs out of the IDE file tree, watcher, and search', async () => {
    const overrides = new Map<string, unknown>()
    const contribution = new WorkbenchPrivateStatePreferenceContribution()

    await contribution.initSchema({
      registerOverride: vi.fn((preference, _scope, value) => {
        overrides.set(preference, value)
      })
    } as never)

    expect(overrides.get('files.exclude')).toMatchObject({
      '**/.unilabos': true,
      '**/logs': true,
      '**/*.log': true
    })
    expect(overrides.get('files.watcherExclude')).toMatchObject({
      '**/.unilabos/**': true,
      '**/logs/**': true,
      '**/*.log': true
    })
    expect(overrides.get('search.exclude')).toMatchObject({
      '**/.unilabos/**': true,
      '**/logs/**': true,
      '**/*.log': true
    })
  })
})
