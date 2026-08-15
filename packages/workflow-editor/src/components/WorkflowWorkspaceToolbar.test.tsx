import type { WorkflowTask } from '@unilab/services'
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
})

function renderToolbar(task: WorkflowTask): string {
  return renderToStaticMarkup(
    <WorkflowWorkspaceToolbar
      task={task}
      message=""
      codeMode={{ active: false, disabled: true, disabledReason: '' }}
      canvasMode={{ active: true, disabled: false, disabledReason: '' }}
      save={{ disabled: true, disabledReason: '', title: '' }}
    />
  )
}

function workflowTask(override: Partial<WorkflowTask>): WorkflowTask {
  return {
    uuid: '10000000-0000-4000-8000-000000000001',
    create_time: '2026-08-13T00:00:00Z',
    update_time: '2026-08-13T00:00:00Z',
    meta_data: {},
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
