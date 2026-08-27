import type { WorkflowAuthoringAggregate } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import { workflowSourceNormalizationDiff } from './useWorkflowIdeSavedSource'

describe('workflow IDE saved source', () => {
  it('freezes the post-save CAS coordinates into a normalization review', () => {
    const aggregate = {
      workflow_revision: 9,
      draft: {
        python_source: 'value=2\n',
        draft_hash: 'draft-raw'
      },
      candidate: {
        normalized_python_source: 'value = 2\n'
      }
    } as unknown as WorkflowAuthoringAggregate

    expect(workflowSourceNormalizationDiff(aggregate, 'code')).toEqual({
      before: 'value=2\n',
      after: 'value = 2\n',
      expectedDraftHash: 'draft-raw',
      expectedWorkflowRevision: 9,
      reason: 'source_normalization',
      resumeMode: 'code',
      applyAfterSave: false
    })
  })

  it('does not open a diff when OS preserves the saved source', () => {
    const aggregate = {
      workflow_revision: 9,
      draft: {
        python_source: 'value = 2\n',
        draft_hash: 'draft-exact'
      },
      candidate: {
        normalized_python_source: 'value = 2\n'
      }
    } as unknown as WorkflowAuthoringAggregate

    expect(workflowSourceNormalizationDiff(aggregate, 'code')).toBeNull()
  })
})
