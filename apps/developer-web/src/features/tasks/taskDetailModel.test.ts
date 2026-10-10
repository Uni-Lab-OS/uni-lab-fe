import { describe, expect, it } from 'vitest'
import { formatJson, formatTimelineDuration, formatTimelineTime, hasWorkflowSiteFact, mapJobStatus, readExpectedChangeSetKind, readManualConfirmation, toTimelineEvent } from './taskDetailModel'

const detail = (raw: Record<string, unknown> = {}) => ({ jobUuid: 'j-1', controlData: {}, raw }) as never

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
    expect(formatTimelineDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'succeeded')).toBe('1 秒')
    expect(formatTimelineDuration('bad', null, 'running')).toBe('执行中')
    expect(formatTimelineDuration('bad', null, 'failed')).toBe('时间未提供')
  })

  it('projects timeline descriptions from waits and errors', () => {
    expect(toTimelineEvent({ jobUuid: 'j', nodeLabel: '节点', executorKind: 'device', status: 'running', startedAt: null, finishedAt: null, waitReason: { message: '等待设备' }, errorInfo: [] } as never)).toMatchObject({ description: '等待设备', duration: '时间未提供' })
    expect(toTimelineEvent({ jobUuid: 'j2', nodeLabel: '节点', executorKind: 'device', status: 'failed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:02Z', waitReason: {}, errorInfo: ['x'] } as never)).toMatchObject({ description: 'OS 返回异常事实', duration: '2 秒' })
    expect(toTimelineEvent({ jobUuid: 'j3', nodeLabel: '节点', executorKind: 'device', status: 'pending', startedAt: '2026-01-01T00:00:00Z', finishedAt: null, waitReason: {}, errorInfo: [] } as never).description).toBe('')
  })

  it('reads expected change set from all supported projections and site waits', () => {
    expect(readExpectedChangeSetKind(detail({ expected_change_set: { kind: 'move' } }))).toBe('move')
    expect(readExpectedChangeSetKind(detail({ expectedChangeSet: { kind: 'fill' } }))).toBe('fill')
    expect(readExpectedChangeSetKind({ jobUuid: 'j', controlData: { dispatch_payload: { expectedChangeSet: { kind: 'mix' } } }, raw: {} } as never)).toBe('mix')
    expect(readExpectedChangeSetKind(null)).toBeNull()
    expect(hasWorkflowSiteFact(detail({ expected_change_set: { site_uuid: 'site-1' } }), [])).toBe(true)
    expect(hasWorkflowSiteFact(detail({ expected_change_set: { site_selection: { selectedSiteUuid: 'site-1' } } }), [])).toBe(true)
    expect(hasWorkflowSiteFact(null, [{ resourceKind: 'site', raw: {}, resourceUuid: null, reason: null, blocking: false } as never])).toBe(true)
    expect(hasWorkflowSiteFact(null, [{ resourceKind: 'material', raw: { target_site_uuid: 'site-1' }, resourceUuid: null, reason: null, blocking: false } as never])).toBe(true)
    expect(hasWorkflowSiteFact(null, [])).toBe(false)
    expect(formatJson({ a: 1 })).toContain('"a": 1')
    expect(formatJson(undefined)).toBe('{}')
  })

  it('reads pending manual confirmation only from explicit OS data', () => {
    expect(readManualConfirmation(detail({ manual_confirmation: { status: 'pending', deadline_at: '2026-10-10T11:00:00Z', actions: ['approve', 'reject', 'other'] } }))).toEqual({
      status: 'pending',
      deadlineAt: '2026-10-10T11:00:00Z',
      actions: ['approve', 'reject'],
    })
    expect(readManualConfirmation(detail({ manual_confirmation: { status: 'approved' } }))).toMatchObject({ status: 'approved', actions: [] })
    expect(readManualConfirmation(detail({}))).toBeNull()
  })
})
