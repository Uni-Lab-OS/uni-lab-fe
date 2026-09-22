import { describe, expect, it } from 'vitest'
import type { WorkflowAuthoringGraph } from '@unilab/services'

import {
  applyWorkflowLoopParam,
  connectWorkflowLoopPredecessor,
  connectWorkflowLoopSuccessor,
  moveWorkflowNodeToLoop,
  projectWorkflowLoopEditor,
  updateWorkflowLoopParam
} from './workflowLoopControl'

const graph: WorkflowAuthoringGraph = {
  workflow: { uuid: 'workflow', revision: 1 },
  nodes: [
    { uuid: 'loop', type: 'repeat_until', name: '重试循环', param: {
      loop_variable: 'loop', max_iterations: 3,
      node_uuids: [], entry_node_uuids: [], exit_node_uuids: [], successor_node_uuids: []
    } },
    { uuid: 'dose', type: 'device', name: '投粉', param: {} },
    { uuid: 'check', type: 'device', name: '检测', param: {} },
    { uuid: 'report', type: 'device', name: '汇报', param: {} }
  ],
  edges: [], node_templates: [], handle_templates: []
}

describe('workflow loop control', () => {
  it('derives loop body boundaries and keeps other params', () => {
    const param = updateWorkflowLoopParam(graph.nodes[0]?.param, {
      maxIterations: 5,
      until: { var: 'done' },
      bodyNodeUuids: ['dose', 'check'], successorNodeUuids: ['report']
    })
    expect(param).toMatchObject({
      loop_variable: 'loop', max_iterations: 5,
      until: { var: 'done' },
      node_uuids: ['dose', 'check'],
      entry_node_uuids: ['dose'], exit_node_uuids: ['check'],
      successor_node_uuids: ['report']
    })
  })

  it('syncs loop-body members parent_uuid and clears removed members', () => {
    const param = updateWorkflowLoopParam(graph.nodes[0]?.param, { bodyNodeUuids: ['dose', 'check'] })
    const applied = applyWorkflowLoopParam(graph, 'loop', param)
    expect(applied.nodes.find(n => n.uuid === 'dose')?.parent_uuid).toBe('loop')
    expect(applied.nodes.find(n => n.uuid === 'check')?.parent_uuid).toBe('loop')
    const reduced = applyWorkflowLoopParam(applied, 'loop',
      updateWorkflowLoopParam(applied.nodes.find(n => n.uuid === 'loop')?.param, { bodyNodeUuids: ['dose'] }))
    expect(reduced.nodes.find(n => n.uuid === 'check')?.parent_uuid).toBeUndefined()
  })

  it('projects editor state from Canonical params', () => {
    const applied = applyWorkflowLoopParam(graph, 'loop',
      updateWorkflowLoopParam(graph.nodes[0]?.param, { bodyNodeUuids: ['dose'], maxIterations: 4 }))
    const editor = projectWorkflowLoopEditor(applied, 'loop')
    expect(editor.maxIterations).toBe(4)
    expect(editor.bodyNodeUuids).toEqual(['dose'])
    expect(editor.candidateNodes.map(n => n.uuid)).toEqual(['dose', 'check', 'report'])
  })

  it('moves an action into and out of the loop container atomically', () => {
    const embedded = moveWorkflowNodeToLoop(graph, 'dose', 'loop', { x: 120, y: 160 })
    expect(embedded.nodes.find(n => n.uuid === 'dose')).toMatchObject({
      parent_uuid: 'loop', pose: { position: { x: 120, y: 160 } }
    })
    expect(embedded.nodes.find(n => n.uuid === 'loop')?.param).toMatchObject({
      node_uuids: ['dose'], entry_node_uuids: ['dose'], exit_node_uuids: ['dose']
    })

    const detached = moveWorkflowNodeToLoop(embedded, 'dose', null, { x: 640, y: 180 })
    expect(detached.nodes.find(n => n.uuid === 'dose')?.parent_uuid).toBeUndefined()
    expect(detached.nodes.find(n => n.uuid === 'dose')?.pose).toMatchObject({
      position: { x: 640, y: 180 }
    })
    expect(detached.nodes.find(n => n.uuid === 'loop')?.param).toMatchObject({
      node_uuids: [], entry_node_uuids: [], exit_node_uuids: []
    })
  })

  it('connects external nodes through the loop left and right handles', () => {
    const withPredecessor = connectWorkflowLoopPredecessor(
      graph, 'loop', 'dose'
    )
    const connected = connectWorkflowLoopSuccessor(
      withPredecessor, 'loop', 'report'
    )
    expect(connected.nodes.find(n => n.uuid === 'loop')?.param).toMatchObject({
      predecessor_node_uuids: ['dose'],
      successor_node_uuids: ['report'],
      node_uuids: []
    })
    expect(connected.nodes.find(n => n.uuid === 'dose')?.parent_uuid)
      .toBeUndefined()
    expect(connected.nodes.find(n => n.uuid === 'report')?.parent_uuid)
      .toBeUndefined()
  })
})
