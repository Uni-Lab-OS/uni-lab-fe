import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowDebugTimelineItem, WorkflowNodeJobDetail } from '@unilab-fe/core'
import { UncertainJobResolution } from './TaskDetailUncertainResolution'
import { arrangeTimeline, toTimelineEvent } from './taskDetailModel'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

const { capability, backend } = vi.hoisted(() => {
  const capability = { available: true, reason: undefined as string | undefined }
  return { capability, backend: { getCapabilityStatus: () => capability } }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

const job = (overrides: Partial<WorkflowNodeJobDetail> = {}): WorkflowNodeJobDetail => ({
  kind: 'node_job_detail',
  source: 'os',
  jobUuid: 'job-1',
  workflowTaskUuid: 'task-1',
  workflowNodeUuid: 'node-1',
  materialUuid: null,
  edgeUuid: null,
  edgeCommandUuid: null,
  feedbackSequence: null,
  topologicalIndex: 0,
  executorKind: 'device_action',
  executionPolicy: {},
  executionTimeoutSeconds: null,
  status: 'running',
  attempt: 1,
  param: {},
  feedbackData: {},
  returnInfo: {},
  controlData: {},
  errorInfo: [],
  uncertaintyReason: 'ptlc_action_timeout',
  dispatchDeadlineAt: null,
  executionDeadlineAt: null,
  cancelCommandUuid: null,
  cancelAckDeadlineAt: null,
  cancelCompleteDeadlineAt: null,
  startedAt: null,
  finishedAt: null,
  raw: {},
  ...overrides,
})

beforeEach(() => {
  capability.available = true
  capability.reason = undefined
})

describe('UncertainJobResolution', () => {
  it('requires an on-site conclusion and confirmation before requesting a canceled resolution', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<UncertainJobResolution job={job()} onResolve={onResolve} />)
    expect(screen.getByText('设备动作结果未知，需现场核对')).toBeTruthy()
    const submit = screen.getByRole('button', { name: /按已取消收尾/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '现场确认夹爪未动作' } })
    fireEvent.click(screen.getByRole('button', { name: /按已取消收尾/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认提交' }))
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('job-1', '现场确认夹爪未动作'))
  })

  it('shows the OS refusal instead of hiding it', async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error('作业不是等待物理对账的运行中或失败作业'))
    render(<UncertainJobResolution job={job()} onResolve={onResolve} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '核对' } })
    fireEvent.click(screen.getByRole('button', { name: /按已取消收尾/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认提交' }))
    expect(await screen.findByText('作业不是等待物理对账的运行中或失败作业')).toBeTruthy()
  })

  it('shows a pending request and hides the form once the OS recorded it', () => {
    render(
      <UncertainJobResolution
        job={job({
          controlData: {
            manual_resolution: { reason: '已核对', status: 'pending_edge_confirmation' },
          },
        })}
        onResolve={vi.fn()}
      />,
    )
    expect(screen.getByText('已请求按“已取消”收尾，等待设备侧确认')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('stays hidden for certain jobs and refuses when the capability is not declared', () => {
    const { container } = render(
      <UncertainJobResolution job={job({ uncertaintyReason: null })} onResolve={vi.fn()} />,
    )
    expect(container.textContent).toBe('')
    capability.available = false
    capability.reason = 'Uni-Lab OS 尚未声明 workflow.resolveUncertain 能力'
    render(<UncertainJobResolution job={job()} onResolve={vi.fn()} />)
    expect(screen.getByText('当前后端未声明结果未知处置能力')).toBeTruthy()
  })
})

describe('timeline uncertainty', () => {
  const item: WorkflowDebugTimelineItem = {
    jobUuid: 'job-1',
    workflowNodeUuid: 'node-1',
    nodeLabel: '收集-夹紧',
    status: 'running',
    attempt: 1,
    topologicalIndex: 0,
    executorKind: 'device_action',
    startedAt: null,
    finishedAt: null,
    waitReason: {},
    errorInfo: [],
    uncertaintyReason: 'ptlc_action_timeout',
  }

  it('shows an OS-uncertain running job as unknown rather than running', () => {
    expect(toTimelineEvent(item)).toMatchObject({
      status: 'unknown',
      description: expect.stringContaining('结果未知'),
    })
    expect(toTimelineEvent({ ...item, uncertaintyReason: null }).status).toBe('running')
  })
})

describe('arrangeTimeline (field 13.11)', () => {
  const ev = (over: Partial<WorkflowDebugTimelineItem>): WorkflowDebugTimelineItem => ({
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

  it('orders by server start time, most recent first, so a retry stays above its first attempt', () => {
    const events = [
      ev({
        jobUuid: 'retry',
        topologicalIndex: 298,
        attempt: 2,
        status: 'failed',
        startedAt: '2026-10-16T10:27:57Z',
      }),
      ev({
        jobUuid: 'first',
        topologicalIndex: 298,
        attempt: 1,
        status: 'failed',
        currentAttempt: false,
        startedAt: '2026-10-16T10:23:21Z',
      }),
      ev({ jobUuid: 'early', topologicalIndex: 10, startedAt: '2026-10-16T10:12:00Z' }),
    ].map((item) => toTimelineEvent(item))
    const shown = arrangeTimeline(events, {
      order: 'time',
      showUnexecuted: false,
      showHistory: true,
    })
    expect(shown.items.map((item) => item.id)).toEqual(['retry', 'first', 'early'])
    const current = arrangeTimeline(events, {
      order: 'time',
      showUnexecuted: false,
      showHistory: false,
    })
    expect(current.items.map((item) => item.id)).toEqual(['retry', 'early'])
    expect(current.historical).toBe(1)
  })

  it('collapses canceled, skipped and unreached nodes and keeps them distinct', () => {
    const events = [
      ev({ jobUuid: 'ran', startedAt: '2026-10-16T10:12:00Z' }),
      ev({ jobUuid: 'c1', status: 'canceled', topologicalIndex: 2 }),
      ev({ jobUuid: 'c2', status: 'canceled', topologicalIndex: 3 }),
      ev({ jobUuid: 's1', status: 'skipped', topologicalIndex: 4 }),
      ev({ jobUuid: 'p1', status: 'pending', topologicalIndex: 5 }),
    ].map((item) => toTimelineEvent(item))
    const arranged = arrangeTimeline(events, {
      order: 'time',
      showUnexecuted: false,
      showHistory: false,
    })
    expect(arranged.items.map((item) => item.id)).toEqual(['ran'])
    expect(arranged.collapsed).toEqual({ canceled: 2, skipped: 1, pending: 1 })
    expect(events.find((item) => item.id === 'c1')).toMatchObject({
      status: 'canceled',
      time: '未开始',
    })
    expect(events.find((item) => item.id === 's1')?.status).toBe('skipped')
  })
})
