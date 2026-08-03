import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  WorkflowOutput,
  type WorkflowOutputNode
} from './WorkflowOutput'

describe('WorkflowOutput', () => {
  it('shows the failed node error log in runtime exceptions', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="errors"
        completedNodeCount={0}
        expectedNodeCount={1}
        nodes={[
          {
            nodeId: 'job-heat',
            sourceNodeId: 'heat',
            nodeType: 'action',
            state: 'failed',
            result: {
              error_info: [
                'Traceback: heater temperature exceeded limit'
              ]
            },
            attempt: 1
          }
        ]}
        nodeNames={{ heat: '加热样品' }}
        events={[]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('加热样品')
    expect(html).toContain('Traceback: heater temperature exceeded limit')
  })

  it('falls back to node exception event logs when the node result is empty', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="errors"
        completedNodeCount={0}
        expectedNodeCount={1}
        nodes={[
          {
            nodeId: 'job-heat',
            sourceNodeId: 'heat',
            nodeType: 'action',
            state: 'failed',
            result: {},
            attempt: 1
          }
        ]}
        nodeNames={{ heat: '加热样品' }}
        events={[
          {
            key: 'feedback-7',
            seq: 7,
            type: 'node.exception',
            nodeId: 'heat',
            detail: {
              traceback: 'Traceback: event-only heater failure',
              logs: ['heater stopped', 'safety check required']
            }
          }
        ]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('Traceback: event-only heater failure')
    expect(html).toContain('safety check required')
  })

  it('shows only the selected failed node error log in the node details', () => {
    const selectedNode: WorkflowOutputNode = {
      nodeId: 'job-heat',
      sourceNodeId: 'heat',
      nodeType: 'action',
      state: 'failed',
      result: {
        error_info: ['Traceback: selected heater failure']
      },
      attempt: 1
    }
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={0}
        expectedNodeCount={2}
        nodes={[
          selectedNode,
          {
            nodeId: 'job-camera',
            sourceNodeId: 'camera',
            nodeType: 'action',
            state: 'failed',
            result: {
              error_info: ['Traceback: unselected camera failure']
            },
            attempt: 1
          }
        ]}
        nodeNames={{ heat: '加热样品', camera: '拍摄样品' }}
        events={[]}
        error={null}
        selectedNode={selectedNode}
        selectedNodeId="heat"
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    const nodePanel = html.slice(
      html.indexOf('id="workflow-output-panel-nodes"'),
      html.indexOf('id="workflow-output-panel-events"')
    )
    expect(nodePanel).toContain('aria-label="加热样品 错误日志"')
    expect(nodePanel).toContain('Traceback: selected heater failure')
    expect(nodePanel).not.toContain('Traceback: unselected camera failure')
    expect(nodePanel).not.toContain('aria-label="加热样品 节点结果"')
  })

  it('shows logs from the selected successful node and its completion event', () => {
    const selectedNode = {
      nodeId: 'job-heat',
      sourceNodeId: 'heat',
      nodeType: 'action',
      state: 'success' as const,
      result: {
        stdout: 'heater reached 80 C'
      },
      attempt: 1
    }
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={2}
        expectedNodeCount={2}
        nodes={[
          selectedNode,
          {
            nodeId: 'job-camera',
            sourceNodeId: 'camera',
            nodeType: 'action',
            state: 'success',
            result: {},
            attempt: 1
          }
        ]}
        nodeNames={{ heat: '加热样品', camera: '拍摄样品' }}
        events={[
          {
            seq: 7,
            type: 'node.result',
            nodeId: 'job-heat',
            detail: {
              logs: ['temperature stable', 'sample heating completed']
            }
          },
          {
            seq: 8,
            type: 'node.result',
            nodeId: 'job-camera',
            detail: { logs: ['camera-only log'] }
          }
        ]}
        error={null}
        selectedNode={selectedNode}
        selectedNodeId="heat"
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    const nodePanel = html.slice(
      html.indexOf('id="workflow-output-panel-nodes"'),
      html.indexOf('id="workflow-output-panel-events"')
    )
    expect(nodePanel).toContain('aria-label="加热样品 运行日志"')
    expect(nodePanel).toContain('heater reached 80 C')
    expect(nodePanel).toContain('sample heating completed')
    expect(nodePanel).not.toContain('camera-only log')
  })

  it('falls back to successful node lifecycle events when Edge returns no log fields', () => {
    const selectedNode = {
      nodeId: 'heat',
      sourceNodeId: 'heat',
      nodeType: 'action',
      state: 'success' as const,
      result: {},
      attempt: 1
    }
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[selectedNode]}
        nodeNames={{ heat: '加热样品' }}
        events={[
          {
            seq: 408,
            type: 'node.started',
            nodeId: 'heat',
            detail: { attempt: 1 }
          },
          {
            seq: 411,
            type: 'node.result',
            nodeId: 'heat',
            detail: { effects: [], result: {} }
          }
        ]}
        error={null}
        selectedNode={selectedNode}
        selectedNodeId="heat"
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('aria-label="加热样品 运行日志"')
    expect(html).toContain('#408 节点开始执行 (node.started)')
    expect(html).toContain('#411 节点执行成功 (node.result)')
    expect(html).toContain('&quot;effects&quot;: []')
  })

  it('shows action dispatch parameters and execution results in the node log', () => {
    const selectedNode = {
      nodeId: 'job-transfer',
      sourceNodeId: 'transfer',
      nodeType: 'action',
      state: 'success' as const,
      result: {},
      attempt: 1
    }
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[selectedNode]}
        nodeNames={{ transfer: '转移样品' }}
        events={[
          {
            seq: 42,
            type: 'node.dispatched',
            nodeId: 'transfer',
            detail: {
              param: { source: 'tube-a', target: 'plate-a' }
            }
          },
          {
            seq: 44,
            type: 'node.result',
            nodeId: 'transfer',
            detail: {
              return_info: { completed: true, transferred_ul: 50 }
            }
          }
        ]}
        error={null}
        selectedNode={selectedNode}
        selectedNodeId="transfer"
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('动作下发参数')
    expect(html).toContain('&quot;source&quot;: &quot;tube-a&quot;')
    expect(html).toContain('执行结果')
    expect(html).toContain('&quot;transferred_ul&quot;: 50')
  })

  it('labels the durable dispatch and feedback event types', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="events"
        completedNodeCount={0}
        expectedNodeCount={0}
        nodes={[]}
        nodeNames={{}}
        events={[
          { seq: 1, type: 'node.dispatched', nodeId: 'transfer' },
          { seq: 2, type: 'node.feedback', nodeId: 'transfer' }
        ]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('动作已下发')
    expect(html).toContain('动作反馈')
  })
})
