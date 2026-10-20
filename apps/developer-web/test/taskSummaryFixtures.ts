import { decodeTaskSummaryPage, type TaskRuntimeSummaryPage } from '@unilab-fe/core'

/** 构造 OS view=summary 形状的任务条目（与 OS summary_version=1 合同同名同义）。 */
export function osTaskSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'task-1',
    create_time: '2026-10-20T08:00:00Z',
    update_time: '2026-10-20T08:05:00Z',
    meta_data: {},
    workflow_uuid: 'workflow-1',
    execution_kind: 'workflow',
    priority: 'normal',
    status: 'running',
    workflow_snapshot: { workflow: { uuid: 'workflow-1', name: 'pTLC 点样', revision: 3 } },
    run_mode: 'normal',
    execution_mode: 'auto',
    dispatch_gate: 'open',
    control_status: 'active',
    cleanup_status: 'none',
    wait_reason: {},
    input: { sample_id: null, sample: null },
    description: 'S01 点样与展开',
    job_counts: {
      total: 5,
      historical_attempts: 0,
      by_status: { succeeded: 2, running: 1, pending: 2 },
      uncertain_by_status: {},
    },
    job_activity: { first_started_at: '2026-10-20T08:01:00Z', last_finished_at: null },
    active_jobs: [],
    active_jobs_truncated: false,
    pending_manual_confirmation_count: 0,
    manual_review_attention_resolved: false,
    ...overrides,
  }
}

export function taskSummaryPage(
  items: readonly Record<string, unknown>[] = [osTaskSummary()],
): TaskRuntimeSummaryPage {
  return decodeTaskSummaryPage({
    code: 0,
    data: {
      items,
      total: items.length,
      page: 1,
      page_size: 20,
      view: 'summary',
      summary_version: 1,
    },
  })
}
