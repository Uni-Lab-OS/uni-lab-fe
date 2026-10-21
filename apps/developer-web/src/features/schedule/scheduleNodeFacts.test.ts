import { describe, expect, it } from 'vitest'
import {
  buildDeviceActionLabelDirectory,
  countWorkflowJobs,
  decodeDeviceActionPresentations,
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
  PLANNED_NODE_PLACEHOLDER,
  scheduleLookups,
  UNNAMED_NODE_PLACEHOLDER,
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
      execution_plan: {
        nodes: [
          { uuid: 'node-p', name: 'transfer_material_atomic' },
          { uuid: 'node-q', name: 'move_to_point', action_name: 'move_to_point' },
        ],
      },
    },
  }
}

describe('schedule node facts', () => {
  it('reads every node from the default presentation view', () => {
    const facts = collectScheduleNodeFacts([presentation()])
    expect(facts.names.get(nodeKey('task-p', 'node-p'))).toBe('原子物料搬运')
    expect(facts.executorKinds.get(nodeKey('task-p', 'node-p'))).toBe('manual_confirm')
    expect(facts.manualDecidedAt.get(nodeKey('task-p', 'node-p'))).toBe(1000)
    // 冻结定义的动作名供计划条按设备显示中文动作名。
    expect(facts.actions.get(nodeKey('task-p', 'node-q'))).toBe('move_to_point')
    expect(facts.actions.has(nodeKey('task-p', 'node-p'))).toBe(false)
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
      {
        jobUuid: 'job-move',
        workflowNodeUuid: 'node-2',
        nodeLabel: 'move_to_point',
        actionName: 'move_to_point',
        executorKind: 'device_action',
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
    expect(lookups.nodeAction('task-a', 'node-2')).toBe('move_to_point')
    expect(lookups.nodeAction('task-a', 'node-1')).toBeUndefined()
    expect(lookups.executorKind('task-a', 'node-1')).toBe('manual_confirm')
    expect(lookups.executorKind('task-a', 'node-1', 'job-old')).toBe('device_action')
    expect(lookups.manualDecidedAt('task-a', 'node-1', 'job-new')).toBe(1000)
    expect(lookups.manualDecidedAt('task-a', 'node-1', 'job-old')).toBeUndefined()
    expect(mergeNodeFacts()).toBe(EMPTY_NODE_FACTS)
  })
})

const categories = Object.fromEntries(
  ['read', 'compute', 'actuate', 'configure', 'safety', 'debug', 'flow', 'hook'].map((key) => [
    key,
    { label: key },
  ]),
)
const presentationAction = (ref: string, label: string) => ({
  ref,
  label,
  category: 'actuate',
  params: [],
  result_fields: [],
})
/** 设备包展示元数据（GET /api/v1/device-action-presentations）的最小样例。 */
const actionLabels = buildDeviceActionLabelDirectory({
  presentations: decodeDeviceActionPresentations({
    version: 1,
    categories,
    devices: {
      robot: {
        label: '机械臂',
        actions: {
          move_to_point: presentationAction('robot.move_to_point', '移动到点位'),
          tool_action: presentationAction('robot.tool_action', '工具动作'),
          home_ensure: presentationAction('robot.home_ensure', '确保回原点'),
        },
      },
    },
  }),
})

const unnamedTimeline = () =>
  decodeSchedulerTimeline({
    now: 1005,
    completed: [
      {
        job_id: 'job-1',
        workflow_id: 'task-a',
        node_id: '0f1e2d3c-node-with-action',
        device_id: 'robot',
        action_name: 'move_to_point',
        started_at: 980,
        ended_at: 985,
        state: 'succeeded',
      },
      {
        job_id: 'job-2',
        workflow_id: 'task-a',
        node_id: '1a2b3c4d-unknown-action',
        device_id: 'robot',
        action_name: 'pick_plate',
        started_at: 986,
        ended_at: 990,
        state: 'succeeded',
      },
      {
        job_id: 'job-3',
        workflow_id: 'task-a',
        node_id: '9a8b7c6d-node-without-action',
        device_id: 'robot',
        started_at: 991,
        ended_at: 995,
        state: 'succeeded',
      },
      {
        job_id: 'job-4',
        workflow_id: 'task-a',
        node_id: '7f6e5d4c-retried',
        device_id: 'robot',
        action_name: 'tool_action',
        started_at: 996,
        ended_at: 999,
        state: 'failed',
      },
    ],
  })

const unnamedPlan = () =>
  decodeTimePlan({
    enabled: true,
    algorithm: 'cp-sat',
    input: { revision: 'r1' },
    latest: {
      revision: 'r1',
      time_origin: 1000,
      status: 'OPTIMAL',
      validated: true,
      nodes: [
        ['5e4f3a2b-planned', 10_000],
        ['6a5b4c3d-named-by-action', 20_000],
        ['7f6e5d4c-retried', 30_000],
      ].map(([node, start]) => ({
        key: ['task-a', node],
        device_id: 'robot',
        start_ms: start,
        end_ms: (start as number) + 5_000,
        fixed: false,
      })),
    },
  })

const barLabels = (gantt: ReturnType<typeof buildScheduleGantt>) =>
  gantt.lanes.flatMap((lane) => lane.bars.map((bar) => [bar.label, bar.actionRef ?? null]))

describe('schedule labels without node names', () => {
  it('falls back to the action name or a Chinese placeholder without the node id', () => {
    const gantt = buildScheduleGantt({
      timeline: unnamedTimeline(),
      plan: unnamedPlan(),
      now: 1005,
    })
    expect(barLabels(gantt)).toEqual([
      ['move_to_point', 'robot.move_to_point'],
      ['pick_plate', 'robot.pick_plate'],
      [UNNAMED_NODE_PLACEHOLDER, null],
      ['tool_action', 'robot.tool_action'],
      [PLANNED_NODE_PLACEHOLDER, null],
      [PLANNED_NODE_PLACEHOLDER, null],
      // 计划条本身不带动作名；同一节点在时间线上出现过时沿用调度器记录的动作名。
      ['tool_action', 'robot.tool_action'],
    ])
    expect(PLANNED_NODE_PLACEHOLDER).toBe('待执行节点')
    expect(UNNAMED_NODE_PLACEHOLDER).toBe('未命名节点')
  })

  it('shows Chinese action labels from the device package before raw names and placeholders', () => {
    const gantt = buildScheduleGantt({
      timeline: unnamedTimeline(),
      plan: unnamedPlan(),
      now: 1005,
      actions: actionLabels,
      // 摘要视图的节点名缺省就是动作名；6a5b… 只知道节点名 home_ensure（计划条无动作名）。
      nodeName: (_task, node) =>
        node === '6a5b4c3d-named-by-action'
          ? 'home_ensure'
          : node === '0f1e2d3c-node-with-action'
            ? 'move_to_point'
            : undefined,
    })
    expect(barLabels(gantt)).toEqual([
      ['移动到点位', 'robot.move_to_point'],
      // 设备包没有该动作的中文名：回退原始动作名。
      ['pick_plate', 'robot.pick_plate'],
      [UNNAMED_NODE_PLACEHOLDER, null],
      ['工具动作', 'robot.tool_action'],
      [PLANNED_NODE_PLACEHOLDER, null],
      ['确保回原点', 'robot.home_ensure'],
      ['工具动作', 'robot.tool_action'],
    ])
  })

  it('keeps a meaningful node name and uses node action facts for planned bars', () => {
    const gantt = buildScheduleGantt({
      timeline: null,
      plan: unnamedPlan(),
      now: 1005,
      actions: actionLabels,
      nodeName: (_task, node) => (node === '6a5b4c3d-named-by-action' ? '取板' : undefined),
      nodeAction: (_task, node) => (node === '5e4f3a2b-planned' ? 'move_to_point' : undefined),
    })
    expect(barLabels(gantt)).toEqual([
      ['移动到点位', 'robot.move_to_point'],
      ['取板', null],
      [PLANNED_NODE_PLACEHOLDER, null],
    ])
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
