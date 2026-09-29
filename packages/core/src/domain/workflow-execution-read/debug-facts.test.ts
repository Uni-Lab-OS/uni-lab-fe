import { describe, expect, it } from 'vitest'
import { deriveWorkflowDebugFacts } from './debug-facts'
import type { TaskJobSummary, TaskRuntimeDetail } from './model'

describe('deriveWorkflowDebugFacts', () => {
  it('projects frontier, join, progress, waits and recovery without inventing candidates', () => {
    const task = {
      kind: 'task_runtime_detail', source: 'os', taskUuid: 'task-1', workflowUuid: 'workflow-1',
      executionKind: 'workflow', status: 'running', runMode: 'step', controlStatus: 'paused',
      cleanupStatus: 'requires_attention', createdAt: 'now', updatedAt: 'now',
      raw: {
        ready_frontier: [{ node_uuid: 'node-a', branch_uuid: 'branch-a', selectable: true }],
        joins: [{ node_uuid: 'join-1', required_branch_uuids: ['branch-a', 'branch-b'], satisfied_branch_uuids: ['branch-a'], missing_conditions: ['branch-b'] }],
        progress: { completed: 1, total: 3 },
        execution_locks: [{ uuid: 'lock-1', state: 'uncertain', claim_uuid: 'claim-1', fencing_token: '4', can_release: false }]
      }
    } satisfies TaskRuntimeDetail
    const jobs = [{
      kind: 'task_job_summary', source: 'os', jobUuid: 'job-1', workflowNodeUuid: 'node-a', topologicalIndex: 0,
      executorKind: 'device', status: 'pending', attempt: 1, currentAttempt: true, controlData: {}, errorInfo: [],
      waitReason: { reason: 'claim held' }, expectedChangeSet: {}, raw: {}
    }] satisfies readonly TaskJobSummary[]

    const facts = deriveWorkflowDebugFacts(task, jobs)
    expect(facts.readyFrontier[0]).toMatchObject({ nodeUuid: 'node-a', selectable: true })
    expect(facts.joins[0]).toMatchObject({ ready: false, missingConditions: ['branch-b'] })
    expect(facts.progress).toMatchObject({ completed: 1, total: 3, percent: 33 })
    expect(facts.resourceWaits[0]).toMatchObject({ reason: 'claim held', blocking: true })
    expect(facts.recovery).toMatchObject({ executionUnknown: false, requiresReconciliation: true })
    expect(facts.recovery.locks[0]).toMatchObject({ state: 'uncertain', canRelease: false })
  })
})
