import { describe, expect, it } from 'vitest'
import { decodeSchedulerTimeline, decodeTimePlan } from '@unilab-fe/core'
import { buildScheduleGantt, currentCandidate, tickStep } from './scheduleGanttModel'

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
