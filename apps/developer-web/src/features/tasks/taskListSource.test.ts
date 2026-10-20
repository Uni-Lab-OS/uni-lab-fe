import { describe, expect, it, vi } from 'vitest'
import { countWorkflowJobs, type TaskRuntimePresentation } from '@unilab-fe/core'
import { osTaskSummary, taskSummaryPage } from '../../../test/taskSummaryFixtures'
import { toTaskRow } from '../overview/taskPresentation'
import { formatJobCounts } from './taskStatusPresentation'
import { toTaskListRow } from './taskDomain'
import { loadTaskList, taskListQueryKey, taskListView, taskProgress } from './taskListSource'

function backend(summary: boolean) {
  return {
    getCapabilityStatus: (capability: string) => ({
      available: summary && capability === 'workflow.taskPresentationSummary',
    }),
    core: {
      executionRead: {
        listTaskSummaries: vi.fn(async () => taskSummaryPage()),
        listTaskPresentations: vi.fn(async () => ({
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          raw: {},
        })),
      },
    },
  }
}

describe('task list source capability gating', () => {
  it('keeps the default presentation view when the profile does not declare the summary view', async () => {
    const target = backend(false)
    expect(taskListView(target)).toBe('presentation')
    await loadTaskList(target as never, { page: 1, pageSize: 20 })
    expect(target.core.executionRead.listTaskPresentations).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    })
    expect(target.core.executionRead.listTaskSummaries).not.toHaveBeenCalled()
    expect(taskListQueryKey(target, { page: 1, pageSize: 20 })).toBe('task-list:presentation:1:20')
  })

  it('reads the summary view when the profile declares workflow.taskPresentationSummary', async () => {
    const target = backend(true)
    expect(taskListView(target)).toBe('summary')
    const page = await loadTaskList(target as never, { page: 2, pageSize: 10 })
    expect(target.core.executionRead.listTaskSummaries).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
    })
    expect(target.core.executionRead.listTaskPresentations).not.toHaveBeenCalled()
    expect(page.items[0]).toMatchObject({ kind: 'task_runtime_summary' })
    expect(taskListQueryKey(target, { page: 2, pageSize: 10 })).toBe('task-list:summary:2:10')
  })
})

describe('task rows from the summary view', () => {
  /** 同一任务的默认展示投影：逐 Job 数组与摘要中的聚合计数一致。 */
  function presentationOf(raw: Record<string, unknown>): TaskRuntimePresentation {
    const jobs = ['succeeded', 'succeeded', 'running', 'pending', 'pending'].map((status) => ({
      status,
      currentAttempt: true,
      raw: {},
    }))
    return {
      kind: 'task_runtime_presentation',
      source: 'os',
      taskUuid: 'task-1',
      workflowUuid: 'workflow-1',
      executionKind: 'workflow',
      status: String(raw.status),
      runMode: 'normal',
      controlStatus: String(raw.control_status),
      cleanupStatus: String(raw.cleanup_status),
      priority: 'normal',
      description: 'S01 点样与展开',
      createdAt: '2026-10-20T08:00:00Z',
      updatedAt: '2026-10-20T08:05:00Z',
      finishedAt: null,
      attentionReason: (raw.attention_reason as string | undefined) ?? null,
      progress: null,
      jobCounts: countWorkflowJobs(jobs),
      jobs: [],
      raw: {
        description: 'S01 点样与展开',
        workflow_snapshot: raw.workflow_snapshot,
        execution_plan: { nodes: [], edges: [] },
      },
    }
  }

  it.each([
    ['运行中', {}],
    [
      '取消后待人工收尾',
      {
        status: 'canceled',
        cleanup_status: 'requires_attention',
        attention_reason: 'resource_handoff_required',
        finished_at: '2026-10-20T08:06:00Z',
      },
    ],
    ['等待人工处置', { control_status: 'waiting_intervention' }],
  ])('shows the same facts as the default view: %s', (_name, overrides) => {
    const raw = osTaskSummary(overrides)
    const summary = taskSummaryPage([raw]).items[0]!
    const presentation = presentationOf(raw)
    const { task: _summaryTask, ...summaryRow } = toTaskRow(summary)
    const { task: _presentationTask, ...presentationRow } = toTaskRow(presentation)
    expect(summaryRow).toEqual(presentationRow)
    const { task: _a, ...summaryListRow } = toTaskListRow(summary)
    const { task: _b, ...presentationListRow } = toTaskListRow(presentation)
    expect(summaryListRow).toEqual(presentationListRow)
  })

  it('never invents progress for summaries and lists the OS job counts instead', () => {
    const summary = taskSummaryPage().items[0]!
    const row = toTaskListRow(summary)
    expect(taskProgress(summary)).toBeNull()
    expect(row).toMatchObject({
      name: 'S01 点样与展开',
      workflowName: 'pTLC 点样',
      status: 'running',
      progress: null,
      attention: null,
    })
    expect(formatJobCounts(row.jobCounts)).toBe('成功 2 · 运行中 1 · 等待 2')
  })
})
