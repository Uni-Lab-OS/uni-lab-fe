import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { workflowTaskControls } from '../utils/workflowTaskPresentation'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'

describe('PersistentWorkflowToolbar', () => {
  it('keeps navigation and edit mode on one compact debugger toolbar', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar
        model={toolbarModel()}
        onResetEnvironment={async () => {}}
      />
    )

    expect(html).toContain('工作流列表')
    expect(html).toContain('代码模式')
    expect(html).toContain('画布模式')
    expect(html).toContain('aria-label="保存工作流"')
    expect(html).toContain('aria-label="开始运行"')
    expect(html).toContain('aria-label="复位运行环境"')
    expect(html.indexOf('aria-label="复位运行环境"')).toBeLessThan(
      html.indexOf('aria-label="开始运行"')
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
        onResetEnvironment={async () => {}}
        environmentResetBusy
      />
    )

    expect(html).toMatch(
      /<button[^>]*aria-label="复位运行环境"[^>]*disabled=""[^>]*data-disabled-reason="正在处理运行环境，请稍候"/
    )
    expect(html).toMatch(
      /<button[^>]*aria-label="开始运行"[^>]*disabled=""[^>]*data-disabled-reason="运行前环境正在复位，请等待安全校验完成"/
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

function toolbarModel(): PersistentWorkflowAuthoringModel {
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
    }
  } as unknown as PersistentWorkflowAuthoringModel
}
