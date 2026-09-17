import { describe, expect, it } from 'vitest'
import type { WorkflowAuthoringGraph } from '@unilab/services'

import {
  addWorkflowConditionBranch,
  applyWorkflowConditionParam,
  projectWorkflowConditionEditor,
  removeWorkflowConditionBranch,
  updateWorkflowConditionBranch,
  updateWorkflowConditionParam
} from './workflowConditionControl'

const graph: WorkflowAuthoringGraph = {
  workflow: { uuid: 'workflow', revision: 1 },
  nodes: [
    { uuid: 'condition', type: 'condition', name: '按结果分支', param: {
      predecessor_node_uuids: [], bindings: {},
      branches: [{ label: 'if', condition: { lit: true }, node_uuids: [], entry_node_uuids: [], exit_node_uuids: [] }]
    } },
    { uuid: 'pass', type: 'device', name: '通过处理', param: {} },
    { uuid: 'fail', type: 'device', name: '失败处理', param: {} }
  ],
  edges: [], node_templates: [], handle_templates: []
}

describe('workflow condition control', () => {
  it('adds an else branch and derives branch boundaries from selected members', () => {
    const initial = projectWorkflowConditionEditor(graph, 'condition')
    const added = addWorkflowConditionBranch(initial.branches)
    const withTrue = updateWorkflowConditionBranch(added, 0, {
      condition: { var: 'qualified' }, node_uuids: ['pass']
    })
    const complete = updateWorkflowConditionBranch(withTrue, 1, {
      node_uuids: ['fail']
    })
    const param = updateWorkflowConditionParam(graph.nodes[0]?.param, complete)
    const applied = applyWorkflowConditionParam(graph, 'condition', param)

    expect(param.branches).toEqual([
      expect.objectContaining({
        label: 'if', condition: { var: 'qualified' },
        node_uuids: ['pass'], entry_node_uuids: ['pass'], exit_node_uuids: ['pass']
      }),
      expect.objectContaining({
        label: 'else', condition: null,
        node_uuids: ['fail'], entry_node_uuids: ['fail'], exit_node_uuids: ['fail']
      })
    ])
    expect(applied.nodes.find((node) => node.uuid === 'pass')?.parent_uuid)
      .toBe('condition')
    expect(applied.nodes.find((node) => node.uuid === 'fail')?.parent_uuid)
      .toBe('condition')
  })

  it('keeps at least one branch and restores the remaining branch as fallback', () => {
    const added = addWorkflowConditionBranch(
      projectWorkflowConditionEditor(graph, 'condition').branches
    )
    const removed = removeWorkflowConditionBranch(added, 0)
    expect(removed).toEqual([
      expect.objectContaining({ label: 'if', condition: null })
    ])
    expect(removeWorkflowConditionBranch(removed, 0)).toHaveLength(1)
  })
})
