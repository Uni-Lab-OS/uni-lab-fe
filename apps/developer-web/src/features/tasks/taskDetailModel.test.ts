import { describe, expect, it } from 'vitest'
import {
  buildDeviceActionLabelDirectory,
  buildDeviceNameDirectory,
  decodeDeviceActionPresentations,
  type DeviceSummary,
  type WorkflowDebugTimelineItem,
} from '@unilab-fe/core'
import {
  arrangeTimeline,
  findTimelineJob,
  formatJson,
  formatTimelineDuration,
  formatTimelineTime,
  hasWorkflowSiteFact,
  isActiveTimelineEvent,
  timelineEventMatches,
  mapJobStatus,
  readExpectedChangeSetKind,
  readManualConfirmation,
  toTimelineEvent,
} from './taskDetailModel'

const detail = (raw: Record<string, unknown> = {}) =>
  ({ jobUuid: 'j-1', controlData: {}, raw }) as never

describe('task detail model', () => {
  it('maps all runtime statuses and timing states', () => {
    expect(mapJobStatus('succeeded')).toBe('success')
    expect(mapJobStatus('running')).toBe('running')
    expect(mapJobStatus('intervention_required')).toBe('manual')
    expect(mapJobStatus('execution_unknown')).toBe('unknown')
    expect(mapJobStatus('failed')).toBe('failed')
    expect(mapJobStatus('timeout')).toBe('failed')
    expect(mapJobStatus('canceled')).toBe('canceled')
    expect(mapJobStatus('skipped')).toBe('skipped')
    expect(mapJobStatus('pending')).toBe('pending')
    expect(mapJobStatus('dispatched')).toBe('waiting')
    expect(formatTimelineTime(null)).toBe('—')
    expect(formatTimelineTime('invalid')).toBe('—')
    expect(formatTimelineDuration(null, null, 'pending')).toBe('时间未提供')
    expect(
      formatTimelineDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'succeeded'),
    ).toBe('1 秒')
    expect(formatTimelineDuration('bad', null, 'running')).toBe('执行中')
    expect(formatTimelineDuration('bad', null, 'failed')).toBe('时间未提供')
  })

  it('projects timeline descriptions from waits and errors', () => {
    expect(
      toTimelineEvent({
        jobUuid: 'j',
        nodeLabel: '节点',
        executorKind: 'device',
        status: 'running',
        startedAt: null,
        finishedAt: null,
        waitReason: { message: '等待设备' },
        errorInfo: [],
      } as never),
    ).toMatchObject({ description: '等待设备', duration: '时间未提供' })
    expect(
      toTimelineEvent({
        jobUuid: 'j2',
        nodeLabel: '节点',
        executorKind: 'device',
        status: 'failed',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: '2026-01-01T00:00:02Z',
        waitReason: {},
        errorInfo: ['x'],
      } as never),
    ).toMatchObject({ description: 'OS 返回异常事实', duration: '2 秒' })
    expect(
      toTimelineEvent({
        jobUuid: 'j3',
        nodeLabel: '节点',
        executorKind: 'device',
        status: 'pending',
        startedAt: '2026-01-01T00:00:00Z',
        finishedAt: null,
        waitReason: {},
        errorInfo: [],
      } as never).description,
    ).toBe('')
  })

  it('keeps an OS-skipped alternative branch terminal in the timeline', () => {
    const event = toTimelineEvent({
      jobUuid: 'skipped-branch',
      nodeLabel: '未选中分支',
      executorKind: 'device_action',
      status: 'skipped',
      startedAt: null,
      finishedAt: null,
      waitReason: {},
      errorInfo: [],
    } as never)
    expect(event).toMatchObject({ status: 'skipped', description: '', duration: '时间未提供' })
    expect(['running', 'waiting', 'manual', 'unknown', 'pending']).not.toContain(event.status)
  })

  it('reads expected change set from all supported projections and site waits', () => {
    expect(readExpectedChangeSetKind(detail({ expected_change_set: { kind: 'move' } }))).toBe(
      'move',
    )
    expect(readExpectedChangeSetKind(detail({ expectedChangeSet: { kind: 'fill' } }))).toBe('fill')
    expect(
      readExpectedChangeSetKind({
        jobUuid: 'j',
        controlData: { dispatch_payload: { expectedChangeSet: { kind: 'mix' } } },
        raw: {},
      } as never),
    ).toBe('mix')
    expect(readExpectedChangeSetKind(null)).toBeNull()
    expect(hasWorkflowSiteFact(detail({ expected_change_set: { site_uuid: 'site-1' } }), [])).toBe(
      true,
    )
    expect(
      hasWorkflowSiteFact(
        detail({ expected_change_set: { site_selection: { selectedSiteUuid: 'site-1' } } }),
        [],
      ),
    ).toBe(true)
    expect(
      hasWorkflowSiteFact(null, [
        {
          resourceKind: 'site',
          raw: {},
          resourceUuid: null,
          reason: null,
          blocking: false,
        } as never,
      ]),
    ).toBe(true)
    expect(
      hasWorkflowSiteFact(null, [
        {
          resourceKind: 'material',
          raw: { target_site_uuid: 'site-1' },
          resourceUuid: null,
          reason: null,
          blocking: false,
        } as never,
      ]),
    ).toBe(true)
    expect(hasWorkflowSiteFact(null, [])).toBe(false)
    expect(formatJson({ a: 1 })).toContain('"a": 1')
    expect(formatJson(undefined)).toBe('{}')
  })

  it('reads pending manual confirmation only from explicit OS data', () => {
    expect(
      readManualConfirmation(
        detail({
          manual_confirmation: {
            status: 'pending',
            deadline_at: '2026-10-10T11:00:00Z',
            actions: ['approve', 'reject', 'other'],
          },
        }),
      ),
    ).toEqual({
      status: 'pending',
      deadlineAt: '2026-10-10T11:00:00Z',
      actions: ['approve', 'reject'],
    })
    expect(
      readManualConfirmation(detail({ manual_confirmation: { status: 'approved' } })),
    ).toMatchObject({ status: 'approved', actions: [] })
    expect(readManualConfirmation(detail({}))).toBeNull()
  })
})

describe('resource waits', () => {
  it('shows a pending job with an OS wait reason as waiting, with the reason as description', () => {
    const event = toTimelineEvent({
      jobUuid: 'j',
      nodeLabel: '确认放下并登记位置',
      executorKind: 'material_transfer',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      waitReason: { code: 'site_occupied', message: '目标库位 tank-1 已被物料 x 占用' },
      errorInfo: [],
    } as never)
    expect(event).toMatchObject({
      status: 'waiting',
      description: '目标库位 tank-1 已被物料 x 占用',
    })
    expect(
      toTimelineEvent({
        jobUuid: 'k',
        nodeLabel: 'n',
        executorKind: 'device_action',
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        waitReason: {},
        errorInfo: [],
      } as never).status,
    ).toBe('pending')
  })
})

describe('timeline execution device names', () => {
  const robot: DeviceSummary = {
    kind: 'device_summary',
    source: 'os',
    deviceUuid: 'c4190b68-adb6-5c82-952f-f1ef5a37804b',
    materialUuid: 'c4190b68-adb6-5c82-952f-f1ef5a37804b',
    resourceTemplateUuid: 'tpl-robot',
    deviceKey: 'robot',
    localDeviceId: 'robot',
    namespace: 'edge-1',
    label: '机械臂',
    online: true,
    edgeStatus: null,
    dispatchable: true,
    dispatchBlockReason: null,
    executionOccupancies: null,
    actions: [],
    raw: {},
  }
  const devices = buildDeviceNameDirectory({ devices: [robot] })
  const job = (over: Partial<WorkflowDebugTimelineItem>): WorkflowDebugTimelineItem => ({
    jobUuid: 'j',
    workflowNodeUuid: 'n',
    nodeLabel: '取板',
    status: 'succeeded',
    attempt: 1,
    topologicalIndex: 0,
    executorKind: 'device_action',
    startedAt: null,
    finishedAt: null,
    waitReason: {},
    errorInfo: [],
    currentAttempt: true,
    ...over,
  })

  it('shows the Chinese device name and keeps the raw id for the tooltip', () => {
    expect(toTimelineEvent(job({ deviceId: 'robot' }), devices)).toMatchObject({
      device: '机械臂',
      deviceTitle: '设备 ID：robot',
    })
    // 物料 UUID 形式的设备身份也解析到同一设备。
    expect(
      toTimelineEvent(job({ deviceId: 'c4190b68-adb6-5c82-952f-f1ef5a37804b' }), devices),
    ).toMatchObject({
      device: '机械臂',
      deviceTitle: '设备 ID：c4190b68-adb6-5c82-952f-f1ef5a37804b',
    })
    expect(
      toTimelineEvent(job({ executorKind: 'manual_confirm', deviceId: 'robot' }), devices),
    ).toMatchObject({ device: '人工确认 · 机械臂', deviceTitle: '设备 ID：robot' })
  })

  it('falls back to the raw id when the OS has no display name, and to the category otherwise', () => {
    expect(toTimelineEvent(job({ deviceId: 'staging_a' }), devices)).toMatchObject({
      device: 'staging_a',
      deviceTitle: '设备 ID：staging_a',
    })
    expect(toTimelineEvent(job({ deviceId: 'robot' }))).toMatchObject({ device: 'robot' })
    const manual = toTimelineEvent(job({ executorKind: 'manual_confirm', deviceId: null }), devices)
    expect(manual.device).toBe('人工确认')
    expect(manual.deviceTitle).toBeUndefined()
    expect(toTimelineEvent(job({ executorKind: 'loop_head' }), devices).device).toBe('loop_head')
  })

  const actions = buildDeviceActionLabelDirectory({
    devices: [robot],
    deviceNames: devices,
    presentations: decodeDeviceActionPresentations({
      version: 1,
      categories: Object.fromEntries(
        ['read', 'compute', 'actuate', 'configure', 'safety', 'debug', 'flow', 'hook'].map(
          (key) => [key, { label: key }],
        ),
      ),
      devices: {
        robot: {
          label: '机械臂',
          actions: {
            move_to_point: {
              ref: 'robot.move_to_point',
              label: '移动到点位',
              category: 'actuate',
              params: [],
              result_fields: [],
            },
          },
        },
      },
    }),
  })

  it('titles nodes named after the raw action with the Chinese action label', () => {
    const moved = toTimelineEvent(
      job({ nodeLabel: 'move_to_point', actionName: 'move_to_point', deviceId: 'robot' }),
      devices,
      actions,
    )
    expect(moved).toMatchObject({
      title: '移动到点位',
      titleHint: '动作：robot.move_to_point\n节点 ID：n',
    })
    // 有意义的节点名优先；没有中文名的动作回退原始动作名；内置技术节点显示中文。
    expect(
      toTimelineEvent(
        job({ nodeLabel: '取板', actionName: 'move_to_point', deviceId: 'robot' }),
        devices,
        actions,
      ).title,
    ).toBe('取板')
    expect(
      toTimelineEvent(
        job({ nodeLabel: 'dwell', actionName: 'dwell', deviceId: 'robot' }),
        devices,
        actions,
      ),
    ).toMatchObject({ title: 'dwell', titleHint: '动作：robot.dwell\n节点 ID：n' })
    expect(
      toTimelineEvent(job({ nodeLabel: 'workflow_input', executorKind: 'workflow_input' })).title,
    ).toBe('工作流输入')
    // 展示元数据不可用时保持原名。
    expect(
      toTimelineEvent(job({ nodeLabel: 'move_to_point', actionName: 'move_to_point' })).title,
    ).toBe('move_to_point')
  })
})

describe('timeline ordering: current work on top, then history most recent first', () => {
  const job = (over: Partial<WorkflowDebugTimelineItem>): WorkflowDebugTimelineItem => ({
    jobUuid: 'j',
    workflowNodeUuid: 'n',
    nodeLabel: '节点',
    status: 'succeeded',
    attempt: 1,
    topologicalIndex: 0,
    executorKind: 'device_action',
    startedAt: null,
    finishedAt: null,
    waitReason: {},
    errorInfo: [],
    currentAttempt: true,
    ...over,
  })
  const events = [
    job({ jobUuid: 'done-1', topologicalIndex: 1, startedAt: '2026-10-20T10:00:00Z' }),
    job({
      jobUuid: 'failed-2',
      topologicalIndex: 2,
      status: 'failed',
      startedAt: '2026-10-20T10:05:00Z',
    }),
    job({
      jobUuid: 'running-3',
      topologicalIndex: 3,
      status: 'running',
      startedAt: '2026-10-20T10:06:00Z',
    }),
    job({ jobUuid: 'done-4', topologicalIndex: 4, startedAt: '2026-10-20T10:07:00Z' }),
    job({
      jobUuid: 'running-5',
      topologicalIndex: 5,
      status: 'running',
      startedAt: '2026-10-20T10:08:00Z',
    }),
    // 结果未知：OS 仍记 running，但带不确定原因。
    job({
      jobUuid: 'unknown-6',
      topologicalIndex: 6,
      status: 'running',
      uncertaintyReason: 'ptlc_action_timeout',
      startedAt: '2026-10-20T10:01:00Z',
    }),
    job({
      jobUuid: 'manual-7',
      topologicalIndex: 7,
      executorKind: 'manual_confirm',
      status: 'running',
      startedAt: '2026-10-20T10:02:00Z',
    }),
    // 已就绪但等待资源（未开始，没有时间）。
    job({
      jobUuid: 'waiting-8',
      topologicalIndex: 8,
      status: 'pending',
      waitReason: { message: '等待设备' },
    }),
    job({
      jobUuid: 'dispatched-9',
      topologicalIndex: 9,
      status: 'dispatched',
      startedAt: '2026-10-20T10:03:00Z',
    }),
    job({ jobUuid: 'pending-10', topologicalIndex: 10, status: 'pending' }),
    job({ jobUuid: 'canceled-11', topologicalIndex: 11, status: 'canceled' }),
  ].map((item) => toTimelineEvent(item))

  it('pins running, dispatching, manual-confirmation, unknown-result and resource-waiting entries', () => {
    const arranged = arrangeTimeline(events, {
      order: 'time',
      showUnexecuted: false,
      showHistory: false,
    })
    expect(arranged.items.map((item) => item.id)).toEqual([
      'running-5',
      'running-3',
      'dispatched-9',
      'manual-7',
      'unknown-6',
      'waiting-8',
      'done-4',
      'failed-2',
      'done-1',
    ])
    expect(arranged.sections).toEqual([
      { kind: 'active', start: 0, count: 6 },
      { kind: 'history', start: 6, count: 3 },
    ])
  })

  it('puts unstarted nodes last in step order when they are shown', () => {
    const arranged = arrangeTimeline(events, {
      order: 'time',
      showUnexecuted: true,
      showHistory: false,
    })
    expect(arranged.items.slice(-2).map((item) => item.id)).toEqual(['pending-10', 'canceled-11'])
    expect(arranged.sections.at(-1)).toEqual({ kind: 'unstarted', start: 9, count: 2 })
  })

  it('never pins a replaced attempt, even if it still looks active', () => {
    const replaced = toTimelineEvent(
      job({
        jobUuid: 'old',
        status: 'running',
        currentAttempt: false,
        startedAt: '2026-10-20T11:00:00Z',
      }),
    )
    expect(isActiveTimelineEvent(replaced)).toBe(false)
    const arranged = arrangeTimeline([...events, replaced], {
      order: 'time',
      showUnexecuted: false,
      showHistory: true,
    })
    expect(arranged.items.findIndex((item) => item.id === 'old')).toBe(6)
  })

  it('keeps the step view in pure DAG order without pinning or sections', () => {
    const arranged = arrangeTimeline(events, {
      order: 'steps',
      showUnexecuted: false,
      showHistory: false,
    })
    expect(arranged.items.map((item) => item.id)).toEqual([
      'done-1',
      'failed-2',
      'running-3',
      'done-4',
      'running-5',
      'unknown-6',
      'manual-7',
      'waiting-8',
      'dispatched-9',
    ])
    expect(arranged.sections).toEqual([])
  })

  it('shows history most recent first with no active section when nothing is in progress', () => {
    const arranged = arrangeTimeline(
      events.filter((event) => !isActiveTimelineEvent(event)),
      { order: 'time', showUnexecuted: false, showHistory: false },
    )
    expect(arranged.items.map((item) => item.id)).toEqual(['done-4', 'failed-2', 'done-1'])
    expect(arranged.sections).toEqual([{ kind: 'history', start: 0, count: 3 }])
  })
})

describe('gantt bar focus', () => {
  const item = (jobUuid: string, workflowNodeUuid: string, currentAttempt?: boolean) =>
    ({ jobUuid, workflowNodeUuid, currentAttempt }) as WorkflowDebugTimelineItem
  const timeline = [
    item('job-1a', 'node-1', false),
    item('job-1b', 'node-1'),
    item('job-2', 'node-2'),
  ]

  it('prefers the scheduler job identity and falls back to the current attempt of the node', () => {
    expect(findTimelineJob(timeline, { jobUuid: 'job-1a', nodeUuid: 'node-1' })?.jobUuid).toBe(
      'job-1a',
    )
    expect(findTimelineJob(timeline, { jobUuid: 'gone', nodeUuid: 'node-1' })?.jobUuid).toBe(
      'job-1b',
    )
    expect(findTimelineJob(timeline, { nodeUuid: 'node-2' })?.jobUuid).toBe('job-2')
    expect(findTimelineJob(timeline, { nodeUuid: 'node-9' })).toBeNull()
    expect(findTimelineJob(timeline, {})).toBeNull()
  })
})

describe('timeline search: find a node among many', () => {
  const job = (over: Partial<WorkflowDebugTimelineItem>): WorkflowDebugTimelineItem => ({
    jobUuid: 'j',
    workflowNodeUuid: 'n',
    nodeLabel: '节点',
    status: 'succeeded',
    attempt: 1,
    topologicalIndex: 0,
    executorKind: 'device_action',
    startedAt: null,
    finishedAt: null,
    waitReason: {},
    errorInfo: [],
    currentAttempt: true,
    ...over,
  })
  const events = [
    job({
      jobUuid: 'pick',
      workflowNodeUuid: 'node-pick',
      nodeLabel: '上料仓取板',
      actionName: 'robot.move_to_point',
      deviceId: 'robot',
      topologicalIndex: 1,
      startedAt: '2026-10-20T10:00:00Z',
    }),
    job({
      jobUuid: 'scrape',
      workflowNodeUuid: 'node-scrape',
      nodeLabel: '刮粉',
      deviceId: 'photoscrape',
      topologicalIndex: 2,
      startedAt: '2026-10-20T10:05:00Z',
    }),
    job({
      jobUuid: 'collect',
      workflowNodeUuid: 'node-collect',
      nodeLabel: '收集取瓶',
      deviceId: 'robot',
      status: 'pending',
      topologicalIndex: 3,
    }),
  ].map((item) => toTimelineEvent(item))
  const search = (query: string) =>
    arrangeTimeline(events, { order: 'steps', showUnexecuted: false, showHistory: false, query })

  it('matches node names, action refs and devices, every term required, ignoring case', () => {
    expect(search('刮粉').items.map((item) => item.id)).toEqual(['scrape'])
    expect(search('MOVE_TO').items.map((item) => item.id)).toEqual(['pick'])
    expect(search('robot 取瓶').items.map((item) => item.id)).toEqual(['collect'])
    expect(search('node-scrape').items.map((item) => item.id)).toEqual(['scrape'])
  })

  it('also finds nodes that have not run yet, while counts still describe the whole task', () => {
    const arranged = search('取')
    expect(arranged.items.map((item) => item.id)).toEqual(['pick', 'collect'])
    expect(arranged.collapsed.pending).toBe(1)
    expect(search('   ').items.map((item) => item.id)).toEqual(['pick', 'scrape'])
  })

  it('does not match the field labels of the hover hints', () => {
    expect(timelineEventMatches(events[1]!, '节点')).toBe(false)
    expect(timelineEventMatches(events[1]!, '设备')).toBe(false)
    expect(search('没有这个节点').items).toEqual([])
  })
})
