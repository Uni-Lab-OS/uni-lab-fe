import { describe, expect, it } from 'vitest'
import { workflowStepSelection } from './workflowStepSelection'

describe('step ready-node selection', () => {
  const candidates = [{ node_uuid: 'left' }, { node_uuid: 'right' }]
  it('defaults to the first server candidate without sorting or rewriting IDs', () => {
    expect(workflowStepSelection('task', candidates, null)).toBe('left')
  })
  it('keeps an explicit parallel option while it remains ready, including reordered reads', () => {
    const selection = { taskUuid: 'task', nodeUuid: 'right' }
    expect(workflowStepSelection('task', candidates, selection)).toBe('right')
    expect(workflowStepSelection('task', [...candidates].reverse(), selection)).toBe('right')
  })
  it('falls back when a choice leaves the ready set or belongs to another task', () => {
    expect(workflowStepSelection('task', [candidates[0]], { taskUuid: 'task', nodeUuid: 'right' })).toBe('left')
    expect(workflowStepSelection('new-task', candidates, { taskUuid: 'old-task', nodeUuid: 'right' })).toBe('left')
    expect(workflowStepSelection('task', [], { taskUuid: 'task', nodeUuid: 'right' })).toBe('')
  })
})
