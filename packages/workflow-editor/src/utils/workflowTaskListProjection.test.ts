import type {
  WorkflowSummary,
  WorkflowTask
} from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  formatWorkflowTaskDate,
  visibleWorkflowTasks,
  workflowTaskCleanupStatusLabel,
  workflowTaskDisplayName
} from './workflowTaskListProjection'

const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000001'

describe('工作流任务列表投影', () => {
  it('按创建时间倒序筛选运行中任务并使用工作流目录名称', () => {
    const workflows = [{
      uuid: WORKFLOW_UUID,
      name: '粉体转运流程'
    }] as WorkflowSummary[]
    const tasks = [
      workflowTask('20000000-0000-4000-8000-000000000001', 'succeeded', {
        create_time: '2026-08-19T01:00:00Z'
      }),
      workflowTask('20000000-0000-4000-8000-000000000002', 'running', {
        create_time: '2026-08-19T02:00:00Z'
      }),
      workflowTask('20000000-0000-4000-8000-000000000003', 'pending', {
        create_time: '2026-08-19T03:00:00Z'
      })
    ]

    expect(visibleWorkflowTasks(tasks, workflows, '粉体', 'active')
      .map((task) => task.uuid)).toEqual([
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000002'
    ])
    expect(workflowTaskDisplayName(tasks[0], new Map([
      [WORKFLOW_UUID, '粉体转运流程']
    ]))).toBe('粉体转运流程')
  })

  it('把人工干预与清理关注归入待处理，并保留快照名称回退', () => {
    const intervention = workflowTask(
      '20000000-0000-4000-8000-000000000004',
      'running',
      {
        control_status: 'waiting_intervention',
        workflow_snapshot: { workflow: { name: '快照流程' } }
      }
    )
    const cleanup = workflowTask(
      '20000000-0000-4000-8000-000000000005',
      'failed',
      { cleanup_status: 'requires_attention' }
    )

    expect(visibleWorkflowTasks(
      [intervention, cleanup],
      [],
      '',
      'attention'
    )).toHaveLength(2)
    expect(workflowTaskDisplayName(intervention, new Map())).toBe('快照流程')
    expect(workflowTaskCleanupStatusLabel('requires_attention')).toBe('需要关注')
  })

  it('格式化合法时间并对 Backend 非法值保持诚实展示', () => {
    expect(formatWorkflowTaskDate()).toBe('—')
    expect(formatWorkflowTaskDate('not-a-date')).toBe('not-a-date')
    expect(formatWorkflowTaskDate('2026-08-19T03:00:00Z')).toContain('2026')
  })
})

/** 创建覆盖列表状态所需字段的 Backend 工作流任务夹具。 */
function workflowTask(
  uuid: string,
  status: WorkflowTask['status'],
  overrides: Partial<WorkflowTask> = {}
): WorkflowTask {
  return {
    uuid,
    create_time: '2026-08-19T00:00:00Z',
    update_time: '2026-08-19T00:00:00Z',
    meta_data: {},
    workflow_uuid: WORKFLOW_UUID,
    status,
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    error_info: [],
    ...overrides
  }
}
