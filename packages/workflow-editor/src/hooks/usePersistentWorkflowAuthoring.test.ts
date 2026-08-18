import { describe, expect, it } from 'vitest'

import { isMissingWorkflowError } from './usePersistentWorkflowAuthoring'

describe('persistent workflow recovery', () => {
  it('recognizes a deleted active workflow without hiding connection failures', () => {
    expect(isMissingWorkflowError(new Error(
      'Workflow, node, edge, task, or job not found: get workflow'
    ))).toBe(true)
    expect(isMissingWorkflowError(new Error('工作流已不存在'))).toBe(true)
    expect(isMissingWorkflowError(new Error('HTTP 502: Backend unavailable')))
      .toBe(false)
  })
})
