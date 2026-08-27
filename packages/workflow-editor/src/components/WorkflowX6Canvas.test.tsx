import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkflowX6Canvas,
  type WorkflowX6Node
} from './WorkflowX6Canvas'
import {
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata
} from './workflowX6Projection'

describe('WorkflowX6Canvas scale policy', () => {
  /**
   * 验证五千节点以上仍使用 X6 虚拟画布，并关闭会复制视图的缩略图。
   *
   * @returns 无返回值；通过静态标记断言大图交互降级边界。
   * @safety 只构造内存投影，不初始化浏览器图实例或工作流任务。
   */
  it('keeps 5000+ nodes on the virtual canvas without a minimap copy', () => {
    const nodes = Array.from({ length: 5_001 }, (_, index) =>
      workflowNode(`node-${index}`)
    )
    const markup = renderToStaticMarkup(
      <WorkflowX6Canvas
        nodes={nodes}
        edges={[]}
        canvasMutationEnabled={false}
        nodePositionMutationEnabled={false}
        onNodeSelect={vi.fn()}
        onSelectionChange={vi.fn()}
      />
    )

    expect(markup).toContain('data-canvas-engine="x6"')
    expect(markup).toContain('data-x6-node-count="5001"')
    expect(markup).toContain('data-x6-virtual="true"')
    expect(markup).toContain('X6 虚拟画布')
    expect(markup).not.toContain('aria-label="工作流缩略图"')
  })

  /** Canonical Handle UUID 必须原样成为 X6 端口身份，连接不能按索引猜测。 */
  it('preserves canonical handle identities in X6 nodes and edges', () => {
    const node = workflowX6NodeMetadata({
      ...workflowNode('node-a'),
      data: {
        ...workflowNode('node-a').data,
        handles: [
          {
            uuid: 'handle-in',
            handleKey: 'input',
            displayName: '输入',
            ioType: 'target'
          },
          {
            uuid: 'handle-out',
            handleKey: 'output',
            displayName: '输出',
            ioType: 'source'
          }
        ]
      }
    })
    const edge = workflowX6EdgeMetadata({
      id: 'edge-a-b',
      source: 'node-a',
      sourceHandle: 'handle-out',
      target: 'node-b',
      targetHandle: 'handle-in'
    })

    const portItems = Array.isArray(node.ports)
      ? node.ports
      : node.ports?.items
    expect(portItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'handle-in', group: 'target' }),
      expect.objectContaining({ id: 'handle-out', group: 'source' })
    ]))
    expect(edge.source).toEqual({ cell: 'node-a', port: 'handle-out' })
    expect(edge.target).toEqual({ cell: 'node-b', port: 'handle-in' })
  })
})

/** 构造不携带运行副作用的最小 X6 工作流节点投影。 */
function workflowNode(id: string): WorkflowX6Node {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      id,
      name: id,
      kind: 'action',
      color: '#3568ed'
    }
  }
}
