import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowDebugToolbar } from './WorkflowDebugToolbar'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'

function renderToolbar(overrides: Partial<PersistentWorkflowAuthoringModel> = {}): string {
  const model = {
    aggregate: { workflow_revision: 2, candidate: {} },
    busy: false, runtimeBusy: false, workflowStartBusy: false,
    dirty: false, ideSourceDirty: false, mode: 'canvas',
    task: null, taskHistorical: false, taskRunMode: 'normal',
    taskRuntime: { snapshot: { debug: null } },
    workflowStartPresentation: { disabled: false },
    definitionEditingAvailable: true, canvasValidationAvailable: true,
    saveDraft() {},
    ...overrides
  } as unknown as PersistentWorkflowAuthoringModel
  return renderToStaticMarkup(<WorkflowDebugToolbar model={model} workflowName="真实工作流" structureOpen compact={false} onToggleStructure={() => {}} onToggleLibrary={() => {}} onZoomIn={() => {}} onZoomOut={() => {}} onConfigureIo={() => {}} />)
}

describe('工作流调试工具栏', () => {
  it('未保存的修改只允许保存，不允许发布候选版本', () => {
    const html = renderToolbar({ dirty: true })
    expect(html).toMatch(/<button[^>]*>保存<\/button>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>发布<\/button>/)
  })
  it('只读定义与未加载状态不能通过新工具栏写入或运行', () => {
    const readonly = renderToolbar({ dirty: true, definitionEditingAvailable: false })
    expect(readonly).toMatch(/<button[^>]*disabled=""[^>]*>保存<\/button>/)
    expect(readonly).toMatch(/<button[^>]*disabled=""[^>]*>发布<\/button>/)
    const loading = renderToolbar({ aggregate: null })
    expect(loading).toMatch(/<button[^>]*disabled=""[^>]*>▶ 运行调试<\/button>/)
    expect(loading).toMatch(/<select[^>]*disabled=""/)
  })
  it('没有真实任务时显示未开始，不提供原稿的模拟加速与恢复结果', () => {
    const html = renderToolbar({ debugLaunchAvailable: false })
    expect(html).toContain('未开始')
    expect(html).not.toContain('value="debug"')
    expect(html).not.toContain('加速')
    expect(html).not.toContain('检查点恢复')
    expect(html).not.toContain('已应用版本 · 可编辑')
  })
})
