import { describe, expect, it } from 'vitest'
import type { TaskJobSummary } from '@unilab-fe/core'
import {
  filterTaskListRows,
  jobLabel,
  taskNodeNames,
  toTaskListRow,
  toTimelineItems,
  displayTime,
  jobStatus,
  resourceEntries,
  type TaskListRow,
} from './taskDomain'

describe('task domain presentation', () => {
  it('uses the progress fact projected by Core', () => {
    const row = toTaskListRow({
      taskUuid: 'task-1',
      workflowUuid: 'wf-1',
      executionKind: 'workflow',
      status: 'running',
      runMode: 'normal',
      controlStatus: 'open',
      cleanupStatus: 'pending',
      priority: null,
      description: null,
      createdAt: '2026-09-27T08:00:00Z',
      updatedAt: '2026-09-27T08:01:00Z',
      finishedAt: null,
      attentionReason: null,
      progress: { completed: 1, total: 2, percent: 50, raw: {} },
      raw: { name: '测试任务' },
      kind: 'task_runtime_presentation',
      source: 'os',
      jobs: [
        {
          kind: 'task_runtime_presentation_job',
          source: 'os',
          jobUuid: 'j1',
          workflowNodeUuid: 'n1',
          topologicalIndex: 0,
          executorKind: 'device',
          status: 'completed',
          attempt: 1,
          currentAttempt: true,
          executionSource: null,
          startState: null,
          controlData: {},
          errorInfo: [],
          waitReason: {},
          expectedChangeSet: {},
          finishedAt: null,
          raw: {},
        },
        {
          kind: 'task_runtime_presentation_job',
          source: 'os',
          jobUuid: 'j2',
          workflowNodeUuid: 'n2',
          topologicalIndex: 1,
          executorKind: 'device',
          status: 'running',
          attempt: 1,
          currentAttempt: true,
          executionSource: null,
          startState: null,
          controlData: {},
          errorInfo: [],
          waitReason: {},
          expectedChangeSet: {},
          finishedAt: null,
          raw: {},
        },
      ],
    })
    expect(row.name).toBe('测试任务')
    expect(row.progress).toBe(50)
    expect(row.status).toBe('running')
    const attentionRow = toTaskListRow({
      ...row.task,
      controlStatus: 'error_waiting',
    } as never)
    expect(attentionRow.status).toBe('attention')
  })

  it('filters task rows by searchable identity and normalized status', () => {
    const makeRow = (name: string, status: string) =>
      ({
        name,
        workflowName: 'S06 workflow',
        status,
        progress: null,
        completedJobs: 0,
        totalJobs: 0,
        task: { taskUuid: `${name}-uuid` },
      }) as TaskListRow
    const rows = [makeRow('搬运任务', 'running'), makeRow('检测任务', 'completed')]

    expect(filterTaskListRows(rows, '  UUID  ', 'all')).toEqual([rows[0], rows[1]])
    expect(filterTaskListRows(rows, '检测', 'completed')).toEqual([rows[1]])
    expect(filterTaskListRows(rows, '', 'waiting')).toEqual([])
  })

  it('preserves parallel jobs with missing timestamps as unknown timing', () => {
    const items = toTimelineItems([
      {
        kind: 'node_job_detail',
        source: 'os',
        jobUuid: 'j1',
        workflowTaskUuid: 't1',
        workflowNodeUuid: 'n1',
        materialUuid: null,
        edgeUuid: null,
        edgeCommandUuid: null,
        feedbackSequence: null,
        topologicalIndex: 0,
        executorKind: 'device',
        executionPolicy: {},
        executionTimeoutSeconds: null,
        status: 'running',
        attempt: 1,
        param: {},
        feedbackData: {},
        returnInfo: {},
        controlData: {},
        errorInfo: [],
        uncertaintyReason: null,
        dispatchDeadlineAt: null,
        executionDeadlineAt: null,
        cancelCommandUuid: null,
        cancelAckDeadlineAt: null,
        cancelCompleteDeadlineAt: null,
        startedAt: null,
        finishedAt: null,
        raw: {},
      },
    ])
    expect(items[0].duration).toBe('时间未提供')
    expect(items[0].start).toBeNull()
  })

  it('uses runtime create and finish times when the compact job omits started_at', () => {
    const items = toTimelineItems([
      {
        kind: 'node_job_detail',
        source: 'os',
        jobUuid: 'j2',
        workflowTaskUuid: 't1',
        workflowNodeUuid: 'n2',
        materialUuid: null,
        edgeUuid: null,
        feedbackSequence: null,
        edgeCommandUuid: null,
        topologicalIndex: 1,
        executorKind: 'device',
        executionPolicy: {},
        executionTimeoutSeconds: null,
        status: 'succeeded',
        attempt: 1,
        param: {},
        feedbackData: {},
        returnInfo: {},
        controlData: {},
        errorInfo: [],
        uncertaintyReason: null,
        dispatchDeadlineAt: null,
        executionDeadlineAt: null,
        cancelCommandUuid: null,
        cancelAckDeadlineAt: null,
        cancelCompleteDeadlineAt: null,
        startedAt: null,
        finishedAt: null,
        raw: { create_time: '2026-09-27T08:00:00Z', finished_at: '2026-09-27T08:00:05Z' },
      },
    ])
    expect(items[0].duration).toBe('5 秒')
    expect(items[0].start).toBe(Date.parse('2026-09-27T08:00:00Z'))
  })

  it('uses snapshot names instead of UUIDs in execution labels', () => {
    const names = taskNodeNames({
      workflow_snapshot: {
        nodes: [{ uuid: 'n2', name: '原子物料搬运' }],
      },
    })
    const job = { workflowNodeUuid: 'n2', executorKind: 'material_transfer' } as TaskJobSummary
    expect(jobLabel(job, 0, names)).toBe('原子物料搬运')
    expect(
      jobLabel(
        { workflowNodeUuid: 'n3', executorKind: 'workflow_input' } as TaskJobSummary,
        1,
        names,
      ),
    ).toBe('工作流输入')
  })

  it('covers fallback node names, snapshots and resource entries', () => {
    expect(jobStatus({ status: 'timeout' } as never)).toBe('timeout')
    expect(jobLabel({ workflowNodeUuid: 'missing', executorKind: 'unknown' } as never, 2)).toBe('节点 3')
    expect(taskNodeNames({ execution_plan: { nodes: [{ uuid: 'n', action_name: 'transfer_material_atomic' }] } }).get('n')).toBe('原子物料搬运')
    expect(taskNodeNames({ workflow_snapshot: 'bad' })).toEqual(new Map())
    expect(displayTime(null)).toBe('未提供')
    expect(resourceEntries(null)).toEqual([])
    expect(resourceEntries({ a: 'x', b: { c: 1 } })).toEqual([['a', 'x'], ['b', '{"c":1}']])
    const item = toTimelineItems([{ workflowNodeUuid: '', jobUuid: 'j', status: 'queued', startedAt: null, finishedAt: null, raw: {} } as never])[0]
    expect(item).toMatchObject({ label: '节点 1', start: null, end: null })
  })
})
