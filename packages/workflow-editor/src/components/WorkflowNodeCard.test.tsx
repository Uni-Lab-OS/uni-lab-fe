import { describe, expect, it } from 'vitest'

import {
  workflowMaterialPortCards,
  workflowNodeAllowsDebugMarkers,
  workflowNodeKindLabel,
  workflowNodeShowsState,
  workflowNodeStateLabel
} from './WorkflowNodeCard'
import type { WorkflowHandlePort } from '../utils/parseWorkflow'

describe('MaterialSource node semantics', () => {
  it('is explicitly non-Action and uses material-resolution status language', () => {
    expect(workflowNodeKindLabel('material_source')).toBe('物料来源')
    expect(workflowNodeAllowsDebugMarkers('material_source')).toBe(false)
    expect(workflowNodeStateLabel('material_source', 'material_waiting'))
      .toBe('等待物料')
    expect(workflowNodeStateLabel('material_source', 'success'))
      .toBe('物料已绑定')
    expect(workflowNodeStateLabel('material_source', 'failed'))
      .toBe('物料解析失败')
  })
})

describe('Action node presentation', () => {
  it('hides the idle pending state but keeps meaningful execution states', () => {
    expect(workflowNodeShowsState('action')).toBe(false)
    expect(workflowNodeShowsState('action', 'pending')).toBe(false)
    expect(workflowNodeShowsState('action', 'running')).toBe(true)
    expect(workflowNodeShowsState('action', 'failed')).toBe(true)
    expect(workflowNodeShowsState('material_source', 'pending')).toBe(false)
    expect(workflowNodeShowsState('material_source', 'material_waiting'))
      .toBe(true)
  })

  it('uses ResourceSlot variable names and Handle presentation metadata', () => {
    const handles: WorkflowHandlePort[] = [
      materialHandle('sample-target', 'sample', 'target', {
        title: '待测样品',
        description: '进入当前操作的原始样品'
      }),
      materialHandle('reagent-target', 'reagent', 'target'),
      materialHandle('sample-source', 'sample', 'source', {
        description: '离开当前操作的样品'
      }),
      materialHandle('result-source', 'result', 'source', {
        title: '产物'
      })
    ]
    const cards = workflowMaterialPortCards(handles, {
      'sample-target': '#6657c7',
      'reagent-target': '#8056a8',
      'sample-source': '#6657c7',
      'result-source': '#4f69b8'
    })

    expect(cards).toHaveLength(3)
    expect(cards.map((card) => card.label)).toEqual([
      '待测样品',
      'reagent',
      '产物'
    ])
    expect(cards[0]).toEqual(expect.objectContaining({
      variableName: 'sample',
      targetHandle: handles[0],
      sourceHandle: handles[2],
      description: '进入当前操作的原始样品\n离开当前操作的样品'
    }))
    expect(cards[1]).toEqual(expect.objectContaining({
      variableName: 'reagent',
      targetHandle: handles[1]
    }))
  })
})

function materialHandle(
  uuid: string,
  dataKey: string,
  ioType: 'source' | 'target',
  presentation: Pick<WorkflowHandlePort, 'title' | 'description'> = {}
): WorkflowHandlePort {
  return {
    uuid,
    handleKey: dataKey,
    displayName: dataKey,
    dataKey,
    ioType,
    valueType: 'ResourceSlot',
    ...presentation
  }
}
