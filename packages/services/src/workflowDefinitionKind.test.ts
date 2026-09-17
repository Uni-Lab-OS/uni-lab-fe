import { describe, expect, it } from 'vitest'

import { workflowDefinitionKind } from './workflowAuthoringContracts'

describe('workflowDefinitionKind', () => {
  it('reads operation from OS-owned unilab metadata', () => {
    expect(workflowDefinitionKind({
      meta_data: { unilab: { definition_kind: 'operation' } }
    })).toBe('operation')
  })

  it('keeps existing definitions backward compatible as workflow', () => {
    expect(workflowDefinitionKind({ meta_data: {} })).toBe('workflow')
  })

  it('fails closed for unknown definition kinds', () => {
    expect(() => workflowDefinitionKind({
      meta_data: { unilab: { definition_kind: 'script' } }
    })).toThrow('工作流定义种类无效')
  })
})
