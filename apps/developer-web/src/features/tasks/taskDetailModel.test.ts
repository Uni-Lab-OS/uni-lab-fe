import { describe, expect, it } from 'vitest'
import {
  formatErrorInfoEntries,
  formatJson,
  formatTimelineDuration,
  formatTimelineTime,
  summarizeErrorInfo,
  summarizeErrorText,
  hasWorkflowSiteFact,
  mapJobStatus,
  markerGlyph,
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
    expect(mapJobStatus('canceled')).toBe('skipped')
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
    // 失败必须用「叉」而不是警告三角：三角与「结果待核对」语义太接近。
    expect(markerGlyph.failed).toBe('x')
    expect(markerGlyph.unknown).toBe('help')
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
    ).toMatchObject({ description: 'x', duration: '2 秒' })
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

  it('renders the real error info instead of a placeholder, and says so when it cannot', () => {
    // 回归：errorInfo 曾经被替换成字面量「OS 返回异常事实」，真实原因被丢掉。
    expect(formatErrorInfoEntries(['boom'])).toEqual(['boom'])
    expect(formatErrorInfoEntries([{ code: 'E42', message: '夹爪未到位' }])).toEqual([
      'E42：夹爪未到位',
    ])
    expect(
      formatErrorInfoEntries([{ message: '超时' }, { reason: '设备离线' }, { code: 'ONLY_CODE' }]),
    ).toEqual(['超时', '设备离线', 'ONLY_CODE'])
    expect(formatErrorInfoEntries([null, '', '   '])).toEqual([])
    expect(formatErrorInfoEntries([{ a: 1 }])).toEqual(['{\n  "a": 1\n}'])
    expect(summarizeErrorInfo(['first', 'second'])).toBe('first')
    expect(summarizeErrorInfo([{ a: 1 }])).toBe('{\n  "a": 1\n}')
    // 完全无法解析时必须说明「还有多少条原文」，不能编造文案。
    expect(summarizeErrorInfo(['', null])).toBe('2 条错误信息，详情见异常处置')
    expect(summarizeErrorInfo([])).toBeNull()
  })

  it('folds a Python traceback into one readable line without dropping the raw text', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/os/unilabos/ros/nodes/base_device_node.py", line 3959, in safe_task_wrapper',
      '    result = await func(**kwargs)',
      'RuntimeError: SZLAB_TEST_NODE_FAILURE：预期的节点测试错误，剩余失败次数 0',
    ].join('\n')

    // 摘要只保留最后一行异常：多行堆栈不能铺进单行区域。
    expect(summarizeErrorText(traceback)).toBe(
      'RuntimeError: SZLAB_TEST_NODE_FAILURE：预期的节点测试错误，剩余失败次数 0',
    )
    // 普通单行文本原样返回，不做改写。
    expect(summarizeErrorText('  夹爪未到位  ')).toBe('夹爪未到位')
    expect(summarizeErrorText('')).toBe('')
    // 超长单行必须截断，避免撑破布局。
    const long = 'E' + 'x'.repeat(500)
    const summarized = summarizeErrorText(long, 40)
    expect(summarized).toHaveLength(40)
    expect(summarized.endsWith('…')).toBe(true)

    // 时间线摘要同样只放最后一行，而不是整段堆栈。
    const timeline = toTimelineEvent({
      jobUuid: 'j-1',
      workflowNodeUuid: 'n-1',
      nodeLabel: '注入节点错误',
      status: 'failed',
      attempt: 1,
      topologicalIndex: 1,
      executorKind: 'device_action',
      startedAt: null,
      finishedAt: null,
      waitReason: {},
      errorInfo: [{ message: traceback }],
    })
    expect(timeline.description).toBe(
      'RuntimeError: SZLAB_TEST_NODE_FAILURE：预期的节点测试错误，剩余失败次数 0',
    )
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
