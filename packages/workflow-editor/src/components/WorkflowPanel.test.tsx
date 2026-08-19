import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { WorkflowRuntimePort, WorkflowSummary } from '@unilab/services'

import WorkflowPanel, {
  WORKFLOW_CATALOG_FILTER_CONTROLS_VISIBLE,
  WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE,
  groupWorkflowCatalog,
  workflowGroupLabel
} from './WorkflowPanel'
import { COMPACT_WORKFLOW_CANVAS_WIDTH } from './PersistentWorkflowAuthoringView'

describe('WorkflowPanel Runtime entry', () => {
  it('loads the current OS workflow catalog when no Workflow is selected', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel runtime={{} as WorkflowRuntimePort} />
    )

    expect(markup).toContain('工作流目录')
    expect(markup).toContain('正在读取工作流')
  })

  it('keeps the Backend catalog read-only when authoring is unavailable', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel
        runtime={{} as WorkflowRuntimePort}
        workflowUuid="10000000-0000-4000-8000-000000000001"
        authoringStatus={{
          available: false,
          reason: '工作流创作语义尚未对齐'
        }}
      />
    )

    expect(markup).toContain('当前 Backend 提供只读目录')
    expect(markup).toContain('工作流创作语义尚未对齐')
    expect(markup).not.toContain('workflow-runtime__authoring')
  })

  /** Backend 运行能力必须进入统一工作流工作区，而不是整页运行表单。 */
  it('opens the existing Workflow in a read-only canvas without exposing authoring', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel
        runtime={{} as WorkflowRuntimePort}
        workflowUuid="10000000-0000-4000-8000-000000000001"
        authoringStatus={{
          available: false,
          reason: 'Backend 未实现工作流创作'
        }}
        runStatus={{ available: true }}
        onResetEnvironment={async () => {}}
      />
    )

    expect(markup).toContain('工作流画布')
    expect(markup).toContain('persistent-authoring__canvas')
    expect(markup).toContain('Backend 定义 · 只读')
    expect(markup).toContain('正在读取 Backend 工作流图')
    expect(markup).toContain('aria-label="开始运行"')
    expect(markup).toContain('aria-label="复位运行环境"')
    expect(markup).toContain('运行设置，当前为正常运行')
    expect(markup).toContain('任务运行模式')
    expect(markup).not.toContain('⌄')
    expect(markup).toContain('persistent-authoring__toolbar-navigation')
    expect(markup).not.toContain('代码模式')
    expect(markup).toContain('画布模式')
    expect(markup).toContain('Backend 未实现工作流创作')
    expect(markup).toContain('>运行输出<')
    expect(markup).toContain('全屏显示运行输出')
    expect(markup).toContain('persistent-authoring__runtime')
    expect(markup).not.toContain('workflow-runtime__existing-run-body')
    expect(markup).not.toContain('已有工作流运行</span>')
    expect(markup).not.toContain('workflow-runtime__authoring')
  })

  /** 固定工作流入口必须把调用方提供的名称传给对应画布。 */
  it('labels a fixed workflow canvas with its explicit workflow name', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel
        runtime={{} as WorkflowRuntimePort}
        workflowUuid="10000000-0000-4000-8000-000000000001"
        workflowName="任务冻结流程"
        authoringStatus={{ available: false, reason: '任务快照只读' }}
        runStatus={{ available: true }}
      />
    )

    expect(markup).toContain('任务冻结流程')
  })

  /** Backend 模式启用直接画布保存，并关闭代码投影入口。 */
  it('opens an editable Backend canvas without code mode', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel
        runtime={{} as WorkflowRuntimePort}
        workflowUuid="10000000-0000-4000-8000-000000000001"
        definitionEditingMode="backend"
        authoringStatus={{ available: true }}
        runStatus={{ available: true }}
      />
    )

    expect(markup).toContain('Backend 定义 · 已同步')
    expect(markup).toContain('正式 Backend 仅支持画布编辑')
    expect(markup).toContain('aria-label="保存工作流"')
    expect(markup).not.toContain('代码模式')
    expect(markup).not.toContain('工作流代码视图')
    expect(markup).not.toContain('Backend 代码视图为只读')
  })

  /** Backend 画布的编辑权与 Edge 运行就绪状态必须解耦。 */
  it('keeps Backend canvas authoring visible while OS execution is unavailable', () => {
    const markup = renderToStaticMarkup(
      <WorkflowPanel
        runtime={{} as WorkflowRuntimePort}
        workflowUuid="10000000-0000-4000-8000-000000000001"
        definitionEditingMode="backend"
        authoringStatus={{ available: true }}
        runStatus={{ available: true }}
        executionStatus={{
          available: false,
          reason: 'OS 尚未启动；请先在环境管理中启动 OS'
        }}
      />
    )

    expect(markup).toContain('Backend 定义 · 已同步')
    expect(markup).toContain('aria-label="保存工作流"')
    expect(markup).toContain('OS 尚未启动；请先在环境管理中启动 OS')
  })

  it('groups catalog entries by station first and declared purpose second', () => {
    const workflows = [
      workflowSummary('S02_离心流程', []),
      workflowSummary('样品归档', ['归档']),
      workflowSummary('临时流程', [])
    ]

    expect(workflowGroupLabel(workflows[0])).toBe('S02 工位')
    expect(groupWorkflowCatalog(workflows).map((group) => group.label)).toEqual([
      'S02 工位',
      '用途 · 归档',
      '未分类'
    ])
  })

  it('temporarily hides workflow catalog change-log and delete actions', () => {
    expect(WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE).toBe(false)
  })

  it('temporarily hides workflow range and status filters', () => {
    expect(WORKFLOW_CATALOG_FILTER_CONTROLS_VISIBLE).toBe(false)
  })

  it('reserves the canvas by collapsing auxiliary panels on narrow workspaces', () => {
    expect(COMPACT_WORKFLOW_CANVAS_WIDTH).toBe(1024)
  })
})

function workflowSummary(name: string, tags: string[]): WorkflowSummary {
  return {
    uuid: `${name}-uuid`,
    create_time: '2026-08-01T00:00:00Z',
    update_time: '2026-08-11T00:00:00Z',
    meta_data: {},
    name,
    tags,
    revision: 1
  }
}
