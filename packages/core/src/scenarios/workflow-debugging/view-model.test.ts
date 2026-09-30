import { describe, expect, it } from 'vitest'
import { createWorkflowDebuggingViewModel, projectWorkflowDebugFacts } from './view-model'
import type { TaskRuntimeDetail, TaskJobSummary } from '../../domain/workflow-execution-read/model'
import { deriveWorkflowDebugFacts } from '../../domain/workflow-execution-read/debug-facts'

describe('workflow debugging controls', () => {
  it('allows pending paused step tasks to resume or step without a frontier projection', () => {
    const task: TaskRuntimeDetail = {
      kind: 'task_runtime_detail', source: 'os', taskUuid: 'task-1', workflowUuid: 'workflow-1',
      executionKind: 'workflow', status: 'pending', runMode: 'step', controlStatus: 'paused',
      cleanupStatus: 'none', createdAt: 'now', updatedAt: 'now', raw: {}
    }
    const jobs: readonly TaskJobSummary[] = [{
      kind: 'task_job_summary', source: 'os', jobUuid: 'job-1', workflowNodeUuid: 'node-1',
      topologicalIndex: 0, executorKind: 'workflow_input', status: 'succeeded', attempt: 1,
      currentAttempt: true, controlData: {}, errorInfo: [], waitReason: {}, expectedChangeSet: {}, raw: {}
    }]
    const view = projectWorkflowDebugFacts(
      {
        ...createWorkflowDebuggingViewModel({}, { items: [], total: 0, page: 1, pageSize: 20, raw: {} }),
        selectedTask: task,
        selectedJobs: jobs,
      },
      deriveWorkflowDebugFacts(task, jobs),
      jobs,
      task,
    )

    expect(view.controls).toMatchObject({ canStep: true, canResume: true, canPause: false, canCancel: true })
  })

  it('uses the workflow input job creation time when OS omits started_at', () => {
    const task: TaskRuntimeDetail = {
      kind: 'task_runtime_detail', source: 'os', taskUuid: 'task-1', workflowUuid: 'workflow-1',
      executionKind: 'workflow', status: 'canceled', runMode: 'step', controlStatus: 'active',
      cleanupStatus: 'settled', createdAt: '2026-09-30T04:03:23.700064Z', updatedAt: '2026-09-30T05:36:54.567245Z', raw: {}
    }
    const jobs: readonly TaskJobSummary[] = [{
      kind: 'task_job_summary', source: 'os', jobUuid: 'job-1', workflowNodeUuid: 'node-1',
      topologicalIndex: 0, executorKind: 'workflow_input', status: 'succeeded', attempt: 1,
      currentAttempt: true, controlData: {}, errorInfo: [], waitReason: {}, expectedChangeSet: {},
      raw: {
        create_time: '2026-09-30T04:03:23.700064Z',
        finished_at: '2026-09-30T04:03:23.700064Z',
      }
    }]

    const view = projectWorkflowDebugFacts(
      {
        ...createWorkflowDebuggingViewModel({}, { items: [], total: 0, page: 1, pageSize: 20, raw: {} }),
        selectedTask: task,
        selectedJobs: jobs,
      },
      deriveWorkflowDebugFacts(task, jobs),
      jobs,
      task,
    )

    expect(view.timeline[0]).toMatchObject({
      startedAt: '2026-09-30T04:03:23.700064Z',
      finishedAt: '2026-09-30T04:03:23.700064Z',
    })
  })
})
