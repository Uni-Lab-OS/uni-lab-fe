import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  WorkflowOutput,
  type WorkflowOutputNode
} from './WorkflowOutput'

/**
 * 为静态渲染测试提供无副作用回调。
 *
 * @returns 无。
 */
function noop(): void {}

describe('WorkflowOutput', () => {
  it('centers the node result status with its copy action', () => {
    const stylesheet = readFileSync(fileURLToPath(new URL(
      './_workflow-output.scss',
      import.meta.url
    )), 'utf8')

    expect(stylesheet).toMatch(
      /node-result\) > header\s*> :global\(\.workflow-runtime__node-detail-actions\)\s*\{\s*align-items:\s*center;/u
    )
  })

  it('keeps the node panel hidden when another output tab is active', () => {
    const stylesheet = readFileSync(fileURLToPath(new URL(
      './_workflow-output.scss',
      import.meta.url
    )), 'utf8')

    expect(stylesheet).toMatch(
      /#workflow-output-panel-nodes\)\[hidden\]\s*\{\s*display:\s*none;/u
    )
  })

  it('renders the Trace action beside runtime output controls when available', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        resizable
        activeTab="nodes"
        completedNodeCount={0}
        expectedNodeCount={0}
        nodes={[]}
        nodeNames={{}}
        activity={[]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={noop}
        onTabChange={noop}
        onNodeSelect={noop}
        onClearError={noop}
        onTraceOpen={noop}
      />
    )

    expect(html).toContain('aria-label="查看工作流 Trace"')
    expect(html.indexOf('workflow-runtime__output-trace'))
      .toBeLessThan(html.indexOf('workflow-runtime__output-fullscreen'))
  })

  /** 可调整高度的 dev 输出区始终可见，不再维护另一套展开/收起交互。 */
  it('uses height dragging instead of expand and collapse controls', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded={false}
        resizable
        activeTab="nodes"
        completedNodeCount={0}
        expectedNodeCount={0}
        nodes={[]}
        nodeNames={{}}
        activity={[]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={noop}
        onTabChange={noop}
        onNodeSelect={noop}
        onClearError={noop}
      />
    )

    expect(html).toContain('aria-label="调整运行输出高度"')
    expect(html).toContain('aria-valuemin="48"')
    expect(html).toContain('workflow-runtime__output-body')
    expect(html).not.toContain('workflow-runtime__output-toggle')
    expect(html).not.toContain('展开运行输出')
    expect(html).not.toContain('收起运行输出')
  })

  /**
   * 验证动态运行节点只展示节点名称，不展示节点或作业 UUID。
   * 参数：无。返回：无；身份泄露时由 Vitest 报告失败。
   */
  it('动态运行节点只显示节点名称', () => {
    const jobUuid = '40000000-0000-4000-8000-000000000042'
    const nodeUuid = '20000000-0000-4000-8000-000000000011'
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[{
          nodeId: jobUuid,
          sourceNodeId: nodeUuid,
          nodeType: 'action',
          state: 'success',
          result: {},
          attempt: 2
        }]}
        nodeNames={{
          [nodeUuid]: '称量样品'
        }}
        activity={[]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={noop}
        onTabChange={noop}
        onNodeSelect={noop}
        onClearError={noop}
      />
    )

    expect(html).toContain('class="is-node-name">称量样品</span>')
    expect(html).toContain('操作节点')
    expect(html).toContain('第 2 次')
    expect(html).not.toContain(jobUuid)
    expect(html).not.toContain(nodeUuid)
  })

  /**
   * 验证名称缺失时使用中性占位，不把节点 UUID 当成名称展示。
   * 参数：无。返回：无；ID 被渲染时由 Vitest 报告失败。
   */
  it('名称缺失时不回退显示节点 ID', () => {
    const nodeUuid = '20000000-0000-4000-8000-000000000011'
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={0}
        expectedNodeCount={1}
        nodes={[{
          nodeId: 'job-without-name',
          sourceNodeId: nodeUuid,
          nodeType: 'action',
          state: 'running',
          result: {},
          attempt: 1
        }]}
        nodeNames={{ [nodeUuid]: nodeUuid }}
        activity={[]}
        error={null}
        selectedNode={undefined}
        selectedNodeId={null}
        pausedBeforeNodeId={null}
        onExpandedChange={noop}
        onTabChange={noop}
        onNodeSelect={noop}
        onClearError={noop}
      />
    )

    expect(html).toContain('class="is-node-name">未命名节点</span>')
    expect(html).not.toContain(nodeUuid)
    expect(html).not.toContain('job-without-name')
  })

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
        activity={[]}
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
        activity={[
          {
            key: 'activity-7',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 7',
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
        activity={[]}
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
        activity={[
          {
            key: 'activity-7',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 7',
            type: 'node.result',
            nodeId: 'job-heat',
            detail: {
              logs: ['temperature stable', 'sample heating completed']
            }
          },
          {
            key: 'activity-8',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 8',
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
    expect(nodePanel).toContain('aria-label="复制运行日志"')
    expect(nodePanel).toContain('aria-label="复制运行结果"')
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
        activity={[
          {
            key: 'activity-408',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 408',
            type: 'node.started',
            nodeId: 'heat',
            detail: { attempt: 1 }
          },
          {
            key: 'activity-411',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 411',
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
    expect(html).toContain('步骤 408 节点开始执行')
    expect(html).toContain('步骤 411 节点执行成功')
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
        activity={[
          {
            key: 'activity-42',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 42',
            type: 'node.dispatched',
            nodeId: 'transfer',
            detail: {
              param: { source: 'tube-a', target: 'plate-a' }
            }
          },
          {
            key: 'activity-44',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 44',
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

  it('presents node result metadata as a readable summary with raw data available', () => {
    const selectedNode = {
      nodeId: 'job-material-source',
      sourceNodeId: 'material-source',
      nodeType: 'material_source',
      state: 'success' as const,
      result: {
        job_uuid: 'job-42',
        workflow_node_uuid: 'node-42',
        executor_kind: 'material_source',
        status: 'succeeded'
      },
      attempt: 1
    }
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="nodes"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[selectedNode]}
        nodeNames={{ 'material-source': 'Material Source' }}
        activity={[]}
        error={null}
        selectedNode={selectedNode}
        selectedNodeId="material-source"
        pausedBeforeNodeId={null}
        onExpandedChange={() => {}}
        onTabChange={() => {}}
        onNodeSelect={() => {}}
        onClearError={() => {}}
      />
    )

    expect(html).toContain('aria-label="Material Source 节点结果"')
    expect(html).toContain('运行结果')
    expect(html).toContain('执行成功')
    expect(html).toContain('Job ID')
    expect(html).toContain('节点 ID')
    expect(html).toContain('workflow-runtime__node-result-raw')
    expect(html).not.toContain('查看原始数据')
    expect(html).toContain('&quot;job_uuid&quot;: &quot;job-42&quot;')
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
        activity={[
          { key: 'activity-1',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 1', type: 'node.dispatched', nodeId: 'transfer' },
          {
            key: 'activity-2',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 2',
            type: 'node.feedback',
            nodeId: 'transfer',
            detail: { progress: 0.5 }
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

    expect(html).toContain('动作已下发')
    expect(html).toContain('动作反馈')
    expect(html).toContain('按 OS 权威时间排序，最新记录在前')
    expect(html.indexOf('步骤 2')).toBeLessThan(html.indexOf('步骤 1'))
    expect(html).toContain('class="workflow-runtime__event-raw"')
    expect(html).toContain('查看原始数据')
    expect(html).not.toMatch(/workflow-runtime__event-raw" open/)
  })

  it('labels authoritative Job status records by workflow step', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="events"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[]}
        nodeNames={{ transfer: '转移样品' }}
        activity={[{
          key: 'activity-2',
            occurredAt: '2026-08-03T06:00:00.000Z',
            positionLabel: '步骤 2',
          type: 'node.result',
          nodeId: 'transfer'
        }]}
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

    expect(html).toContain('<b>步骤 2</b>')
    expect(html).toContain('dateTime="2026-08-03T06:00:00.000Z"')
    expect(html).not.toContain('<code>#2</code>')
  })

  it('renders cancellation as cancellation instead of success', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        activeTab="events"
        completedNodeCount={1}
        expectedNodeCount={1}
        nodes={[]}
        nodeNames={{ transfer: '转移样品' }}
        activity={[{
          key: 'job-canceled',
          occurredAt: '2026-08-03T06:00:03Z',
          positionLabel: '步骤 2',
          type: 'node.canceled',
          nodeId: 'transfer'
        }]}
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

    expect(html).toContain('节点已取消')
    expect(html).not.toContain('节点执行成功')
  })

  it('renders an accessible upward drag handle for the persistent output', () => {
    const html = renderToStaticMarkup(
      <WorkflowOutput
        expanded
        resizable
        activeTab="nodes"
        completedNodeCount={0}
        expectedNodeCount={0}
        nodes={[]}
        nodeNames={{}}
        activity={[]}
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

    expect(html).toContain('aria-label="调整运行输出高度"')
    expect(html).toContain('aria-orientation="horizontal"')
    expect(html).toContain('--workflow-output-height:120px')
    expect(html).toContain('aria-label="全屏显示运行输出"')
  })
})
