import { describe, expect, it } from 'vitest'
import {
  countWorkflowJobs,
  decodeSchedulerTimeline,
  decodeTimePlan,
  type TaskJobSummary,
  type TaskRuntimePresentation,
  type WorkflowDebugTimelineItem,
} from '@unilab-fe/core'
import { osTaskSummary, taskSummaryPage } from '../../../test/taskSummaryFixtures'
import { observeTaskNodes, observedTaskNodes } from '../tasks/observedTaskNodes'
import { buildScheduleGantt } from './scheduleGanttModel'
import {
  collectScheduleNodeFacts,
  detailNodeFacts,
  EMPTY_NODE_FACTS,
  mergeNodeFacts,
  nodeKey,
  placeholderNodeLabel,
  scheduleLookups,
} from './scheduleNodeFacts'

const activeJob = (overrides: Record<string, unknown>) => ({
  uuid: 'job-1',
  workflow_node_uuid: 'node-1',
  node_name: '点样',
  executor_kind: 'device_action',
  status: 'running',
  attempt: 1,
  device_id: 'spotter',
  started_at: '2026-10-20T08:01:00Z',
  ...overrides,
})

function summaryWith(activeJobs: readonly Record<string, unknown>[]) {
  return taskSummaryPage([osTaskSummary({ uuid: 'task-a', active_jobs: activeJobs })]).items
}

function presentation(): TaskRuntimePresentation {
  return {
    kind: 'task_runtime_presentation',
    source: 'os',
    taskUuid: 'task-p',
    workflowUuid: null,
    executionKind: 'workflow',
    status: 'running',
    runMode: 'normal',
    controlStatus: 'active',
    cleanupStatus: 'none',
    priority: null,
    description: null,
    createdAt: 'now',
    updatedAt: 'now',
    finishedAt: null,
    attentionReason: null,
    progress: null,
    jobCounts: countWorkflowJobs([]),
    jobs: [
      {
        kind: 'task_runtime_presentation_job',
        source: 'os',
        jobUuid: 'job-p',
        workflowNodeUuid: 'node-p',
        topologicalIndex: 0,
        executorKind: 'manual_confirm',
        status: 'succeeded',
        attempt: 1,
        currentAttempt: true,
        executionSource: null,
        startState: null,
        controlData: {},
        errorInfo: [],
        waitReason: {},
        expectedChangeSet: {},
        finishedAt: null,
        raw: { manual_confirmation: { decided_at: '1970-01-01T00:16:40Z' } },
      },
    ],
    raw: {
      execution_plan: { nodes: [{ uuid: 'node-p', name: 'transfer_material_atomic' }] },
    },
  }
}

describe('schedule node facts', () => {
  it('reads every node from the default presentation view', () => {
    const facts = collectScheduleNodeFacts([presentation()])
    expect(facts.names.get(nodeKey('task-p', 'node-p'))).toBe('原子物料搬运')
    expect(facts.executorKinds.get(nodeKey('task-p', 'node-p'))).toBe('manual_confirm')
    expect(facts.manualDecidedAt.get(nodeKey('task-p', 'node-p'))).toBe(1000)
  })

  it('reads only the in-flight nodes from summaries and keeps names seen earlier in the session', () => {
    const backend = {}
    observeTaskNodes(backend, summaryWith([activeJob({})]))
    // 下一次读取时 node-1 已结束，摘要只列 node-2。
    const later = summaryWith([
      activeJob({ uuid: 'job-2', workflow_node_uuid: 'node-2', node_name: '展开' }),
    ])
    observeTaskNodes(backend, later)
    const facts = collectScheduleNodeFacts(later, observedTaskNodes(backend))
    expect(facts.names.get(nodeKey('task-a', 'node-1'))).toBe('点样')
    expect(facts.names.get(nodeKey('task-a', 'node-2'))).toBe('展开')
    // 执行种类只取当前在途作业，不沿用会话记录（批准后可能已变为设备动作）。
    expect(facts.executorKinds.has(nodeKey('task-a', 'node-1'))).toBe(false)
    expect(facts.executorKinds.get(nodeKey('task-a', 'node-2'))).toBe('device_action')
    expect(observedTaskNodes({}).names.size).toBe(0)
  })

  it('remembers nodes that waited for manual confirmation', () => {
    const backend = {}
    observeTaskNodes(
      backend,
      summaryWith([
        activeJob({ executor_kind: 'manual_confirm', status: 'intervention_required' }),
        activeJob({ uuid: 'job-2', workflow_node_uuid: 'node-2', status: 'intervention_required' }),
        activeJob({ uuid: 'job-3', workflow_node_uuid: 'node-3' }),
      ]),
    )
    expect([...observedTaskNodes(backend).manualConfirm]).toEqual([
      nodeKey('task-a', 'node-1'),
      nodeKey('task-a', 'node-2'),
    ])
  })

  it('uses the task detail facts and prefers exact job facts over node facts', () => {
    const timeline = [
      {
        jobUuid: 'job-old',
        workflowNodeUuid: 'node-1',
        nodeLabel: '旧尝试',
        executorKind: 'device_action',
        currentAttempt: false,
      },
      {
        jobUuid: 'job-new',
        workflowNodeUuid: 'node-1',
        nodeLabel: '确认点样',
        executorKind: 'manual_confirm',
        currentAttempt: true,
      },
    ] as unknown as WorkflowDebugTimelineItem[]
    const jobs = [
      { jobUuid: 'job-old', executorKind: 'device_action', raw: {} },
      {
        jobUuid: 'job-new',
        executorKind: 'device_action',
        raw: { manual_confirmation: { decided_at: '1970-01-01T00:16:40Z' } },
      },
    ] as unknown as TaskJobSummary[]
    const lookups = scheduleLookups(
      mergeNodeFacts(
        collectScheduleNodeFacts(summaryWith([])),
        detailNodeFacts('task-a', timeline, jobs),
      ),
    )
    expect(lookups.nodeName('task-a', 'node-1')).toBe('确认点样')
    expect(lookups.executorKind('task-a', 'node-1')).toBe('manual_confirm')
    expect(lookups.executorKind('task-a', 'node-1', 'job-old')).toBe('device_action')
    expect(lookups.manualDecidedAt('task-a', 'node-1', 'job-new')).toBe(1000)
    expect(lookups.manualDecidedAt('task-a', 'node-1', 'job-old')).toBeUndefined()
    expect(mergeNodeFacts()).toBe(EMPTY_NODE_FACTS)
  })
})

describe('schedule labels without node names', () => {
  it('falls back to the action name or a readable placeholder with the node id', () => {
    const gantt = buildScheduleGantt({
      timeline: decodeSchedulerTimeline({
        now: 1005,
        completed: [
          {
            job_id: 'job-1',
            workflow_id: 'task-a',
            node_id: '0f1e2d3c-node-with-action',
            device_id: 'robot',
            action_name: 'pick_plate',
            started_at: 990,
            ended_at: 995,
            state: 'succeeded',
          },
          {
            job_id: 'job-2',
            workflow_id: 'task-a',
            node_id: '9a8b7c6d-node-without-action',
            device_id: 'robot',
            started_at: 996,
            ended_at: 999,
            state: 'succeeded',
          },
        ],
      }),
      plan: decodeTimePlan({
        enabled: true,
        algorithm: 'cp-sat',
        input: { revision: 'r1' },
        latest: {
          revision: 'r1',
          time_origin: 1000,
          status: 'OPTIMAL',
          validated: true,
          nodes: [
            {
              key: ['task-a', '5e4f3a2b-planned'],
              device_id: 'robot',
              start_ms: 10_000,
              end_ms: 20_000,
              fixed: false,
            },
          ],
        },
      }),
      now: 1005,
      label: (_task, _node, fallback) => fallback,
    })
    const labels = gantt.lanes.flatMap((lane) => lane.bars.map((bar) => bar.label))
    expect(labels).toEqual(['pick_plate', '节点 9a8b7c6d', '节点 5e4f3a2b'])
    expect(placeholderNodeLabel('abcdef0123')).toBe('节点 abcdef01')
  })

  it('passes the job identity to executor-kind and approval lookups', () => {
    const seen: Array<string | undefined> = []
    buildScheduleGantt({
      timeline: decodeSchedulerTimeline({
        now: 1005,
        completed: [
          {
            job_id: 'job-9',
            workflow_id: 'task-a',
            node_id: 'node-9',
            device_id: 'robot',
            started_at: 990,
            ended_at: 995,
          },
        ],
      }),
      plan: null,
      now: 1005,
      executorKind: (_task, _node, job) => {
        seen.push(job)
        return undefined
      },
      manualDecidedAt: (_task, _node, job) => {
        seen.push(job)
        return undefined
      },
    })
    expect(seen).toEqual(['job-9', 'job-9'])
  })
})
