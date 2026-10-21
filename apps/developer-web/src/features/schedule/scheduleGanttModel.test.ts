import { describe, expect, it } from 'vitest'
import {
  buildDeviceNameDirectory,
  decodeSchedulerTimeline,
  decodeTimePlan,
  type DeviceSummary,
} from '@unilab-fe/core'
import {
  barStatusText,
  buildScheduleGantt,
  currentCandidate,
  describeBar,
  isUnsuccessfulBar,
  packLaneRows,
  tickStep,
} from './scheduleGanttModel'

const plan = (over: Record<string, unknown> = {}) =>
  decodeTimePlan({
    enabled: true,
    algorithm: 'cp-sat',
    active_solves: 0,
    input_error: '',
    input: {
      revision: 'r2',
      partial_tasks: [],
      blocked: [['task-a', 'n9', 'condition_unresolved']],
      completion_targets: [],
    },
    latest: {
      revision: 'r2',
      time_origin: 1000,
      status: 'OPTIMAL',
      validated: true,
      error: '',
      nodes: [
        { key: ['task-a', 'n2'], device_id: 'robot', start_ms: 0, end_ms: 20_000, fixed: true },
        {
          key: ['task-a', 'n3'],
          device_id: 'collect',
          start_ms: 20_000,
          end_ms: 50_000,
          fixed: false,
        },
        {
          key: ['task-b', 'n1'],
          device_id: 'robot',
          start_ms: 20_000,
          end_ms: 30_000,
          fixed: false,
          parameters_final: false,
        },
      ],
      completion_targets: [],
    },
    ...over,
  })

const timeline = decodeSchedulerTimeline({
  now: 1005,
  running: [
    {
      job_id: 'j2',
      workflow_id: 'task-a',
      node_id: 'n2',
      device_id: 'robot',
      action_name: 'move',
      device_action_key: '/devices/robot/move',
      started_at: 1000,
      elapsed_s: 5,
      estimated_s: 20,
      estimate_source: 'default',
    },
  ],
  completed: [
    {
      job_id: 'j1',
      workflow_id: 'task-a',
      node_id: 'n1',
      device_id: 'feedlift',
      action_name: 'raise',
      device_action_key: '/devices/feedlift/raise',
      started_at: 980,
      ended_at: 999,
      actual_s: 19,
      estimated_s: 60,
      estimate_source: 'default',
      state: 'succeeded',
      suc_type: 'normal',
    },
  ],
})

describe('buildScheduleGantt', () => {
  it('draws actual, running and planned bars per device and does not duplicate the running fixed node', () => {
    const gantt = buildScheduleGantt({ timeline, plan: plan(), now: 1005 })
    expect(gantt.lanes.map((lane) => lane.deviceId)).toEqual(['collect', 'feedlift', 'robot'])
    const robot = gantt.lanes.find((lane) => lane.deviceId === 'robot')!
    expect(robot.bars.map((bar) => [bar.kind, bar.taskId])).toEqual([
      ['running', 'task-a'],
      ['planned', 'task-b'],
    ])
    expect(robot.bars[0]).toMatchObject({ start: 1000, end: 1005, estimatedEnd: 1020 })
    expect(robot.bars[1]).toMatchObject({ start: 1020, end: 1030, parametersFinal: false })
    const taskA = gantt.tasks.find((task) => task.taskId === 'task-a')!
    expect(taskA).toMatchObject({ firstStart: 980, plannedEnd: 1050 })
  })

  it('hides predictions when the candidate is stale, unvalidated or scheduling is off, keeping actual records', () => {
    for (const [snapshot, problem] of [
      [plan({ input: { revision: 'r3', blocked: [] } }), '重算'],
      [
        plan({
          latest: {
            revision: 'r2',
            time_origin: 1,
            status: 'OPTIMAL',
            validated: false,
            error: 'x',
            nodes: [],
          },
        }),
        '未通过验证',
      ],
      [decodeTimePlan({ enabled: false, algorithm: 'stable-ready-order' }), 'stable-ready-order'],
    ] as const) {
      const gantt = buildScheduleGantt({ timeline, plan: snapshot, now: 1005 })
      expect(gantt.candidate).toBeNull()
      expect(gantt.candidateProblem).toContain(problem)
      expect(gantt.lanes.flatMap((lane) => lane.bars).every((bar) => bar.kind !== 'planned')).toBe(
        true,
      )
    }
    expect(currentCandidate(null).problem).toContain('尚未读取')
  })

  it('drops plan fragments that already fell before now', () => {
    const gantt = buildScheduleGantt({ timeline, plan: plan(), now: 1040 })
    expect(
      gantt.lanes
        .flatMap((lane) => lane.bars)
        .filter((bar) => bar.kind === 'planned')
        .map((bar) => bar.nodeId),
    ).toEqual(['n3'])
  })

  it('keeps 4–10 ticks across spans', () => {
    expect(tickStep(45)).toBe(5)
    expect(tickStep(3600)).toBe(600)
  })
})

describe('manual confirmation waits', () => {
  it('shows a pending manual confirmation as a wait on the device, not as a running action', () => {
    const gantt = buildScheduleGantt({
      timeline,
      plan: plan(),
      now: 1005,
      executorKind: (_task, node) => (node === 'n2' ? 'manual_confirm' : 'device_action'),
    })
    const bar = gantt.lanes.find((lane) => lane.deviceId === 'robot')!.bars[0]!
    expect(bar).toMatchObject({ kind: 'manual', label: expect.stringContaining('待人工确认') })
    expect(bar.estimatedEnd).toBeUndefined()
  })
})

describe('approved manual confirmations', () => {
  it('splits the human wait from the device execution once the OS records the approval time', () => {
    const gantt = buildScheduleGantt({
      timeline,
      plan: plan(),
      now: 1005,
      manualDecidedAt: (_task, node) => (node === 'n1' ? 995 : undefined),
    })
    const bars = gantt.lanes.find((lane) => lane.deviceId === 'feedlift')!.bars
    expect(bars.map((bar) => [bar.kind, bar.start, bar.end])).toEqual([
      ['manual', 980, 995],
      ['actual', 995, 999],
    ])
  })
})

const ROBOT_UUID = 'c4190b68-adb6-5c82-952f-f1ef5a37804b'
const device = (localDeviceId: string, deviceUuid: string, label: string): DeviceSummary => ({
  kind: 'device_summary',
  source: 'os',
  deviceUuid,
  materialUuid: deviceUuid,
  resourceTemplateUuid: 'tpl',
  deviceKey: localDeviceId,
  localDeviceId,
  namespace: 'edge',
  label,
  online: true,
  edgeStatus: null,
  dispatchable: true,
  dispatchBlockReason: null,
  executionOccupancies: null,
  actions: [],
  raw: {},
})
const devices = buildDeviceNameDirectory({
  devices: [device('robot', ROBOT_UUID, '机械臂'), device('feedlift', 'feedlift-uuid', '板仓升降')],
})

describe('device lanes', () => {
  it('labels lanes with OS device names, keeps raw ids, and falls back to the id', () => {
    const gantt = buildScheduleGantt({ timeline, plan: plan(), now: 1005, devices })
    expect(gantt.lanes.map((lane) => [lane.name, lane.nameKnown, lane.deviceIds])).toEqual([
      ['板仓升降', true, ['feedlift']],
      ['机械臂', true, ['robot']],
      ['collect', false, ['collect']],
    ])
  })

  it('merges a device referenced by local id and by material UUID into one lane', () => {
    const uuidPlan = plan({
      latest: {
        revision: 'r2',
        time_origin: 1000,
        status: 'OPTIMAL',
        validated: true,
        error: '',
        nodes: [
          {
            key: ['task-b', 'n1'],
            device_id: ROBOT_UUID,
            start_ms: 20_000,
            end_ms: 30_000,
            fixed: false,
          },
        ],
      },
    })
    const gantt = buildScheduleGantt({ timeline, plan: uuidPlan, now: 1005, devices })
    const robot = gantt.lanes.find((lane) => lane.name === '机械臂')!
    expect(robot.deviceId).toBe(ROBOT_UUID)
    expect(robot.deviceIds).toEqual(['robot', ROBOT_UUID])
    expect(robot.bars.map((bar) => bar.kind)).toEqual(['running', 'planned'])
  })

  it('attaches the fixed plan interval to the running bar for the tooltip', () => {
    const gantt = buildScheduleGantt({ timeline, plan: plan(), now: 1005 })
    const running = gantt.lanes.flatMap((lane) => lane.bars).find((bar) => bar.kind === 'running')!
    expect(running).toMatchObject({ plannedStart: 1000, plannedEnd: 1020, open: true, jobId: 'j2' })
  })
})

describe('packLaneRows', () => {
  it('stacks overlapping bars into sub-rows and keeps touching bars on one row', () => {
    const { rows, rowOf } = packLaneRows([
      { id: 'a', start: 0, end: 10 },
      { id: 'b', start: 10, end: 20 },
      { id: 'c', start: 5, end: 15 },
      { id: 'd', start: 6, end: 8 },
    ])
    expect(rows).toBe(3)
    expect([...rowOf.entries()].sort()).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1],
      ['d', 2],
    ])
  })

  it('caps the number of sub-rows and reuses the earliest free row', () => {
    const bars = Array.from({ length: 6 }, (_, index) => ({
      id: `b${index}`,
      start: index,
      end: 100 + index,
    }))
    const { rows, rowOf } = packLaneRows(bars, 3)
    expect(rows).toBe(3)
    expect(rowOf.get('b3')).toBe(0)
    expect(packLaneRows([]).rows).toBe(1)
  })
})

describe('bar details', () => {
  const base = {
    id: 'j',
    taskId: 't',
    nodeId: 'n',
    deviceId: 'robot',
    label: '取板',
    nodeName: '取板',
    start: 1000,
    end: 1030,
  }
  const context = { now: 1030, taskName: '样品 1', deviceName: '机械臂' }

  it('describes actual, running, manual and planned bars with text, not color', () => {
    expect(describeBar({ ...base, kind: 'actual', state: 'failed' }, context)).toEqual([
      { label: '任务', value: '样品 1' },
      { label: '节点', value: '取板' },
      { label: '节点 ID', value: 'n' },
      { label: '设备', value: '机械臂（robot）' },
      { label: '状态', value: '实际执行 · 失败' },
      { label: '实际', value: expect.stringContaining('（30 秒）') },
      { label: '结算', value: '失败' },
    ])
    const running = describeBar(
      {
        ...base,
        kind: 'running',
        open: true,
        estimatedEnd: 1020,
        plannedStart: 995,
        plannedEnd: 1020,
      },
      context,
    )
    expect(running.map((row) => row.label)).toEqual([
      '任务',
      '节点',
      '节点 ID',
      '设备',
      '状态',
      '计划',
      '实际',
      '预计结束',
    ])
    expect(running.at(-1)?.value).toContain('已超预计')
    expect(
      describeBar({ ...base, kind: 'manual', open: true }, context).find(
        (row) => row.label === '等待',
      )?.value,
    ).toContain('不预测人的等待时长')
    const planned = describeBar(
      { ...base, kind: 'planned', parametersFinal: false },
      {
        ...context,
        deviceName: 'robot',
      },
    )
    expect(planned.find((row) => row.label === '设备')?.value).toBe('robot')
    expect(planned.find((row) => row.label === '说明')?.value).toContain('参数待上游确认')
  })

  it('keeps the raw action and node id in the details for troubleshooting', () => {
    const rows = describeBar(
      { ...base, kind: 'actual', nodeName: '移动到点位', actionRef: 'robot.move_to_point' },
      context,
    )
    expect(rows.slice(1, 4)).toEqual([
      { label: '节点', value: '移动到点位' },
      { label: '动作', value: 'robot.move_to_point' },
      { label: '节点 ID', value: 'n' },
    ])
    // 显示的就是原始动作名时不重复列出。
    expect(
      describeBar({ ...base, kind: 'planned', nodeName: 'dwell', actionRef: 'dwell' }, context).map(
        (row) => row.label,
      ),
    ).not.toContain('动作')
  })

  it('reports status text and failure from the scheduler settlement only', () => {
    expect(isUnsuccessfulBar({ kind: 'actual', state: 'succeeded' })).toBe(false)
    expect(isUnsuccessfulBar({ kind: 'actual', state: 'canceled' })).toBe(true)
    expect(isUnsuccessfulBar({ kind: 'running' })).toBe(false)
    expect(barStatusText({ kind: 'planned' })).toContain('预测')
    expect(barStatusText({ kind: 'manual', open: true })).toBe('待人工确认')
    expect(barStatusText({ kind: 'manual' })).toContain('已结束')
    expect(barStatusText({ kind: 'actual', state: 'mystery' })).toBe('实际执行 · mystery')
  })
})
