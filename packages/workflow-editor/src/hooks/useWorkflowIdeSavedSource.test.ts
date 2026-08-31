import { describe, expect, it } from 'vitest'

import { workflowIdeSavedSourceInstallDecision } from './useWorkflowIdeSavedSource'

describe('workflow IDE saved source', () => {
  it('installs a saved Python aggregate without opening normalization review', () => {
    expect(workflowIdeSavedSourceInstallDecision(false)).toEqual({
      kind: 'install'
    })
  })

  it('keeps a dirty canvas while installing diagnostics for the saved source', () => {
    expect(workflowIdeSavedSourceInstallDecision(true)).toEqual({
      kind: 'preserve_dirty_canvas'
    })
  })
})
