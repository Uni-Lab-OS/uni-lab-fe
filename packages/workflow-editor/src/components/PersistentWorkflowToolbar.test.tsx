import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { workflowTaskControls } from '../utils/workflowTaskPresentation'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { PersistentWorkflowToolbar } from './PersistentWorkflowToolbar'

describe('PersistentWorkflowToolbar', () => {
  it('keeps navigation and edit mode on one compact debugger toolbar', () => {
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar model={toolbarModel()} />
    )

    expect(html).toContain('工作流列表')
    expect(html).toContain('代码模式')
    expect(html).toContain('画布模式')
    expect(html).toContain('aria-label="保存工作流"')
    expect(html).toContain('aria-label="开始运行"')
    expect(html).toContain('调试启动')
    expect(html.indexOf('工作流列表')).toBeLessThan(html.indexOf('代码模式'))
    expect(html).not.toContain('导入 Python')
    expect(html).not.toContain('导入 JSON')
    expect(html).not.toContain('更多工作流操作')
  })

  it('disables saving when the installed topology authority is read-only', () => {
    const model = toolbarModel()
    model.aggregate = {} as PersistentWorkflowAuthoringModel['aggregate']
    model.policy = {
      pythonEditorReadOnly: true,
      canvasMutationEnabled: false,
      authoringMutationEnabled: false
    }
    const html = renderToStaticMarkup(
      <PersistentWorkflowToolbar model={model} />
    )

    expect(html).toMatch(
      /aria-label="保存工作流"[^>]*disabled=""[^>]*data-disabled-reason="受管精确拓扑由 OS 管理，只能查看"/
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
    policy: {
      pythonEditorReadOnly: true,
      canvasMutationEnabled: true,
      authoringMutationEnabled: true
    },
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
