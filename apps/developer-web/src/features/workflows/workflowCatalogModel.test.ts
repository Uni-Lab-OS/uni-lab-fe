import { describe, expect, it } from 'vitest'
import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'
import {
  countWorkflowKinds,
  filterWorkflowCatalog,
  type WorkflowCatalogStatusFilter,
} from './workflowCatalogModel'

const item = (
  name: string,
  workflowType: PublishedWorkflowRevisionSummary['workflowType'],
  workflowUuid = `${name}-uuid`,
  status: WorkflowCatalogStatusFilter = 'published',
) => ({ name, workflowType, workflowUuid, status }) as PublishedWorkflowRevisionSummary

describe('workflow catalog model', () => {
  it('filters by kind and case-insensitive name or UUID', () => {
    const rows = [item('搬运流程', 'workflow'), item('加液操作', 'experiment_operation')]
    expect(filterWorkflowCatalog(rows, 'workflow', ' UUID ')).toEqual([rows[0]])
    expect(filterWorkflowCatalog(rows, 'experiment_operation', '加液')).toEqual([rows[1]])
  })

  it('filters by publish status within the selected kind', () => {
    const rows = [
      item('已发布流程', 'workflow', 'published-uuid', 'published'),
      item('未发布流程', 'workflow', 'source-uuid', 'source'),
      item('未发布操作', 'experiment_operation', 'operation-uuid', 'source'),
    ]
    expect(filterWorkflowCatalog(rows, 'workflow', '', 'published')).toEqual([rows[0]])
    expect(filterWorkflowCatalog(rows, 'workflow', '', 'source')).toEqual([rows[1]])
    expect(filterWorkflowCatalog(rows, 'workflow', '', 'all')).toEqual([rows[0], rows[1]])
  })

  it('counts both catalog tabs from the same snapshot', () => {
    expect(countWorkflowKinds([item('a', 'workflow'), item('b', 'workflow')])).toEqual({
      workflow: 2,
      experiment_operation: 0,
    })
    expect(countWorkflowKinds(undefined)).toEqual({ workflow: 0, experiment_operation: 0 })
  })
})
