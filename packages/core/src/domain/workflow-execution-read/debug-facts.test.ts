import { describe, expect, it } from 'vitest'
import { countWorkflowJobs, deriveWorkflowDebugFacts, deriveWorkflowProgress } from './debug-facts'
import type { TaskJobSummary, TaskRuntimeDetail } from './model'

describe('deriveWorkflowDebugFacts', () => {
  it('projects frontier, join, progress, waits and recovery without inventing candidates', () => {
    const task = {
      kind: 'task_runtime_detail',
      source: 'os',
      taskUuid: 'task-1',
      workflowUuid: 'workflow-1',
      executionKind: 'workflow',
      status: 'running',
      runMode: 'step',
      controlStatus: 'paused',
      cleanupStatus: 'requires_attention',
      createdAt: 'now',
      updatedAt: 'now',
      raw: {
        ready_frontier: [{ node_uuid: 'node-a', branch_uuid: 'branch-a', selectable: true }],
        joins: [
          {
            node_uuid: 'join-1',
            required_branch_uuids: ['branch-a', 'branch-b'],
            satisfied_branch_uuids: ['branch-a'],
            missing_conditions: ['branch-b'],
          },
        ],
        progress: { completed: 1, total: 3 },
        execution_locks: [
          {
            uuid: 'lock-1',
            state: 'uncertain',
            claim_uuid: 'claim-1',
            fencing_token: '4',
            can_release: false,
          },
        ],
      },
    } satisfies TaskRuntimeDetail
    const jobs = [
      {
        kind: 'task_job_summary',
        source: 'os',
        jobUuid: 'job-1',
        workflowNodeUuid: 'node-a',
        topologicalIndex: 0,
        executorKind: 'device',
        status: 'pending',
        attempt: 1,
        currentAttempt: true,
        controlData: {},
        errorInfo: [],
        waitReason: { reason: 'claim held' },
        expectedChangeSet: {},
        raw: {},
      },
    ] satisfies readonly TaskJobSummary[]

    const facts = deriveWorkflowDebugFacts(task, jobs)
    expect(facts.readyFrontier[0]).toMatchObject({ nodeUuid: 'node-a', selectable: true })
    expect(facts.joins[0]).toMatchObject({ ready: false, missingConditions: ['branch-b'] })
    expect(facts.progress).toMatchObject({ completed: 1, total: 3, percent: 33 })
    expect(facts.resourceWaits[0]).toMatchObject({ reason: 'claim held', blocking: true })
    expect(facts.recovery).toMatchObject({ executionUnknown: false, requiresReconciliation: true })
    expect(facts.recovery.locks[0]).toMatchObject({ state: 'uncertain', canRelease: false })
  })
})

describe('job status counts (field 13.11: a canceled run must not read as 100%)', () => {
  const jobs = (status: string, count: number, extra: Record<string, unknown> = {}) =>
    Array.from({ length: count }, () => ({ status, currentAttempt: true, raw: {}, ...extra }))

  it('counts the canceled task as-is and keeps the superseded attempt in history', () => {
    const counts = countWorkflowJobs([
      ...jobs('succeeded', 66),
      ...jobs('skipped', 232),
      ...jobs('canceled', 5211),
      ...jobs('failed', 1),
      ...jobs('failed', 1, { currentAttempt: false }),
    ])
    expect(counts).toMatchObject({
      total: 5510,
      succeeded: 66,
      skipped: 232,
      canceled: 5211,
      failed: 1,
      historicalAttempts: 1,
    })
    expect(deriveWorkflowProgress(undefined)).toBeNull()
  })

  it('separates OS-uncertain running jobs from running ones', () => {
    const counts = countWorkflowJobs([
      ...jobs('running', 1),
      ...jobs('running', 1, { raw: { uncertainty_reason: 'ptlc_action_timeout' } }),
      ...jobs('execution_unknown', 1),
      ...jobs('pending', 2),
    ])
    expect(counts).toMatchObject({ running: 1, unknown: 2, waiting: 2, total: 5 })
  })
})
