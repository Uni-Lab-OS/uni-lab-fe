import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { WorkflowRuntimePort } from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WorkflowTaskList } from './WorkflowTaskList'
import { WorkflowTaskListFailure } from './WorkflowTaskListErrorBoundary'

describe('WorkflowTaskList', () => {
  /** 首帧应立即提供任务页身份、筛选入口与诚实的加载状态。 */
  it('renders the Backend Task queue shell before the first response', () => {
    const markup = renderToStaticMarkup(
      <WorkflowTaskList
        runtime={{} as WorkflowRuntimePort}
      />
    )

    expect(markup).toContain('工作流任务')
    expect(markup).toContain('搜索工作流、Task UUID 或状态')
    expect(markup).toContain('正在读取工作流任务')
    expect(markup).toContain('aria-label="工作流任务状态"')
    expect(markup).toContain('运行变化会实时补读')
  })

  it('supports resizing the task detail pane without showing run mode copy', () => {
    const source = readFileSync(fileURLToPath(new URL(
      './WorkflowTaskList.tsx',
      import.meta.url
    )), 'utf8')
    const stylesheet = readFileSync(fileURLToPath(new URL(
      './_workflow-task-list.scss',
      import.meta.url
    )), 'utf8')

    expect(source).toContain('DEFAULT_TASK_QUEUE_PERCENT = 38')
    expect(source).toContain('aria-label="调整任务列表与任务详情宽度"')
    expect(source).toContain('aria-orientation="vertical"')
    expect(source).toContain('onPointerDown={startTaskQueueResize}')
    expect(source).toContain('onKeyDown={resizeTaskQueueFromKeyboard}')
    expect(source).not.toContain('workflowTaskRunModeLabel')
    expect(stylesheet).toContain('var(--workflow-task-queue-width)')
    expect(stylesheet).toMatch(
      /workflow-task-list__splitter\)[\s\S]*cursor:\s*col-resize;/u
    )
  })

  it('provides distinct, accessible empty and filtered fallback states', () => {
    const source = readFileSync(fileURLToPath(new URL(
      './WorkflowTaskList.tsx',
      import.meta.url
    )), 'utf8')
    const stylesheet = readFileSync(fileURLToPath(new URL(
      './_workflow-task-list-state.scss',
      import.meta.url
    )), 'utf8')
    const stateSource = readFileSync(fileURLToPath(new URL(
      './WorkflowTaskListState.tsx',
      import.meta.url
    )), 'utf8')

    expect(source).toContain(
      "kind={workflowTaskItemCount > 0 ? 'filtered' : 'empty'}"
    )
    expect(source).toContain('还没有工作流任务')
    expect(source).toContain('前往“工作流”选择流程并启动运行。')
    expect(source).toContain('清除搜索与筛选')
    expect(stateSource).toContain(
      "aria-live={error ? 'assertive' : 'polite'}"
    )
    expect(stateSource).toContain('aria-hidden="true"')
    expect(stylesheet).toContain('workflow-task-list__state-visual')
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('limits the page to workflow executions and installs a render fallback', () => {
    const source = readFileSync(fileURLToPath(new URL(
      './WorkflowTaskList.tsx',
      import.meta.url
    )), 'utf8')
    const boundarySource = readFileSync(fileURLToPath(new URL(
      './WorkflowTaskListErrorBoundary.tsx',
      import.meta.url
    )), 'utf8')

    expect(source).toContain("execution_kind: 'workflow'")
    expect(source).toContain('isWorkflowExecutionTask')
    expect(source).toContain('<WorkflowTaskListErrorBoundary')
    expect(boundarySource).toContain('static getDerivedStateFromError')
    const failureMarkup = renderToStaticMarkup(
      <WorkflowTaskListFailure onRetry={() => undefined} />
    )
    expect(failureMarkup).toContain('工作流任务列表显示异常')
    expect(failureMarkup).toContain('重新加载任务列表')
    expect(failureMarkup).toContain('role="alert"')
  })
})
