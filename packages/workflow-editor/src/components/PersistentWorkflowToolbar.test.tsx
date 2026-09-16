import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { WorkflowTask } from '@unilab/services'

import { workflowTaskControls } from '../utils/workflowTaskPresentation'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'

describe('PersistentWorkflowToolbar', () => {
  it('shows all authoritative ready nodes and waits while dispatched actions finish', () => {
    const task = { ...workflowTask('running'), run_mode: 'step' as const, control_status: 'paused' as const }
    const stepState = { workflow_task_uuid: task.uuid, execution_mode: 'switching_to_step', control_status: 'paused',
      can_step: false, requires_selection: true, in_flight_job_count: 2,
      candidates: ['左侧', '右侧'].map((name, index) => ({ node_uuid: String(index), name })),
      hit_breakpoint_node_uuids: ['0', '1'], breakpoint_node_uuids: ['0', '1'] }
    const html = renderToStaticMarkup(<PersistentWorkflowToolbar model={toolbarModel({ task,
      taskControls: workflowTaskControls(task, false), taskRuntime: { command: async () => {},
        snapshot: { stepState, projectionStale: false } } as unknown as PersistentWorkflowAuthoringModel['taskRuntime'] })} />)
    expect(html).toContain('等待 2 个在途动作完成')
    expect(html).toContain('断点已命中：左侧、右侧')
    expect(html).toContain('aria-label="单步就绪节点"')
    expect(html).toContain('<option value="0" selected="">左侧</option>')
    expect(html).toContain('等待在途动作完成和服务确认可单步')
  })

  it('keeps navigation and edit mode on one compact debugger toolbar', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={toolbarModel()}
        environmentReset={{ available: { rebuild: true, materials: true, locks: true },
          preview: async selection => ({ selection, summary: [], execute: async () => [] }) }}
      />
    )

    expect(html).toContain('工作流列表')
    expect(html).toContain('代码模式')
    expect(html).toContain('画布模式')
    expect(html).toContain('aria-label="保存工作流"')
    expect(html).toContain('aria-label="开始运行"')
    expect(html).toContain('aria-label="复位运行环境"')
    expect(html.indexOf('aria-label="开始运行"')).toBeLessThan(
      html.indexOf('aria-label="复位运行环境"')
    )
    expect(html).toContain('正常运行')
    expect(html).toContain('运行设置，当前为正常运行')
    expect(html).toContain('任务运行模式')
    expect(html).toContain('单步模式')
    expect(html).toContain('单节点调试')
    expect(html).toContain('role="menuitemradio"')
    expect(html).not.toContain('⌄')
    expect(html.indexOf('工作流列表')).toBeLessThan(html.indexOf('代码模式'))
    expect(html).not.toContain('导入 Python')
    expect(html).not.toContain('导入 JSON')
    expect(html).not.toContain('更多工作流操作')
  })

  it('disables environment reset while the reset operation is busy', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={toolbarModel()}
        environmentReset={{ available: { rebuild: true, materials: true, locks: true },
          preview: async selection => ({ selection, summary: [], execute: async () => [] }) }}
        environmentResetBusy
      />
    )

    expect(html).toMatch(
      /<button[^>]*aria-label="复位运行环境"[^>]*disabled=""[^>]*data-disabled-reason="正在处理运行环境，请稍候"/
    )
  })

  it('hides code mode when the current authority does not allow code viewing', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={{
          ...toolbarModel(),
          aggregate: {} as PersistentWorkflowAuthoringModel['aggregate'],
          authorityLabel: 'Backend',
          codeViewingAvailable: false,
          sourceEditingAvailable: false,
          sourceEditingDisabledReason: '正式 Backend 仅支持画布模式'
        }}
      />
    )

    expect(html).not.toContain('代码模式')
    expect(html).toContain('画布模式')
  })

  /** 运行中再次启动必须保留入口，并明确创建另一条独立工作流任务。 */
  it('keeps an independent run action available while a task is running', () => {
    const task = workflowTask('running')
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={toolbarModel({
          task,
          taskControls: workflowTaskControls(task, false),
          taskRuntime: {
            command: async () => {},
            snapshot: { debug: null }
          } as unknown as PersistentWorkflowAuthoringModel['taskRuntime']
        })}
      />
    )

    expect(html).toContain('aria-label="再次运行"')
    expect(html).toContain('data-tooltip="再次运行：创建新的独立任务"')
    expect(html).toContain('创建新的独立工作流任务')
    expect(html).toContain('运行中')
  })

  it('enables the shared save button for a dirty registered Theia source', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={{
          ...toolbarModel(),
          aggregate: {} as PersistentWorkflowAuthoringModel['aggregate'],
          mode: 'code',
          ideSourceDirty: true
        }}
      />
    )

    expect(html).toMatch(
      /<button[^>]*aria-label="保存工作流"(?![^>]*disabled=)[^>]*>/
    )
  })

  /** 证明 OS 工作流编写聚合返回前，两个编辑模式入口均不可误触。 */
  it('keeps edit mode unavailable until the OS authoring aggregate loads', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar model={toolbarModel()} />
    )

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-disabled-reason="工作流尚未加载完成"[^>]*>代码模式<\/button>/
    )
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-disabled-reason="工作流尚未加载完成"[^>]*>画布模式<\/button>/
    )
  })
})

/**
 * 构造持久工作流工具栏公开模型。
 *
 * @param overrides 当前场景需要覆盖的权威任务或能力投影。
 * @returns 可供服务端渲染断言的最小工具栏模型。
 */
function toolbarModel(
  overrides: Partial<PersistentWorkflowAuthoringModel> = {}
): PersistentWorkflowAuthoringModel {
  return {
    aggregate: null,
    busy: false,
    dirty: false,
    fullSourceDiff: null,
    message: '工作流已就绪',
    mode: 'canvas',
    onChooseWorkflow: () => {},
    pendingMode: null,
    remoteConflict: null,
    requestMode: () => {},
    runRuntime: () => {},
    runtimeBusy: false,
    saveDraft: () => {},
    selectSingleNodeMode: () => {},
    setTaskRunMode: () => {},
    setTraceViewerOpen: () => {},
    singleNodeTargetMissing: false,
    startWorkflow: () => {},
    task: null,
    taskControls: workflowTaskControls(null, false),
    taskInputForm: null,
    taskRunMode: 'normal',
    taskRuntime: { command: async () => {} },
    traceRuntime: null,
    workflowStartBusy: false,
    workflowStartPresentation: {
      disabled: false,
      disabledReason: null,
      label: '开始运行'
    },
    ...overrides
  } as unknown as PersistentWorkflowAuthoringModel
}

/**
 * 构造指定业务状态的 Backend 工作流任务事实。
 *
 * @param status Backend 返回的工作流任务状态。
 * @returns 带稳定身份和运行控制状态的工作流任务。
 */
function workflowTask(status: WorkflowTask['status']): WorkflowTask {
  return {
    uuid: '20000000-0000-4000-8000-000000000002',
    create_time: '2026-08-20T08:00:00Z',
    update_time: '2026-08-20T08:00:00Z',
    meta_data: {},
    execution_kind: 'workflow',
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    status,
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    error_info: []
  }
}
