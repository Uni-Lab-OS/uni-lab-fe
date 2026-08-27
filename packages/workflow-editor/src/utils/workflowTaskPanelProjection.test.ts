import type { WorkflowExecutionTask } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import { workflowTaskMetadata } from './workflowTaskPanelProjection'

describe('workflowTaskMetadata', () => {
  it('uses readable workflow and actor details before UUID identities', () => {
    const metadata = workflowTaskMetadata(
      workflowTask(),
      null,
      {
        realtimeStatus: 'live',
        projectionStale: false,
        feedbackStale: false
      }
    )

    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '运行主体', value: '固体投料流程' }),
      expect.objectContaining({ label: '执行人', value: '韩工程师' }),
      expect.objectContaining({ label: '任务', value: '00000001' }),
      expect.objectContaining({ label: '状态同步', value: '已确认' })
    ]))
    expect(metadata[0]?.value).not.toContain('30000000')
  })

  it('states clearly when OS does not provide an actor', () => {
    const task = workflowTask()
    task.meta_data = {}

    const metadata = workflowTaskMetadata(task, null, {
      realtimeStatus: 'reconnecting',
      projectionStale: false,
      feedbackStale: true
    })

    expect(metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '执行人', value: 'OS 未返回' }),
      expect.objectContaining({ label: '状态同步', value: '反馈待补读' })
    ]))
  })
})

/** 返回包含可识别运行主体和执行人的工作流任务（WorkflowTask）夹具。 */
function workflowTask(): WorkflowExecutionTask {
  return {
    uuid: '30000000-0000-4000-8000-000000000001',
    create_time: '2026-08-10T08:00:00Z',
    update_time: '2026-08-10T08:00:00Z',
    description: '固体投料流程',
    meta_data: { operator_name: '韩工程师' },
    execution_kind: 'workflow',
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    status: 'running',
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    input: {},
    output: {},
    error_info: []
  }
}
