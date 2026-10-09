import { describe, expect, it } from 'vitest'
import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'
import { countWorkflowKinds, filterWorkflowCatalog } from './workflowCatalogModel'

const item = (
  name: string,
  workflowType: PublishedWorkflowRevisionSummary['workflowType'],
  workflowUuid = `${name}-uuid`,
) => ({ name, workflowType, workflowUuid }) as PublishedWorkflowRevisionSummary

describe('workflow catalog model', () => {
  it('filters by kind and case-insensitive name or UUID', () => {
    const rows = [item('搬运流程', 'workflow'), item('加液操作', 'experiment_operation')]
    expect(filterWorkflowCatalog(rows, 'workflow', ' UUID ')).toEqual([rows[0]])
    expect(filterWorkflowCatalog(rows, 'experiment_operation', '加液')).toEqual([rows[1]])
  })

  it('counts both catalog tabs from the same snapshot', () => {
    expect(countWorkflowKinds([item('a', 'workflow'), item('b', 'workflow')])).toEqual({
      workflow: 2,
      experiment_operation: 0,
    })
    expect(countWorkflowKinds(undefined)).toEqual({ workflow: 0, experiment_operation: 0 })
  })
})
