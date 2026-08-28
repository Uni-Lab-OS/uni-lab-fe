import { readFileSync } from 'node:fs'

import type { PropsWithChildren } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { WorkflowNode } from '../utils/parseWorkflow'
import WorkflowDag from './WorkflowDag'

vi.mock('reactflow', () => ({
  default: ({
    children,
    deleteKeyCode,
    nodes,
    edges,
    fitViewOptions
  }: PropsWithChildren<{
    deleteKeyCode?: string[] | null
    nodes: Array<{
      id: string
      className?: string
      deletable?: boolean
      selected?: boolean
    }>
    edges: Array<{ id: string; deletable?: boolean }>
    fitViewOptions?: { maxZoom?: number }
  }>) => (
    <div
      data-delete-keys={JSON.stringify(deleteKeyCode)}
      data-node-deletable={String(nodes[0]?.deletable)}
      data-node-selection={nodes.map((node) => String(node.selected)).join(',')}
      data-node-classes={nodes.map((node) => node.className).join('|')}
      data-edge-id={edges[0]?.id}
      data-fit-max-zoom={fitViewOptions?.maxZoom}
    >
      {children}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Panel: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('../hooks/useWorkflowDag', () => ({
  useWorkflowDag: (nodes: WorkflowNode[]) => ({
    nodes: nodes.map((node) => ({
      id: node.id,
      position: { x: 0, y: 0 },
      selected: true,
      data: { id: node.id, name: node.name, kind: node.type }
    })),
    edges: [{
      id: 'edge-1',
      source: nodes[0]?.id,
      target: nodes[0]?.id,
      selected: false
    }],
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn()
  })
}))

describe('WorkflowDag control explanations', () => {
  /**
   * 证明布局应用入口在禁用态下同样不会泄漏到可访问树或提示层。
   *
   * @returns 无返回值；断言按钮及其禁用原因均不渲染。
   * @throws 隐藏入口仍残留可访问标记时由 Vitest 抛出。
   * @safety 仅检查静态标记，不修改工作流（Workflow）。
   */
  it('keeps the hidden layout action out of disabled explanations', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[workflowNode]}
        links={[]}
        canBeautify={false}
        onNodeSelect={vi.fn()}
      />
    )
    expect(markup).not.toContain('title="请先完成当前 Python 编译"')
    expect(markup).not.toContain(
      'aria-description="请先完成当前 Python 编译"'
    )
    expect(markup).not.toContain(
      'data-disabled-reason="请先完成当前 Python 编译"'
    )
    expect(markup).not.toContain('workflow-runtime__beautify')
  })

  /** 证明统一提示限制视口宽度，并允许长文案完整换行。 */
  it('keeps the tooltip inside the viewport and wraps long copy', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-foundations.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /workflowDisabledButtonTooltip[\s\S]*position:\s*fixed/
    )
    expect(stylesheet).toMatch(
      /workflowDisabledButtonTooltip[\s\S]*max-width:\s*min\(/
    )
    expect(stylesheet).toMatch(
      /workflowDisabledButtonTooltip[\s\S]*white-space:\s*normal/
    )
    expect(stylesheet).toMatch(
      /workflowDisabledButtonTooltip[\s\S]*overflow-wrap:\s*anywhere/
    )
  })
})

describe('WorkflowDag deletion interaction', () => {
  /** 验证画布模式呈现统一删除按钮，并把双删除键交给受控删除入口。 */
  it('exposes deletion for the selected editable node without visual mutation', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[workflowNode]}
        links={[]}
        canvasMutationEnabled
        selectedNodeId={workflowNode.id}
        onNodeSelect={vi.fn()}
        onDeleteRequest={vi.fn()}
      />
    )

    expect(markup).toContain('data-delete-keys="[&quot;Delete&quot;,&quot;Backspace&quot;]"')
    expect(markup).toContain('data-node-deletable="false"')
    expect(markup).toContain('删除选中项')
    expect(markup).not.toMatch(/data-disabled-reason="[^"]+"[^>]*>[^<]*删除选中项/)
  })

  /** 验证复合工作流内部节点的删除按钮保持禁用并展示完整原因。 */
  it('keeps a private node deletion disabled with an explicit reason', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[{
          ...workflowNode,
          authoringReadOnly: true,
          authoringReadOnlyReason:
            '复合工作流内部私有节点只读；请删除或编辑调用边界'
        }]}
        links={[]}
        canvasMutationEnabled
        selectedNodeId={workflowNode.id}
        onNodeSelect={vi.fn()}
        onDeleteRequest={vi.fn()}
      />
    )

    expect(markup).toContain(
      'data-disabled-reason="复合工作流内部私有节点只读；请删除或编辑调用边界"'
    )
  })
})

describe('WorkflowDag IDE source selection', () => {
  /** 验证代码光标反查到的节点成为 React Flow 唯一可见选中项。 */
  it('projects the externally selected workflow node into the canvas', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[
          workflowNode,
          { ...workflowNode, id: 'node-2', name: '第二个动作' }
        ]}
        links={[]}
        selectedNodeId="node-2"
        onNodeSelect={vi.fn()}
      />
    )

    expect(markup).toContain('data-node-selection="false,true"')
    expect(markup).toMatch(
      /data-node-classes="[^"]*\|[^"]*wf-flow-node--source-selected/
    )
  })

  /** 运行输出定位到折叠组合内部节点时，应选择当前可见的组合边界。 */
  it('maps an externally selected hidden child to its collapsed group', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[
          {
            ...workflowNode,
            id: 'group-1',
            name: '标准转运',
            type: 'group',
            groupKind: 'subworkflow',
            collapsedByDefault: true,
            childNodeIds: ['child-1'],
            descendantNodeIds: ['child-1']
          },
          {
            ...workflowNode,
            id: 'child-1',
            name: '内部动作',
            parentGroupId: 'group-1'
          }
        ]}
        links={[]}
        selectedNodeId="child-1"
        onNodeSelect={vi.fn()}
      />
    )

    expect(markup).toContain('data-node-selection="true"')
    expect(markup).toContain('wf-flow-node--source-selected')
    expect(markup).not.toContain('data-node-selection="false"')
  })

  /** 运行输出的揭示请求直接成为可见选中项，并携带独立运行态选择类。 */
  it('projects a runtime reveal request into a durable canvas highlight', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[
          workflowNode,
          { ...workflowNode, id: 'node-2', name: '第二个动作' }
        ]}
        links={[]}
        revealNodeRequest={{ nodeId: 'node-2', nonce: 1 }}
        onNodeSelect={vi.fn()}
      />
    )

    expect(markup).toContain('data-node-selection="false,true"')
    expect(markup).toContain('wf-flow-node--runtime-selected')
  })
})

describe('WorkflowDag material handles and execution signals', () => {
  /** 蛇形返程必须服从 React Flow 的实际侧边，不能再按输入输出语义写死。 */
  it('anchors horizontal material handles by their rendered side', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-primary-sample.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /handle--material\.react-flow__handle-left[\s\S]*left:\s*-7px/
    )
    expect(stylesheet).toMatch(
      /handle--material\.react-flow__handle-right[\s\S]*right:\s*-7px/
    )
    expect(stylesheet).not.toMatch(
      /handle--target\.react-flow__handle-left/
    )
    expect(stylesheet).not.toMatch(
      /handle--source\.react-flow__handle-right/
    )
  })

  /** 运行与成功使用既有色票的强信号环，并为减弱动态偏好关闭脉冲。 */
  it('keeps running and success prominent without introducing new colors', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-execution-status.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /wf-flow-node--running[\s\S]*outline:\s*2px[\s\S]*unilab-color-warning/
    )
    expect(stylesheet).toMatch(
      /wf-flow-node--success[\s\S]*outline:\s*2px[\s\S]*unilab-color-success/
    )
    expect(stylesheet).toContain(
      '.wf-node:not(.wf-node--material-source):not(.wf-node--robot-transfer)'
    )
    expect(stylesheet).toMatch(
      /wf-flow-node--running[\s\S]*wf-node__material-source-visual[\s\S]*wf-node__robot-transfer-visual[\s\S]*drop-shadow[\s\S]*unilab-color-warning/
    )
    expect(stylesheet).toMatch(
      /wf-flow-node--success[\s\S]*wf-node__material-source-visual[\s\S]*wf-node__robot-transfer-visual[\s\S]*drop-shadow[\s\S]*unilab-color-success/
    )
    const shapeSignalBlock = stylesheet
      .split('/* 图形节点的运行信号')[1]
      ?.split('.workflow :global(.wf-node__state--running)')[0] ?? ''
    expect(shapeSignalBlock).not.toMatch(/background:/)
    expect(stylesheet).toContain('@keyframes workflow-execution-running-signal')
    expect(stylesheet).toContain(
      '@keyframes workflow-execution-running-shape-signal'
    )
    expect(stylesheet).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none/
    )
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(stylesheet).not.toMatch(/rgb\(/i)
  })

  /** MaterialSource 横向文字在上、纵向文字在左，Handle 以六边形为锚点。 */
  it('places MaterialSource labels by layout and anchors handles to the hexagon', () => {
    const sourceStylesheet = readFileSync(
      new URL('./_workflow-material-source.scss', import.meta.url),
      'utf8'
    )
    const swimlaneStylesheet = readFileSync(
      new URL('./_workflow-swimlanes.scss', import.meta.url),
      'utf8'
    )
    const transferStylesheet = readFileSync(
      new URL('./_workflow-transfer-node.scss', import.meta.url),
      'utf8'
    )

    expect(sourceStylesheet).toContain('.wf-node__material-source-port')
    expect(sourceStylesheet).toMatch(
      /material-source-port[\s\S]*handle\.react-flow__handle-left[\s\S]*left:\s*0/
    )
    expect(sourceStylesheet).toMatch(
      /material-source-port[\s\S]*handle\.react-flow__handle-right[\s\S]*right:\s*0/
    )
    expect(sourceStylesheet).toMatch(
      /wf-node--material-source[\s\S]*flex-direction:\s*row/
    )
    expect(swimlaneStylesheet).toMatch(
      /layout-direction='horizontal'[\s\S]*flex-direction:\s*column/
    )
    expect(swimlaneStylesheet).toMatch(
      /wf-node--material-source\[data-workflow-layout-direction='horizontal'\][\s\S]*height:\s*126px;[\s\S]*max-height:\s*126px;/
    )
    expect(swimlaneStylesheet).toMatch(
      /wf-node--material-source\[data-workflow-layout-direction='horizontal'\][\s\S]*material-source-label[\s\S]*height:\s*53px;[\s\S]*align-content:\s*start;/
    )
    expect(transferStylesheet).toMatch(
      /robot-transfer-visual[\s\S]*color:\s*var\(--unilab-color-text\)[\s\S]*background:\s*var\(--unilab-color-text\)/
    )
    expect(transferStylesheet).toMatch(
      /robot-transfer-visual\)::before[\s\S]*background:\s*var\(--unilab-color-surface\)/
    )
    expect(transferStylesheet).toMatch(
      /wf-node--robot-transfer[\s\S]*flex-direction:\s*row-reverse/
    )
    expect(transferStylesheet).toMatch(
      /layout-direction='horizontal'[\s\S]*robot-transfer-copy[\s\S]*justify-items:\s*center;[\s\S]*text-align:\s*center;/
    )
    expect(transferStylesheet).toMatch(
      /layout-direction='horizontal'[\s\S]*flex-direction:\s*column-reverse/
    )
  })

  /** 泳道尺寸常量包含节点内边距，动作内容必须使用 border-box 才能对齐 Handle。 */
  it('keeps material swimlane action handles inside the declared node box', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-swimlanes.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /layout-strategy='material-swimlanes'[\s\S]*wf-node__body[\s\S]*box-sizing:\s*border-box/
    )
  })
})

describe('WorkflowDag material role filter', () => {
  /** 验证物料流角色（MaterialFlowRole）显隐使用带文字的独立复选框。 */
  it('exposes independently selectable role visibility without color-only cues', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[
          materialSourceNode('sample-source', '主样品', 'primary_sample'),
          materialSourceNode('reagent-source', '试剂', 'reagent')
        ]}
        links={[]}
        onNodeSelect={vi.fn()}
      />
    )

    expect(markup).toContain('aria-label="物料节点可见性：全部物料"')
    expect(markup).toContain('aria-label="物料节点可见性"')
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('主样品')
    expect(markup).toContain('试剂')
    expect(markup).toContain('全部物料')
  })
})

describe('WorkflowDag host sizing', () => {
  /** 小型纵向流程应允许适度放大，避免在高画布中只占顶部一小块。 */
  it('lets fitView use the available authoring canvas', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[workflowNode]}
        links={[]}
        onNodeSelect={vi.fn()}
      />
    )

    expect(markup).toContain('data-fit-max-zoom="1.2"')
  })

  /** Theia 窄分栏仍是高桌面面板，不能套用移动端 260px 固定画布。 */
  it('keeps the responsive graph stage stretched to its grid row', () => {
    const stylesheet = readFileSync(
      new URL('./workflow-persistent/_section-06.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /persistent-authoring__graph-stage[\s\S]*height:\s*100%/
    )
    expect(stylesheet).not.toMatch(
      /persistent-authoring__graph-stage[\s\S]{0,160}\n\s+height:\s*260px/
    )

    const foundations = readFileSync(
      new URL('./_workflow-foundations.scss', import.meta.url),
      'utf8'
    )
    expect(foundations).toMatch(
      /\.dag\s*\{[^}]*min-width:\s*1px;[^}]*min-height:\s*1px;/s
    )
  })
})

describe('WorkflowDag canvas controls', () => {
  /**
   * 证明画布按钮按任务分组，并暂时隐藏会写回工作流草稿的布局应用入口。
   *
   * @returns 无返回值；断言布局选择器保留且“应用布局”按钮不进入可操作界面。
   * @throws 布局应用入口重新渲染时由 Vitest 抛出。
   * @safety 仅检查服务端静态标记，不写入工作流（Workflow）草稿。
   */
  it('groups view actions while hiding the layout apply action', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDag
        nodes={[
          workflowNode,
          materialSourceNode('sample-source', '主样品', 'primary_sample')
        ]}
        links={[]}
        canvasMutationEnabled
        onNodeSelect={vi.fn()}
        onDeleteRequest={vi.fn()}
        onBeautify={vi.fn()}
      />
    )

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="画布视图与布局工具"')
    expect(markup).toContain('aria-label="视图与选择"')
    expect(markup).toContain('aria-label="物料筛选与布局"')
    expect(markup).toContain('workflow-runtime__canvas-button')
    expect(markup).toContain('aria-label="布局策略"')
    expect(markup).not.toContain('workflow-runtime__beautify')
    expect(markup).not.toContain('应用布局')
    expect(markup).toContain(
      'data-workflow-layout-direction="horizontal"'
    )
    expect(markup).toContain('aria-label="辅助物料展示方式"')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>只看主物料</)
    expect(markup).toMatch(/aria-pressed="false"[^>]*>完整支线</)
  })

  /** 证明交互态与窄视口规则不依赖运行时内联样式。 */
  it('defines primary, danger, focus and compact responsive states', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-beautify.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /workflow-runtime__beautify[\s\S]*background:\s*var\(--unilab-color-workflow\)/
    )
    expect(stylesheet).toMatch(
      /delete-selection\):hover:not\(:disabled\)[\s\S]*unilab-color-danger/
    )
    expect(stylesheet).toMatch(/canvas-button\):focus-visible/)
    expect(stylesheet).toMatch(
      /supporting-material-presentation\)[\s\S]*min-width:\s*70px[\s\S]*white-space:\s*nowrap/
    )
    expect(stylesheet).toMatch(/@container workflow \(max-width: 900px\)/)
  })

  /** 证明横向蛇形节点纵向堆叠物料卡片，并把 Handle 固定到东西两侧。 */
  it('defines compact vertical node content with east-west handles', () => {
    const stylesheet = readFileSync(
      new URL('./_workflow-primary-sample.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(/flex-direction:\s*column/)
    expect(stylesheet).toMatch(/react-flow__handle-left/)
    expect(stylesheet).toMatch(/react-flow__handle-right/)
    expect(stylesheet).toMatch(
      /wf-node__handle--material\.react-flow__handle-left/
    )
    expect(stylesheet).toMatch(
      /wf-node__handle--material\.react-flow__handle-right/
    )
    expect(stylesheet).toMatch(/wf-node__material-port-label/)
    expect(stylesheet).toMatch(/data-workflow-material-emphasis='supporting'/)
    expect(stylesheet).toMatch(/wf-flow-edge--supporting-material/)
    expect(stylesheet).toMatch(
      /react-flow__edge\.wf-flow-edge--supporting-material[\s\S]*opacity:\s*1/
    )

    const swimlaneStylesheet = readFileSync(
      new URL('./_workflow-swimlanes.scss', import.meta.url),
      'utf8'
    )
    expect(swimlaneStylesheet).toMatch(
      /wf-node__handle--material[\s\S]*width:\s*12px;[\s\S]*height:\s*12px;[\s\S]*border-radius:\s*50%/
    )
  })

  /** 证明执行顺序 Handle 的长轴始终垂直于当前图布局方向。 */
  it('rotates sequence handle long axes perpendicular to graph flow', () => {
    const routingStylesheet = readFileSync(
      new URL('./_workflow-dag-routing.scss', import.meta.url),
      'utf8'
    )
    expect(routingStylesheet).toMatch(
      /wf-node__handle--ready[\s\S]*width:\s*12px;[\s\S]*height:\s*3px;/
    )
    expect(routingStylesheet).toMatch(
      /react-flow__handle-left[\s\S]*react-flow__handle-right[\s\S]*width:\s*3px;[\s\S]*height:\s*12px;/
    )
  })

  /** 证明细连线保留原视觉宽度，同时具有足够稳定的透明点击热区。 */
  it('gives workflow edges a wide invisible selection target', () => {
    const edgeSource = readFileSync(
      new URL('./WorkflowRoundedStepEdge.tsx', import.meta.url),
      'utf8'
    )
    expect(edgeSource).toMatch(
      /interactionWidth=\{Math\.max\(interactionWidth \?\? 0, 28\)\}/
    )
    expect(edgeSource).toMatch(/data-workflow-edge-kind=/)
  })
})

const workflowNode: WorkflowNode = {
  id: 'node-1',
  name: '示例动作',
  type: 'action',
  className: 'ExampleDevice',
  labNodeType: 'Device'
}

function materialSourceNode(
  id: string,
  name: string,
  flowRole: string
): WorkflowNode {
  return {
    id,
    name,
    type: 'material_source',
    className: 'MaterialSource',
    labNodeType: 'MaterialSource',
    handles: [{
      uuid: `${id}-resource`,
      handleKey: 'resource',
      displayName: '物料',
      ioType: 'source',
      valueType: 'ResourceSlot',
      valueSchema: { $slot: 'ResourceSlot' }
    }],
    materialSource: {
      mode: 'existing',
      flowRole,
      mountUuid: 'mount-1',
      resourceTemplateUuid: 'resource-template-1'
    }
  }
}
