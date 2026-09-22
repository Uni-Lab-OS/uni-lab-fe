import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ExperimentOperationStructure } from './ExperimentOperationStructure'

describe('ExperimentOperationStructure', () => {
  it('projects the current Canonical DAG as the operation outline', () => {
    const markup = renderToStaticMarkup(
      <ExperimentOperationStructure
        workflowName="原料溶解酸化"
        nodes={[{
          id: 'node-feed',
          name: '定量投料',
          type: 'action',
          className: 'FeedRobot',
          labNodeType: 'Device'
        }]}
        linkCount={2}
        selectedNodeId="node-feed"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('aria-label="实验流程结构"')
    expect(markup).toContain('原料溶解酸化')
    expect(markup).toContain('1 个节点 · 2 条连接')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('定量投料')
    expect(markup).toContain('FeedRobot')
  })
})
