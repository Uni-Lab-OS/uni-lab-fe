import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowAuthoringGraph } from '@unilab/services'

import { WorkflowLoopNodeEditor } from './WorkflowLoopNodeEditor'

const graph: WorkflowAuthoringGraph = {
  workflow: { uuid: 'workflow', revision: 1 },
  nodes: [
    { uuid: 'loop', type: 'repeat_until', name: '循环', param: {
      loop_variable: 'loop', max_iterations: 3, until: { var: 'done' },
      node_uuids: [], entry_node_uuids: [], exit_node_uuids: [], successor_node_uuids: []
    } },
    { uuid: 'action', type: 'device', name: '动作', param: {} }
  ],
  edges: [], node_templates: [], handle_templates: []
}

describe('WorkflowLoopNodeEditor', () => {
  it('shows the loop count, body membership and termination condition controls', () => {
    const markup = renderToStaticMarkup(
      <WorkflowLoopNodeEditor graph={graph} nodeUuid="loop" editable onChange={vi.fn()} />
    )
    expect(markup).toContain('最多循环次数')
    expect(markup).toContain('循环终止条件')
    expect(markup).toContain('参数为真')
    expect(markup).toContain('循环体执行节点')
    expect(markup).not.toContain('（LOOP）')
    expect(markup).not.toContain('（EXIT')
  })
})
