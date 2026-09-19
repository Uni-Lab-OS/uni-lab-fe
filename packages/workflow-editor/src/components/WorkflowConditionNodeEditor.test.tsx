import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowAuthoringGraph } from '@unilab/services'

import { WorkflowConditionNodeEditor } from './WorkflowConditionNodeEditor'

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

describe('WorkflowConditionNodeEditor', () => {
  it('inserts an ELIF branch between the required IF and ELSE branches', () => {
    const onChange = vi.fn()
    const tree = WorkflowConditionNodeEditor({
      graph, nodeUuid: 'condition', editable: true, onChange
    })
    const header = tree.props.children[0]
    header.props.children[1].props.onClick()

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      branches: [
        expect.objectContaining({ label: 'if', condition: { lit: true } }),
        expect.objectContaining({ label: 'elif0' }),
        expect.objectContaining({ label: 'else', condition: null })
      ]
    }))
  })

  it('exposes candidate actions without offering nested control nodes', () => {
    const markup = renderToStaticMarkup(
      <WorkflowConditionNodeEditor graph={graph} nodeUuid="condition"
        editable onChange={vi.fn()} />
    )
    expect(markup).toContain('条件分支')
    expect(markup).toContain('通过处理')
    expect(markup).toContain('失败处理')
    expect(markup).not.toContain('按结果分支</option>')
  })
})
