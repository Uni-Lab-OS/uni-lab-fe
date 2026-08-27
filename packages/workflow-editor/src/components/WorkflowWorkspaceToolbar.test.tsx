import type { WorkflowExecutionTask, WorkflowTask } from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WorkflowWorkspaceToolbar } from './WorkflowWorkspaceToolbar'

describe('WorkflowWorkspaceToolbar runtime status', () => {
  it('returns to ready-to-start after cancellation reaches its terminal state', () => {
    const html = renderToolbar(workflowTask({ status: 'canceled' }))

    expect(html).toContain('data-task-status="idle"')
    expect(html).toContain('待启动')
    expect(html).not.toContain('已取消')
  })

  it('keeps the canceling state until Backend confirms cancellation', () => {
    const html = renderToolbar(workflowTask({ status: 'canceling' }))

    expect(html).toContain('data-task-status="canceling"')
    expect(html).toContain('正在取消')
    expect(html).not.toContain('data-task-status="idle"')
  })

  it('marks a non-terminal snapshot as historical when OS is unavailable', () => {
    const html = renderToolbar(
      workflowTask({ status: 'running' }),
      true
    )

    expect(html).toContain('data-task-status="historical"')
    expect(html).toContain('历史执行')
    expect(html).not.toContain('data-task-status="running"')
  })

  it('hides runtime actions in the read-only task list view', () => {
    const html = renderToStaticMarkup(
      <WorkflowWorkspaceToolbar
        task={workflowTask({ status: 'running' })}
        historicalTask
        message=""
        codeMode={{ active: false, disabled: true, disabledReason: '' }}
        canvasMode={{ active: true, disabled: false, disabledReason: '' }}
        save={{ disabled: true, disabledReason: '', title: '' }}
        hideActions
      >
        <button type="button">运行</button>
      </WorkflowWorkspaceToolbar>
    )

    expect(html).not.toContain('工作流调试工具栏')
    expect(html).not.toContain('历史执行')
    expect(html).not.toContain('保存工作流')
    expect(html).not.toContain('>运行<')
  })
})

function renderToolbar(task: WorkflowTask, historicalTask = false): string {
  return renderToStaticMarkup(
    <WorkflowWorkspaceToolbar
      task={task}
      historicalTask={historicalTask}
      message=""
      codeMode={{ active: false, disabled: true, disabledReason: '' }}
      canvasMode={{ active: true, disabled: false, disabledReason: '' }}
      save={{ disabled: true, disabledReason: '', title: '' }}
    />
  )
}

function workflowTask(
  override: Partial<WorkflowExecutionTask>
): WorkflowExecutionTask {
  return {
    uuid: '10000000-0000-4000-8000-000000000001',
    create_time: '2026-08-13T00:00:00Z',
    update_time: '2026-08-13T00:00:00Z',
    meta_data: {},
    execution_kind: 'workflow',
    workflow_uuid: '20000000-0000-4000-8000-000000000001',
    status: 'pending',
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    input: {},
    output: {},
    error_info: [],
    ...override
  }
}
