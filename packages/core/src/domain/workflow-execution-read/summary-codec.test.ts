import { describe, expect, it } from 'vitest'
import { resolveServerCapabilities } from '../../capabilities'
import { countWorkflowJobs, countWorkflowJobsFromAggregate } from './debug-facts'
import { WorkflowExecutionReadClient } from './client'
import { WorkflowExecutionReadError } from './errors'
import { decodeTaskSummaryPage } from './summary-codec'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

/** OS 测试 test_summary_job_counts_activity_and_active_jobs 中的同一组 Job。 */
const OS_JOB_COUNTS = {
  total: 14,
  historical_attempts: 1,
  by_status: {
    canceled: 1,
    dispatched: 1,
    execution_unknown: 1,
    failed: 2,
    intervention_required: 1,
    pending: 2,
    running: 2,
    skipped: 1,
    succeeded: 2,
    timeout: 1,
  },
  uncertain_by_status: { failed: 1, running: 1 },
}

function summaryItem(overrides: Record<string, unknown> = {}) {
  return {
    uuid: 'task-1',
    create_time: '2026-01-01T00:00:01Z',
    update_time: '2026-01-01T00:00:02Z',
    description: '列表摘要任务',
    meta_data: { sample_id: 'S-01' },
    workflow_uuid: 'workflow-1',
    execution_kind: 'workflow',
    priority: 'normal',
    status: 'running',
    workflow_snapshot: { workflow: { uuid: 'workflow-1', name: '计数', revision: 2 } },
    run_mode: 'normal',
    execution_mode: 'auto',
    dispatch_gate: 'open',
    control_status: 'active',
    cleanup_status: 'none',
    wait_reason: {},
    input: { sample_id: 'S-01', sample: null },
    started_at: '2026-01-01T00:00:02Z',
    job_counts: OS_JOB_COUNTS,
    job_activity: {
      first_started_at: '2026-01-01T00:00:02Z',
      last_finished_at: '2026-01-01T00:00:30Z',
    },
    active_jobs: [
      {
        uuid: 'job-dispatched',
        workflow_node_uuid: 'node-dispatched',
        node_name: '加样',
        executor_kind: 'device_action',
        status: 'dispatched',
        attempt: 1,
        device_id: 'pump-actual',
        started_at: '2026-01-01T00:00:03Z',
      },
      {
        uuid: 'job-manual',
        workflow_node_uuid: 'node-manual',
        node_name: null,
        executor_kind: 'manual_confirm',
        status: 'intervention_required',
        attempt: 1,
        device_id: null,
        started_at: null,
        uncertainty_reason: 'edge_disconnected',
      },
    ],
    active_jobs_truncated: false,
    pending_manual_confirmation_count: 1,
    manual_review_attention_resolved: false,
    ...overrides,
  }
}

function summaryPage(overrides: Record<string, unknown> = {}) {
  return {
    code: 0,
    data: {
      items: [summaryItem()],
      total: 1,
      page: 1,
      page_size: 20,
      view: 'summary',
      summary_version: 1,
      ...overrides,
    },
  }
}

describe('task summary codec', () => {
  it('decodes the summary contract and restores the job status categories', () => {
    const page = decodeTaskSummaryPage(summaryPage())
    expect(page).toMatchObject({ view: 'summary', summaryVersion: 1, total: 1, pageSize: 20 })
    const [task] = page.items
    expect(task).toMatchObject({
      kind: 'task_runtime_summary',
      taskUuid: 'task-1',
      workflowUuid: 'workflow-1',
      status: 'running',
      priority: 'normal',
      description: '列表摘要任务',
      startedAt: '2026-01-01T00:00:02Z',
      finishedAt: null,
      attentionReason: null,
      jobActivity: {
        firstStartedAt: '2026-01-01T00:00:02Z',
        lastFinishedAt: '2026-01-01T00:00:30Z',
      },
      activeJobsTruncated: false,
      pendingManualConfirmationCount: 1,
      manualReviewAttentionResolved: false,
    })
    expect(task!.activeJobs).toMatchObject([
      {
        jobUuid: 'job-dispatched',
        nodeName: '加样',
        deviceId: 'pump-actual',
        status: 'dispatched',
      },
      {
        jobUuid: 'job-manual',
        nodeName: null,
        executorKind: 'manual_confirm',
        deviceId: null,
        startedAt: null,
        uncertaintyReason: 'edge_disconnected',
      },
    ])
    // 与 OS 测试中默认视图逐 Job 计数的参照值一致。
    expect(task!.jobCounts).toEqual({
      total: 14,
      succeeded: 2,
      failed: 1,
      timeout: 1,
      canceled: 1,
      skipped: 1,
      running: 2,
      waiting: 3,
      unknown: 3,
      historicalAttempts: 1,
    })
    expect(task).not.toHaveProperty('progress')
    expect(task).not.toHaveProperty('jobs')
  })

  it('matches countWorkflowJobs for every status and uncertainty combination', () => {
    const statuses = [
      'pending',
      'dispatched',
      'running',
      'intervention_required',
      'cancel_requested',
      'succeeded',
      'failed',
      'timeout',
      'canceled',
      'cancelled',
      'skipped',
      'execution_unknown',
      'blocked',
    ]
    const jobs = statuses.flatMap((status, index) => [
      { status, currentAttempt: true, raw: {} },
      { status, currentAttempt: true, raw: { uncertainty_reason: `reason-${index}` } },
      { status, currentAttempt: false, raw: {} },
    ])
    const byStatus: Record<string, number> = {}
    const uncertainByStatus: Record<string, number> = {}
    for (const job of jobs) {
      if (!job.currentAttempt) continue
      byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
      if (job.raw.uncertainty_reason)
        uncertainByStatus[job.status] = (uncertainByStatus[job.status] ?? 0) + 1
    }
    expect(
      countWorkflowJobsFromAggregate({
        total: statuses.length * 2,
        historicalAttempts: statuses.length,
        byStatus,
        uncertainByStatus,
      }),
    ).toEqual(countWorkflowJobs(jobs))
  })

  it.each([
    ['默认视图（旧 OS 忽略 view）', { view: undefined, summary_version: undefined }, 'view'],
    ['其他视图', { view: 'matrix' }, 'view'],
    ['未知摘要版本', { summary_version: 2 }, 'version'],
  ])('rejects a page that is not summary contract v1: %s', (_name, overrides, message) => {
    expect(() => decodeTaskSummaryPage(summaryPage(overrides))).toThrow(message)
  })

  it('surfaces the OS invalid_input rejection instead of decoding an empty page', () => {
    expect(() =>
      decodeTaskSummaryPage({ code: 1000, error: { message: 'invalid_input' } }),
    ).toThrow(new WorkflowExecutionReadError('OS_REQUEST_REJECTED', 'invalid_input'))
  })

  it.each([
    ['计数之和与 total 不一致', { ...OS_JOB_COUNTS, total: 13 }, 'sums to 14'],
    [
      '不确定子集超过对应状态',
      { ...OS_JOB_COUNTS, uncertain_by_status: { failed: 3 } },
      'uncertain_by_status.failed',
    ],
    ['计数不是非负整数', { ...OS_JOB_COUNTS, by_status: { running: -1 }, total: -1 }, 'total'],
  ])('rejects inconsistent job counts: %s', (_name, jobCounts, message) => {
    expect(() =>
      decodeTaskSummaryPage(summaryPage({ items: [summaryItem({ job_counts: jobCounts })] })),
    ).toThrow(message)
  })

  it('requires the summary-only fields', () => {
    expect(() =>
      decodeTaskSummaryPage(summaryPage({ items: [summaryItem({ active_jobs: undefined })] })),
    ).toThrow('active_jobs')
    expect(() =>
      decodeTaskSummaryPage(
        summaryPage({ items: [summaryItem({ manual_review_attention_resolved: undefined })] }),
      ),
    ).toThrow('manual_review_attention_resolved')
  })
})

describe('WorkflowExecutionReadClient.listTaskSummaries', () => {
  it('requests view=summary with the same filters and paging as the default view', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        return { status: 200, headers: {}, data: summaryPage() as Value }
      },
    }
    const page = await new WorkflowExecutionReadClient(transport).listTaskSummaries({
      page: 2,
      pageSize: 10,
      status: 'running',
      cleanupStatus: '',
    })
    expect(page.items).toHaveLength(1)
    expect(requests).toHaveLength(1)
    const url = new URL(requests[0]!.url, 'http://os.test')
    expect(url.pathname).toBe('/api/v1/workflow-task-presentations')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      page_size: '10',
      status: 'running',
      view: 'summary',
    })
  })
})

describe('workflow.taskPresentationSummary capability', () => {
  it('is declared only by the pTLC profile whose OS build implements the summary view', () => {
    expect(
      resolveServerCapabilities({ id: 'ptlc-native' }).has('workflow.taskPresentationSummary'),
    ).toBe(true)
    for (const id of ['local-python', 'local-go', 'remote']) {
      expect(resolveServerCapabilities({ id }).has('workflow.taskPresentationSummary')).toBe(false)
    }
  })
})
