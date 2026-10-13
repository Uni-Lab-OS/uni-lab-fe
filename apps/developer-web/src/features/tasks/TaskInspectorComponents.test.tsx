import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  NodeJobFeedbackPage,
  WorkflowExecutionLockFact,
  WorkflowNodeJobDetail,
  WorkflowRecoveryFact,
  WorkflowResourceWaitFact,
} from '@unilab-fe/core'
import { IssuesTab } from './TaskDetailIssuesTab'
import { ManualConfirmationActions } from './TaskDetailManualConfirmation'
import { LocksTab } from './TaskDetailLocksTab'
import { ObservabilityTab } from './TaskDetailObservabilityTab'
import { ResourcesTab } from './TaskDetailResourcesTab'
import { TaskExecutionTimeline, type TaskExecutionTimelineItem } from './TaskExecutionTimeline'
import type { TimelineEvent } from './taskDetailModel'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeStationError,
  makeStationSnapshot,
  StationProviders,
} from '../../../test/stationHandlingStub'

const stationPort = createStationPortStub()
const backend = createStudioBackendStub({ core: { stationErrorHandling: stationPort } })
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

// 每个用例后把工站快照还原成「运行中、无错误」的安静基线，避免用例相互污染。
afterEach(() => {
  stationPort.getSnapshot.mockImplementation(async () => makeStationSnapshot())
})

const event = (status: TimelineEvent['status']): TimelineEvent => ({
  id: 'job-1',
  time: '10:00:00',
  title: '移动',
  group: 'device',
  description: '',
  status,
  device: 'robot-1',
  duration: '1 秒',
})

const timelineItem: TaskExecutionTimelineItem = {
  id: 'job-1',
  time: '10:00:00',
  title: '移动',
  status: 'running',
  device: 'robot-1',
  duration: '执行中',
  progress: 140,
}

const lock = (overrides: Partial<WorkflowExecutionLockFact> = {}): WorkflowExecutionLockFact => ({
  lockUuid: 'lock-1',
  jobUuid: 'job-1',
  lockKey: 'robot-1',
  scope: 'device',
  claimUuid: null,
  fencingToken: null,
  state: 'reserved',
  canRelease: false,
  blockingReasons: [],
  raw: {},
  ...overrides,
})

const recovery: WorkflowRecoveryFact = {
  executionUnknown: false,
  requiresReconciliation: false,
  locks: [],
  raw: {},
}

const feedback: NodeJobFeedbackPage = {
  items: [
    {
      kind: 'node_job_feedback',
      source: 'os',
      feedbackUuid: 'feedback-1',
      jobUuid: 'job-1',
      sequence: 3,
      feedbackType: 'progress',
      data: { percent: 50 },
      observedAt: '2026-10-10T10:00:00Z',
      receivedAt: '2026-10-10T10:00:01Z',
      publishedAt: null,
      idempotencyKey: 'feedback-1',
      description: '半程',
      metadata: {},
      raw: {},
    },
  ],
  nextCursor: 3,
  hasMore: false,
  raw: {},
}

describe('developer-web task inspector components', () => {
  it('keeps timeline loading, empty, selection and progress states observable', () => {
    const onSelect = vi.fn()
    const { rerender } = render(<TaskExecutionTimeline items={[]} loading />)
    expect(screen.getByRole('status', { name: '正在加载执行时间线' })).toBeInTheDocument()

    rerender(<TaskExecutionTimeline items={[]} empty={<span>没有节点</span>} />)
    expect(screen.getByText('没有节点')).toBeInTheDocument()

    rerender(<TaskExecutionTimeline items={[timelineItem]} onSelect={onSelect} />)
    const row = screen.getByRole('button', { name: /移动/ })
    expect(row).toHaveAttribute('data-status', 'running')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith(timelineItem)
  })

  it.each([
    ['manual', '需要人工确认'],
    ['unknown', '结果待核对'],
    ['waiting', '等待资源'],
    ['success', '这个节点没有异常'],
    ['failed', '节点执行失败'],
  ] as const)('renders the %s issue state without collapsing it into failure', (status, label) => {
    render(<IssuesTab event={event(status)} />, { wrapper: StationProviders })
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('never reports a failed node as having nothing to handle', () => {
    // 回归：failed 曾经落到 else 分支被显示成「没有待处理异常」。
    render(<IssuesTab event={event('failed')} />, { wrapper: StationProviders })
    expect(screen.queryByText('没有待处理异常')).not.toBeInTheDocument()
    expect(screen.getByText('节点执行失败')).toBeInTheDocument()
  })

  it('keeps a node traceback out of the summary and folds the raw text', async () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/os/unilabos/ros/nodes/base_device_node.py", line 3959, in safe_task_wrapper',
      '    result = await func(**kwargs)',
      'RuntimeError: SZLAB_TEST_NODE_FAILURE：预期的节点测试错误，剩余失败次数 0',
    ].join('\n')
    const job = {
      jobUuid: 'job-1',
      status: 'failed',
      controlData: {},
      errorInfo: [{ message: traceback }],
      raw: {},
    } as unknown as WorkflowNodeJobDetail

    render(<IssuesTab event={event('failed')} job={job} />, { wrapper: StationProviders })

    // 摘要区只出现最后一行异常，不出现 "Traceback (most recent call last)"。
    expect(
      screen.getByText('RuntimeError: SZLAB_TEST_NODE_FAILURE：预期的节点测试错误，剩余失败次数 0'),
    ).toBeInTheDocument()
    const summaryBox = screen.getByText('节点状态').parentElement
    expect(summaryBox?.textContent).toContain('RuntimeError: SZLAB_TEST_NODE_FAILURE')
    expect(summaryBox?.textContent).not.toContain('Traceback (most recent call last)')
    // 完整原文仍然保留，只是折进手风琴（antd Collapse 默认收起、面板懒渲染）。
    const rawHeader = screen.getByText(/OS 返回的完整错误信息/)
    expect(rawHeader.closest('.ant-collapse-header')).not.toBeNull()
    fireEvent.click(rawHeader)
    await waitFor(() =>
      expect(document.querySelector('pre')?.textContent).toContain(
        'Traceback (most recent call last):',
      ),
    )
  })

  it('re-reads the station snapshot once when a failed node has no error fact yet', async () => {
    render(<IssuesTab event={event('failed')} />, { wrapper: StationProviders })

    // 首次挂载读取之后，failed 节点还必须主动补读一次，否则页面会停在旧快照上。
    // 这条补读是自动的：手动「重新读取」按钮已删掉——已被决定消费掉的错误事实不会再出现，
    // 那个按钮只是在承诺一件不可能发生的事。
    await waitFor(() => expect(stationPort.getSnapshot.mock.calls.length).toBeGreaterThan(1))
  })

  it('re-reads the station snapshot only once per failed node', async () => {
    const { rerender } = render(<IssuesTab event={event('failed')} />, {
      wrapper: StationProviders,
    })
    await waitFor(() => expect(stationPort.getSnapshot.mock.calls.length).toBeGreaterThan(1))
    // 先等它彻底静下来再记基线：初次读取与自动补读可能都还在飞，
    // 一拿到 >1 就记基线会把仍在路上的那次当成"重复补读"。
    await new Promise((resolve) => setTimeout(resolve, 60))
    const settled = stationPort.getSnapshot.mock.calls.length

    // 同一个失败节点重复渲染不能反复补读，否则会把工站接口打爆。
    rerender(<IssuesTab event={event('failed')} />)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(stationPort.getSnapshot.mock.calls.length).toBe(settled)
  })

  it('renders the decision entry for the station error bound to this node job', async () => {
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'PAUSED',
        errors: [makeStationError({ sourceJobUuid: 'job-1' })],
      }),
    )

    render(<IssuesTab event={event('failed')} />, { wrapper: StationProviders })

    expect(await screen.findByRole('button', { name: '重试节点' })).toBeInTheDocument()
    expect(screen.getByText('异常信息')).toBeInTheDocument()
    // 有错误事实时不再给出「没有处置入口」的说明。
    expect(screen.queryByRole('button', { name: '重新读取工站处置状态' })).not.toBeInTheDocument()
  })

  it('explains a manual-action result instead of offering a useless re-read', async () => {
    // 回归：人工处置动作的执行任务按设计不会新建工站级错误事实。
    // 原来这里只劝用户「重新读取工站处置状态」，而那个按钮读了永远也没用。
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({
        mode: 'RUNNING',
        errors: [],
        manualActions: [
          {
            kind: 'station_manual_action_job',
            source: 'os',
            jobUuid: 'job-1',
            sessionId: 'session-1',
            status: 'failed',
            deviceId: 'device_action',
            actionName: '目标转到放料位',
            edgeCommandUuid: 'edge-1',
            uncertaintyReason: null,
            resultReviewed: false,
            reviewVersion: null,
            startedAt: null,
            finishedAt: null,
            raw: {},
          },
        ],
      }),
    )
    render(<IssuesTab event={event('failed')} />, { wrapper: StationProviders })

    await waitFor(() => expect(screen.getByText(/这是一次人工处置动作/)).toBeInTheDocument())
    // 没有决定入口，但必须给出真正的出口：结果核对表单。
    expect(screen.getByLabelText('核对说明')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /重新读取工站处置状态/ })).not.toBeInTheDocument()
  })

  it('offers a re-read with visible feedback when the station snapshot could not be read', async () => {
    // 只有「读不到快照」这一支保留重读按钮：那里重读是真的可能成功的。
    stationPort.getSnapshot.mockRejectedValue(new Error('工站暂时不可达'))
    render(<IssuesTab event={event('failed')} />, { wrapper: StationProviders })

    const button = await screen.findByRole('button', { name: /重新读取工站处置状态/ })
    fireEvent.click(button)
    // 点完之后必须有可见反馈，否则用户会以为按钮坏了。
    await waitFor(() => expect(screen.getByText('已重新读取')).toBeInTheDocument())
  })

  it('shows manual confirmation actions from the authoritative node job projection', () => {
    const onDecide = vi.fn().mockResolvedValue(undefined)
    const job = {
      jobUuid: 'job-1',
      status: 'running',
      controlData: {},
      raw: { manual_confirmation: { status: 'pending', actions: ['approve', 'reject'] } },
    } as unknown as WorkflowNodeJobDetail

    render(<ManualConfirmationActions job={job} onDecide={onDecide} />)

    expect(screen.getByText('等待人工确认')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(onDecide).toHaveBeenCalledWith('job-1', 'approve')
  })

  it('recognizes a pending confirmation even when the timeline status is still running', () => {
    const job = {
      jobUuid: 'job-1',
      status: 'running',
      controlData: {},
      raw: { manual_confirmation: { status: 'pending', actions: ['approve'] } },
    } as unknown as WorkflowNodeJobDetail

    render(<IssuesTab event={event('running')} job={job} />, { wrapper: StationProviders })
    expect(screen.getByText('需要人工确认')).toBeInTheDocument()
  })

  it('shows resource absence, explicit site facts and no-inventory diagnostics', () => {
    const waits: WorkflowResourceWaitFact[] = []
    const { rerender } = render(<ResourcesTab waits={waits} job={null} />)
    expect(screen.getByText('暂无资源等待。')).toBeInTheDocument()

    const siteJob = {
      controlData: {},
      raw: { expected_change_set: { kind: 'material_transfer', target_site_uuid: 'site-1' } },
      status: 'succeeded',
    } as unknown as WorkflowNodeJobDetail
    rerender(<ResourcesTab waits={waits} job={siteJob} />)
    expect(screen.getByText('库位图')).toBeInTheDocument()

    const noInventoryJob = {
      controlData: {},
      raw: { expected_change_set: { kind: 'no_inventory_change' } },
      status: 'succeeded',
    } as unknown as WorkflowNodeJobDetail
    rerender(<ResourcesTab waits={waits} job={noInventoryJob} />)
    expect(screen.getByText(/不产生物料库位占用/)).toBeInTheDocument()
  })

  it('keeps lock release fail-closed and preserves feedback or empty states', () => {
    const releaseable = lock({ canRelease: true })
    const { rerender } = render(<LocksTab locks={[releaseable]} recovery={recovery} />)
    expect(screen.getByText('可释放执行锁')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /人工解除整组锁/ })).toBeDisabled()

    rerender(<LocksTab locks={[]} recovery={recovery} />)
    expect(screen.getByText('暂无执行锁快照。')).toBeInTheDocument()

    rerender(<ObservabilityTab feedback={feedback} />)
    expect(screen.getByText('1 条反馈')).toBeInTheDocument()
    expect(screen.getByText('半程')).toBeInTheDocument()
    rerender(<ObservabilityTab feedback={null} />)
    expect(screen.getByText('暂无反馈事件。')).toBeInTheDocument()
  })
})
