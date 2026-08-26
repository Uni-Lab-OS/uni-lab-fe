import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const componentDirectory = fileURLToPath(new URL('.', import.meta.url))

/** 读取工作流视图源码，验证 OS 与 Backend 是否经过同一个工作区 seam。 */
function componentSource(name: string): string {
  return readFileSync(`${componentDirectory}/${name}`, 'utf8')
}

describe('Workflow workspace authority', () => {
  /** OS 与 Backend 必须复用唯一工作区实现，避免部署差异产生第二套页面。 */
  it('routes both definition adapters through the persistent workspace', () => {
    expect(componentSource('WorkflowPanel.tsx'))
      .toContain('definitionAuthority={definitionAuthority}')
    expect(componentSource('WorkflowPanel.tsx'))
      .toContain('<PersistentWorkflowAuthoringPanel')
    expect(componentSource('PersistentWorkflowToolbar.tsx'))
      .toContain('WorkflowWorkspaceToolbar')
    expect(existsSync(
      `${componentDirectory}/ExistingWorkflowRuntimePanel.tsx`
    )).toBe(false)
    expect(existsSync(
      `${componentDirectory}/ExistingWorkflowRuntimeToolbar.tsx`
    )).toBe(false)
  })

  /** 两种工作流权威来源必须共用画布身份和投影状态标题条。 */
  it('keeps one canvas stage for OS and Backend projections', () => {
    expect(componentSource('PersistentWorkflowAuthoringView.tsx'))
      .toContain('WorkflowCanvasStageHeader')
    expect(existsSync(
      `${componentDirectory}/ExistingWorkflowCanvas.tsx`
    )).toBe(false)
  })

  /** 任务详情只隐藏编辑/运行工具条，画布筛选与布局控件仍需用于查看冻结快照。 */
  it('keeps canvas view controls in the task detail workspace', () => {
    const taskList = componentSource('WorkflowTaskList.tsx')
    const authoringView = componentSource('PersistentWorkflowAuthoringView.tsx')
    const dag = componentSource('WorkflowDag.tsx')

    expect(taskList).toContain('hideRuntimeControls')
    expect(authoringView).toMatch(
      /!hideRuntimeControls\s*\?\s*\(\s*<PersistentWorkflowToolbar/u
    )
    expect(authoringView).toMatch(
      /!hideRuntimeControls\s*&&\s*\(\s*<WorkflowCanvasStageHeader/u
    )
    expect(authoringView).toContain('<WorkflowDag')
    expect(authoringView).not.toMatch(
      /!hideRuntimeControls[\s\S]{0,120}<WorkflowDag/u
    )
    expect(authoringView).toMatch(
      /onDeleteRequest=\{canvasMutationEnabled\s*\?\s*deleteCanvasElements\s*:\s*undefined\}/u
    )
    expect(authoringView).toMatch(
      /!compactCanvas\s*&&\s*canvasMutationEnabled\s*&&\s*\(\s*<button[\s\S]{0,500}\{nodePaletteOpen \? '隐藏节点库' : '显示节点库'\}/u
    )
    expect(dag).toContain('aria-label="物料筛选与布局"')
    expect(dag).toContain('<WorkflowMaterialVisibilityControl')
    expect(dag).toContain('<WorkflowSupportingMaterialPresentationControl')
  })

  /** 属性面板只展示选中节点的说明，不得用保存或投影错误充当描述。 */
  it('renders the selected node description in the inspector', () => {
    const view = componentSource('PersistentWorkflowAuthoringView.tsx')

    expect(view).toContain('selectedNodeDescription')
    expect(view).toContain('节点说明')
    expect(view).toContain('当前节点暂无描述')
    expect(view).not.toContain('操作模板或端口读取失败：')
    expect(view).not.toMatch(/<p id="persistent-node-name-help">/u)
  })

  /** Backend 只读控件可以有适配样式，但不得恢复独立页面壳。 */
  it('removes the Backend-only workspace shell stylesheet', () => {
    expect(existsSync(
      `${componentDirectory}/_workflow-existing-runtime.scss`
    )).toBe(false)
    expect(componentSource('workflow.module.scss'))
      .toContain("@use './workflow-readonly-controls';")
  })

  /** 窄分栏下运行操作与同步状态必须分行，不能覆盖工作流摘要。 */
  it('wraps the persistent toolbar in a narrow workspace', () => {
    const stylesheet = componentSource('workflow-persistent/_section-01.scss')
    expect(stylesheet).toMatch(
      /@container workflow \(max-width: 720px\)[\s\S]*?\.persistent-authoring__toolbar\)[^{]*\{[^}]*flex-wrap:\s*wrap/u
    )
    expect(stylesheet).toMatch(
      /\.persistent-authoring__toolbar-message\)[^{]*\{[^}]*flex:\s*1 0 100%[^}]*order:\s*3/u
    )
    expect(componentSource('_workflow-canvas-ux.scss')).toMatch(
      /@container workflow \(max-width: 720px\)[\s\S]*?\.workflow__toolbar\)[^{]*\{[^}]*height:\s*auto[^}]*flex-basis:\s*auto/u
    )
  })

  /** 窄分栏下运行输出标签必须保持单行，并由标签容器承接横向滚动。 */
  it('keeps output tabs readable in a narrow workspace', () => {
    const outputStylesheet = componentSource('_workflow-output.scss')
    expect(outputStylesheet).toMatch(
      /\.workflow-runtime__output-tabs\)[^{]*\{[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*hidden/u
    )
    expect(outputStylesheet).toMatch(
      /\.workflow-runtime__output-tabs\) button[^{]*\{[^}]*white-space:\s*nowrap/u
    )
    expect(outputStylesheet).toMatch(
      /@container workflow \(max-width: 720px\)[\s\S]*?\.workflow-runtime__output-tabs\) button[^{]*\{[^}]*min-width:\s*max-content[^}]*flex:\s*0 0 auto/u
    )
  })

  /** 单工作流宽屏保持单行；工作流与物料分栏变窄后才上下排列参数名称。 */
  it('stacks translated parameter names only in a narrow workflow pane', () => {
    const stylesheet = componentSource(
      'workflow-persistent/_section-04.scss'
    )
    expect(stylesheet).toMatch(
      /\.persistent-authoring__io-editor-identity-text\)[^{]*\{[^}]*display:\s*flex/u
    )
    expect(stylesheet).toMatch(
      /@container workflow \(max-width: 720px\)[\s\S]*?\.persistent-authoring__io-editor-identity-text\)[^{]*\{[^}]*display:\s*grid/u
    )
  })
})
